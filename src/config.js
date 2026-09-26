import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function csv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
mkdirSync(dataDir, { recursive: true });

const actorFile = resolve(dataDir, '.aihot-actor-id');
function actorId() {
  if (existsSync(actorFile)) {
    const raw = readFileSync(actorFile, 'utf8').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
      return raw;
    }
  }
  const id = randomUUID();
  writeFileSync(actorFile, `${id}\n`, { mode: 0o600 });
  return id;
}

const actor = actorId();

function envText(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

/** 对外名称。源码默认是通用模板，部署时用 BOT_* 换成自己的名字。 */
export function brandConfig() {
  return {
    name: envText('BOT_NAME', 'AI 资讯'),
    nameEn: envText('BOT_NAME_EN', 'Newsbot'),
    short: envText('BOT_TAGLINE', '群里的 AI 资讯简报员'),
    description: envText(
      'BOT_DESCRIPTION',
      '在群里 @ 我，问今天、热点、日报，或某个公司 / 模型。资料来自 AIHOT，由 Grok 写成中文简报。不是通用助手，不写代码、不闲聊。',
    ),
  };
}

export const config = {
  root,
  dataDir,
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 3520),
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  chatAllowlist: csv(process.env.FEISHU_CHAT_ALLOWLIST),
  p2pAllowlist: csv(process.env.FEISHU_P2P_ALLOWLIST),
  xaiApiBase: (process.env.XAI_API_BASE || 'https://api.x.ai/v1').replace(/\/$/, ''),
  xaiModel: process.env.XAI_MODEL || 'grok-4-fast',
  aihotBase: (process.env.AIHOT_BASE || 'https://aihot.virxact.com').replace(/\/$/, ''),
  aihotUserAgent: `aihot-newsbot/0.1.0 (+https://aihot.virxact.com/aihot-skill/; aihot-actor/${actor})`,
  dailyUserCap: int(process.env.DAILY_USER_CAP, 0),
  dailyGlobalCap: int(process.env.DAILY_GLOBAL_CAP, 0),
  paths: {
    xaiAuth: resolve(dataDir, 'xai-auth.json'),
    feishuAuth: resolve(dataDir, 'feishu-auth.json'),
    db: resolve(dataDir, 'newsbot.db'),
  },
};

export const FEISHU_APP_ID_RE = /^cli_[a-z0-9]{8,32}$/i;

export function feishuConsoleUrl(appId) {
  const id = String(appId || '').trim();
  if (!FEISHU_APP_ID_RE.test(id)) return 'https://open.feishu.cn/app';
  return `https://open.feishu.cn/app/${id}`;
}

function readFeishuAuthFile() {
  if (!existsSync(config.paths.feishuAuth)) return {};
  try {
    const raw = JSON.parse(readFileSync(config.paths.feishuAuth, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const appId = String(raw.appId || '').trim();
    const appSecret = String(raw.appSecret || '').trim();
    return {
      appId: FEISHU_APP_ID_RE.test(appId) ? appId : '',
      appSecret,
    };
  } catch {
    return {};
  }
}

export function feishuCredentials() {
  const file = readFeishuAuthFile();
  const envId = String(process.env.FEISHU_APP_ID || '').trim();
  const envSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
  if (file.appId && file.appSecret) {
    return { appId: file.appId, appSecret: file.appSecret, source: 'file' };
  }
  if (envId && envSecret) {
    return { appId: envId, appSecret: envSecret, source: 'env' };
  }
  return {
    appId: file.appId || envId || '',
    appSecret: file.appSecret || envSecret || '',
    source: 'none',
  };
}

export function normalizeFeishuAppId(raw) {
  const appId = String(raw || '').trim();
  if (!FEISHU_APP_ID_RE.test(appId)) {
    throw new Error('应用 ID 应为 cli_ 开头');
  }
  return appId;
}

export function prepareFeishuAuth({ appId, appSecret }) {
  const id = normalizeFeishuAppId(appId);
  const incoming = String(appSecret || '').trim();
  const current = feishuCredentials();
  const secret = incoming || current.appSecret;
  if (!secret) throw new Error('请填写应用密钥');
  return { appId: id, appSecret: secret };
}

export function saveFeishuAuth({ appId, appSecret }) {
  const next = prepareFeishuAuth({ appId, appSecret });
  mkdirSync(dirname(config.paths.feishuAuth), { recursive: true });
  writeFileSync(
    config.paths.feishuAuth,
    `${JSON.stringify(
      {
        appId: next.appId,
        appSecret: next.appSecret,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  try {
    chmodSync(config.paths.feishuAuth, 0o600);
  } catch {
    /* ignore */
  }
  return next;
}

export function clearFeishuAuthFile() {
  if (existsSync(config.paths.feishuAuth)) unlinkSync(config.paths.feishuAuth);
}

export function feishuConfigured() {
  const { appId, appSecret } = feishuCredentials();
  return Boolean(appId && appSecret);
}

export function assertRuntimeConfig() {
  if (!feishuConfigured()) {
    throw new Error('未配置飞书应用：在后台填写应用 ID 和密钥，或设置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
}
