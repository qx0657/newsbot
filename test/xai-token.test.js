import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'newsbot-xai-'));
process.env.DATA_DIR = dir;

const { config } = await import('../src/config.js');
const { CODES } = await import('../src/errors.js');
const {
  authStatus,
  getAccessToken,
  keepFresh,
  loadAuth,
  resetXaiRuntime,
} = await import('../src/xai-token.js');

const TOKEN_URL = 'https://auth.x.ai/oauth/token';
const origFetch = globalThis.fetch;

function writeAuth(data) {
  writeFileSync(config.paths.xaiAuth, JSON.stringify(data, null, 2));
}

function readAuth() {
  return JSON.parse(readFileSync(config.paths.xaiAuth, 'utf8'));
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockOauth({ tokenStatus = 200, tokenBody = {}, tokenCalls } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('.well-known')) {
      return jsonRes({
        token_endpoint: TOKEN_URL,
        device_authorization_endpoint: 'https://auth.x.ai/oauth/device',
      });
    }
    if (u === TOKEN_URL) {
      if (tokenCalls) tokenCalls.count += 1;
      return jsonRes(tokenBody, tokenStatus);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

beforeEach(() => {
  resetXaiRuntime();
  globalThis.fetch = origFetch;
  if (existsSync(config.paths.xaiAuth)) unlinkSync(config.paths.xaiAuth);
});

afterEach(() => {
  globalThis.fetch = origFetch;
  resetXaiRuntime();
});

test('authStatus empty file is not present', () => {
  assert.deepEqual(authStatus(), { present: false });
});

test('valid access token is logged in', () => {
  writeAuth({
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Date.now() + 60 * 60 * 1000,
    email: 'a@example.com',
    last_refresh: '2026-09-03T08:58:32.238Z',
  });
  const s = authStatus();
  assert.equal(s.present, true);
  assert.equal(s.expired, false);
  assert.equal(s.email, 'a@example.com');
});

test('stale access with refresh token is still logged in', () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'r',
    expires_at: Date.now() - 60 * 1000,
    email: 'a@example.com',
    last_refresh: '2026-09-03T08:58:32.238Z',
  });
  const s = authStatus();
  assert.equal(s.present, true);
  assert.equal(s.expired, false);
  assert.equal(s.lastError, null);
});

test('stale access without refresh token needs re-login', () => {
  writeAuth({
    access_token: 'old',
    refresh_token: '',
    expires_at: Date.now() - 60 * 1000,
  });
  const s = authStatus();
  assert.equal(s.present, true);
  assert.equal(s.expired, true);
});

test('getAccessToken does not hit network when still fresh', async () => {
  writeAuth({
    access_token: 'live',
    refresh_token: 'r',
    expires_at: Date.now() + 60 * 60 * 1000,
  });
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    throw new Error('should not fetch');
  };
  assert.equal(await getAccessToken(), 'live');
  assert.equal(called, 0);
});

test('getAccessToken refreshes two minutes before expiry', async () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'refresh-1',
    expires_at: Date.now() + 60 * 1000,
    email: 'a@example.com',
    source: 'device-code',
  });
  const tokenCalls = { count: 0 };
  mockOauth({
    tokenCalls,
    tokenBody: {
      access_token: 'new',
      refresh_token: 'refresh-2',
      expires_in: 21600,
      id_token: '',
    },
  });
  assert.equal(await getAccessToken(), 'new');
  assert.equal(tokenCalls.count, 1);
  const saved = readAuth();
  assert.equal(saved.access_token, 'new');
  assert.equal(saved.refresh_token, 'refresh-2');
  assert.equal(saved.refresh_error, undefined);
  assert.equal(authStatus().expired, false);
});

test('keepFresh renews a stale token', async () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'refresh-1',
    expires_at: Date.now() - 5 * 60 * 1000,
    email: 'a@example.com',
  });
  mockOauth({
    tokenBody: { access_token: 'new', refresh_token: 'refresh-1', expires_in: 21600 },
  });
  const s = await keepFresh();
  assert.equal(s.present, true);
  assert.equal(s.expired, false);
  assert.equal(loadAuth().access_token, 'new');
});

test('refresh 401 marks credentials expired without wiping tokens', async () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'dead',
    expires_at: Date.now() - 1000,
    email: 'a@example.com',
  });
  mockOauth({ tokenStatus: 401, tokenBody: { error: 'invalid_grant' } });
  await assert.rejects(() => getAccessToken(), (err) => err.code === CODES.XAI_AUTH_REQUIRED);
  const s = authStatus();
  assert.equal(s.present, true);
  assert.equal(s.expired, true);
  assert.match(s.lastError, /HTTP 401/);
  const saved = readAuth();
  assert.equal(saved.access_token, 'old');
  assert.equal(saved.refresh_token, 'dead');
  assert.equal(saved.refresh_error.code, CODES.XAI_AUTH_REQUIRED);
});

test('keepFresh does not hammer token endpoint after 401', async () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'dead',
    expires_at: Date.now() - 1000,
    refresh_error: {
      code: CODES.XAI_AUTH_REQUIRED,
      message: 'refresh failed: HTTP 401',
      at: new Date().toISOString(),
    },
  });
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    throw new Error('should not fetch');
  };
  const s = await keepFresh();
  assert.equal(s.expired, true);
  assert.equal(called, 0);
});

test('refresh 429 does not ask for re-login', async () => {
  writeAuth({
    access_token: 'old',
    refresh_token: 'r',
    expires_at: Date.now() - 1000,
  });
  mockOauth({ tokenStatus: 429, tokenBody: { error: 'rate_limited' } });
  await assert.rejects(() => getAccessToken(), (err) => err.code === CODES.XAI_QUOTA_EXHAUSTED);
  const s = authStatus();
  assert.equal(s.present, true);
  assert.equal(s.expired, false);
  assert.equal(readAuth().refresh_error, undefined);
});
