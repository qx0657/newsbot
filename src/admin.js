import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { brandConfig, config } from './config.js';
import { aihotSnapshot } from './aihot.js';
import { AppError, CODES } from './errors.js';
import {
  clearAndReconnectFeishu,
  enrichTurns,
  fetchChatName,
  feishuAdminStatus,
  listBotChats,
  saveAndReconnectFeishu,
} from './feishu.js';
import {
  clearDenial,
  listDenials,
  listTurns,
  liveSettings,
  mutateAllowlist,
  quotaSnapshot,
  setMorningDefaultTime,
  setSetting,
  usageRows,
} from './quota.js';
import { authStatus, clearAuth, keepFresh, pollDeviceAuth, startDeviceAuth } from './xai-token.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

export function publicHealth() {
  const xai = authStatus();
  const aihot = aihotSnapshot();
  return {
    ok: true,
    service: 'newsbot',
    feishu: { connected: feishuAdminStatus().connected },
    xai: { present: Boolean(xai.present && !xai.expired) },
    aihot: { lastOkAt: aihot.lastOkAt, lastStatus: aihot.lastStatus },
  };
}

async function adminStatus() {
  const xai = await keepFresh();
  const turns = await enrichTurns(listTurns(30));
  const usage = [];
  for (const row of usageRows()) {
    let chatName = row.chatName || '';
    if (!chatName && row.chatId) {
      chatName = await fetchChatName(row.chatId).catch(() => '');
    }
    usage.push({ ...row, chatName });
  }
  return {
    brand: brandConfig(),
    feishu: feishuAdminStatus(),
    xai: {
      present: xai.present,
      email: xai.email,
      expired: xai.expired,
      expiresAt: xai.expiresAt,
      lastRefresh: xai.lastRefresh,
      lastError: xai.lastError || null,
    },
    aihot: aihotSnapshot(),
    quota: quotaSnapshot(),
    settings: liveSettings(),
    denials: listDenials(),
    usage,
    turns,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

export function fillIndexHtml(raw) {
  const brand = brandConfig();
  const json = JSON.stringify({
    name: brand.name,
    nameEn: brand.nameEn,
    short: brand.short,
  }).replace(/</g, '\\u003c');
  return String(raw).replace('<!--brand-boot-->', `<script>window.__BRAND__=${json}</script>`);
}

function sendFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const nocache = ext === '.html' || ext === '.js' || ext === '.css';
  if (ext === '.html') {
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store, no-cache, must-revalidate',
    });
    res.end(fillIndexHtml(readFileSync(filePath, 'utf8')));
    return;
  }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': nocache ? 'no-store, no-cache, must-revalidate' : 'public, max-age=86400',
  });
  createReadStream(filePath).pipe(res);
}

function staticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = clean === '/' ? '/index.html' : clean;
  const root = resolve(config.root, 'public');
  const full = normalize(join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

async function handleAdminApi(req, res, url) {
  const path = url.pathname;
  const method = req.method || 'GET';
  try {
    if (method === 'GET' && path === '/api/admin/status') {
      sendJson(res, 200, await adminStatus());
      return;
    }
    if (method === 'GET' && path === '/api/admin/groups') {
      sendJson(res, 200, await listBotChats());
      return;
    }
    if (method === 'POST' && path === '/api/admin/allowlist') {
      const body = await readJson(req);
      const list = mutateAllowlist(body.kind, body.id, body.op === 'remove' ? 'remove' : 'add');
      if (body.op !== 'remove' && body.id) clearDenial(String(body.id).trim());
      sendJson(res, 200, { ok: true, list, settings: liveSettings() });
      return;
    }
    if (method === 'POST' && path === '/api/admin/feishu') {
      const body = await readJson(req);
      const feishu = await saveAndReconnectFeishu({
        appId: body.appId,
        appSecret: body.appSecret,
      });
      sendJson(res, 200, { ok: true, feishu });
      return;
    }
    if (method === 'POST' && path === '/api/admin/feishu/clear') {
      const feishu = await clearAndReconnectFeishu();
      sendJson(res, 200, { ok: true, feishu });
      return;
    }
    if (method === 'POST' && path === '/api/admin/settings') {
      const body = await readJson(req);
      if (body.dailyUserCap != null) setSetting('dailyUserCap', Number(body.dailyUserCap));
      if (body.dailyGlobalCap != null) setSetting('dailyGlobalCap', Number(body.dailyGlobalCap));
      if (body.xaiModel) setSetting('xaiModel', String(body.xaiModel).trim());
      if (body.p2pOpen != null) setSetting('p2pOpen', body.p2pOpen ? '1' : '0');
      if (body.morningDefaultTime != null) setMorningDefaultTime(body.morningDefaultTime);
      sendJson(res, 200, { ok: true, settings: liveSettings() });
      return;
    }
    if (method === 'POST' && path === '/api/admin/xai/start') {
      const started = await startDeviceAuth();
      sendJson(res, 200, started);
      return;
    }
    if (method === 'POST' && path === '/api/admin/xai/poll') {
      const body = await readJson(req);
      const result = await pollDeviceAuth({ deviceCode: body.deviceCode });
      sendJson(res, 200, { ...result, xai: authStatus() });
      return;
    }
    if (method === 'POST' && path === '/api/admin/xai/logout') {
      clearAuth();
      sendJson(res, 200, { ok: true, xai: authStatus() });
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    sendJson(res, status, { error: err?.code || CODES.INVALID_INPUT, message: err?.message || 'failed' });
  }
}

export async function handleHttp(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    sendJson(res, 200, publicHealth());
    return;
  }
  if (url.pathname.startsWith('/api/admin/')) {
    await handleAdminApi(req, res, url);
    return;
  }
  const file = staticPath(url.pathname);
  if (file) {
    sendFile(res, file);
    return;
  }
  res.writeHead(404);
  res.end('not found');
}
