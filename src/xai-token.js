/**
 * xAI OAuth：device-code 登录 + access_token 自动刷新。
 * 官方 auth.x.ai + api.x.ai，client_id 与 grok-cli / hermes-agent / openclaw 相同。
 * 凭据必须单独放在本服务 data/xai-auth.json，不要和其他项目共用同一份登录。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { AppError, CODES } from './errors.js';

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const ISSUER = 'https://auth.x.ai';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const FETCH_TIMEOUT_MS = 30_000;
const REFRESH_SKEW_MS = 120_000;
const AUTH_RETRY_MS = 10 * 60 * 1000;

/** @type {{ tokenEndpoint: string, deviceEndpoint: string|null } | null} */
let discoveryCache = null;
/** @type {Promise<{access_token: string}> | null} */
let refreshing = null;

async function discover() {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new AppError(CODES.XAI_DEVICE_FAILED, 502, `discovery HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token_endpoint) {
    throw new AppError(CODES.XAI_DEVICE_FAILED, 502, 'discovery 缺 token_endpoint');
  }
  discoveryCache = {
    tokenEndpoint: data.token_endpoint,
    deviceEndpoint: data.device_authorization_endpoint || null,
  };
  return discoveryCache;
}

export function loadAuth() {
  if (!existsSync(config.paths.xaiAuth)) return null;
  try {
    return JSON.parse(readFileSync(config.paths.xaiAuth, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuth(data) {
  mkdirSync(dirname(config.paths.xaiAuth), { recursive: true });
  writeFileSync(config.paths.xaiAuth, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(config.paths.xaiAuth, 0o600);
  } catch {
    /* ignore */
  }
}

function emailOf(idToken) {
  if (!idToken) return null;
  try {
    const part = String(idToken).split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

function toRecord({ accessToken, refreshToken, expiresIn, idToken }, previous = {}) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken || previous.refresh_token || '',
    id_token: idToken || previous.id_token || '',
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : null,
    email: emailOf(idToken) || previous.email || null,
    last_refresh: new Date().toISOString(),
    source: previous.source || 'device-code',
  };
}

function recordRefreshError(auth, err) {
  saveAuth({
    ...auth,
    refresh_error: {
      code: err.code || CODES.XAI_AUTH_REQUIRED,
      message: String(err.message || err),
      at: new Date().toISOString(),
    },
  });
}

function needsRefresh(auth, now = Date.now()) {
  return Boolean(auth?.expires_at && now + REFRESH_SKEW_MS >= auth.expires_at);
}

async function refresh(auth) {
  const { tokenEndpoint } = await discover();
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: auth.refresh_token,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new AppError(CODES.XAI_QUOTA_EXHAUSTED, 429);
  if (!res.ok) {
    const err = new AppError(CODES.XAI_AUTH_REQUIRED, 401, `refresh failed: HTTP ${res.status}`);
    recordRefreshError(auth, err);
    throw err;
  }
  const data = await res.json();
  if (!data.access_token) {
    const err = new AppError(CODES.XAI_AUTH_REQUIRED, 401, 'refresh 没返回 access_token');
    recordRefreshError(auth, err);
    throw err;
  }
  const next = toRecord(
    {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      idToken: data.id_token,
    },
    auth,
  );
  saveAuth(next);
  return next;
}

export async function getAccessToken() {
  const auth = loadAuth();
  if (!auth?.access_token) throw new AppError(CODES.XAI_AUTH_REQUIRED, 401, 'no credentials');
  if (needsRefresh(auth)) {
    if (!auth.refresh_token) {
      const err = new AppError(CODES.XAI_AUTH_REQUIRED, 401, 'no refresh token');
      recordRefreshError(auth, err);
      throw err;
    }
    if (!refreshing) {
      refreshing = refresh(auth).finally(() => {
        refreshing = null;
      });
    }
    const next = await refreshing;
    return next.access_token;
  }
  return auth.access_token;
}

export function authStatus() {
  const auth = loadAuth();
  if (!auth?.access_token && !auth?.refresh_token) return { present: false };
  const accessExpired = Boolean(auth.expires_at && Date.now() > auth.expires_at);
  const refreshFailed = auth.refresh_error?.code === CODES.XAI_AUTH_REQUIRED;
  return {
    present: true,
    email: auth.email || null,
    expiresAt: auth.expires_at ? new Date(auth.expires_at).toISOString() : null,
    expired: refreshFailed || (accessExpired && !auth.refresh_token),
    lastRefresh: auth.last_refresh || null,
    lastError: refreshFailed ? auth.refresh_error.message || null : null,
  };
}

function recentlyFailedAuth(auth) {
  if (auth?.refresh_error?.code !== CODES.XAI_AUTH_REQUIRED) return false;
  const at = Date.parse(auth.refresh_error.at || '');
  return Number.isFinite(at) && Date.now() - at < AUTH_RETRY_MS;
}

/** 临近过期就续；给后台状态和进程内定时器用。失败不抛，状态写进 authStatus。 */
export async function keepFresh() {
  const auth = loadAuth();
  if (!auth?.access_token && !auth?.refresh_token) return authStatus();
  if (recentlyFailedAuth(auth)) return authStatus();
  try {
    await getAccessToken();
  } catch (err) {
    console.error(new Date().toISOString(), 'xai keep-fresh', err.message || err);
  }
  return authStatus();
}

export function startTokenKeeper(ms = 60_000) {
  const kick = () => {
    keepFresh().catch((err) => {
      console.error(new Date().toISOString(), 'xai keep-fresh', err);
    });
  };
  kick();
  return setInterval(kick, ms);
}

/** @internal */
export function resetXaiRuntime() {
  discoveryCache = null;
  refreshing = null;
}

export async function startDeviceAuth() {
  const { deviceEndpoint } = await discover();
  if (!deviceEndpoint) throw new AppError(CODES.XAI_DEVICE_FAILED, 502, 'issuer 未声明 device 端点');
  const res = await fetch(deviceEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new AppError(CODES.XAI_DEVICE_RATE_LIMITED, 429);
  if (!res.ok) throw new AppError(CODES.XAI_DEVICE_FAILED, 502, `device HTTP ${res.status}`);
  const data = await res.json();
  if (!data.device_code || !data.user_code) {
    throw new AppError(CODES.XAI_DEVICE_FAILED, 502, 'device 响应不完整');
  }
  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUrl: data.verification_uri_complete || data.verification_uri,
    interval: Math.max(3, Number(data.interval) || 5),
  };
}

export function clearAuth() {
  try {
    writeFileSync(config.paths.xaiAuth, '{}', { mode: 0o600 });
  } catch {
    /* missing is fine */
  }
}

export async function pollDeviceAuth({ deviceCode }) {
  const { tokenEndpoint } = await discover();
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: deviceCode,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.ok) {
    const data = await res.json();
    if (!data.access_token) throw new AppError(CODES.XAI_DEVICE_FAILED, 502, 'no access_token');
    saveAuth(
      toRecord({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        idToken: data.id_token,
      }),
    );
    return { status: 'done' };
  }
  const err = await res.json().catch(() => ({}));
  if (err.error === 'authorization_pending') return { status: 'pending' };
  if (err.error === 'slow_down') return { status: 'pending', slowDown: true };
  if (err.error === 'expired_token') {
    throw new AppError(CODES.XAI_DEVICE_FAILED, 502, '配对码已过期，请重新开始');
  }
  throw new AppError(
    CODES.XAI_DEVICE_FAILED,
    502,
    `poll failed: ${err.error_description || err.error || `HTTP ${res.status}`}`,
  );
}
