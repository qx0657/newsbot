import * as Lark from '@larksuiteoapi/node-sdk';
import {
  clearFeishuAuthFile,
  feishuConfigured,
  feishuConsoleUrl,
  feishuCredentials,
  prepareFeishuAuth,
  saveFeishuAuth,
} from './config.js';
import { AppError, CODES, denyHint, userMessage } from './errors.js';
import { answer } from './brief.js';
import {
  alreadySeen,
  allowChat,
  chatAllowlist,
  displayChatName,
  displayUserName,
  getProfile,
  listDenials,
  morningAllowlist,
  patchTurnNames,
  recordDenial,
  recordTurn,
  setProfile,
} from './quota.js';
import { normalizeText } from './intent.js';

const busy = new Set();
export const feishuState = {
  connected: false,
  botOpenId: null,
  lastEventAt: null,
  lastError: null,
};
let runtime = { client: null, wsClient: null };
let starting = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

export function extractText(message) {
  if (!message) return '';
  if (message.message_type === 'text') {
    try {
      const parsed = JSON.parse(message.content || '{}');
      return normalizeText(parsed.text || '');
    } catch {
      return normalizeText(message.content);
    }
  }
  if (message.message_type === 'post') {
    try {
      const parsed = JSON.parse(message.content || '{}');
      const locale = parsed.zh_cn || parsed.en_us || Object.values(parsed)[0] || {};
      const chunks = [];
      for (const line of locale.content || []) {
        for (const el of line || []) {
          if (el.tag === 'text' || el.tag === 'md') chunks.push(el.text || '');
          if (el.tag === 'a') chunks.push(el.text || el.href || '');
        }
      }
      return normalizeText(chunks.join(' '));
    } catch {
      return '';
    }
  }
  return '';
}

function mentionOpenId(mention) {
  const id = mention?.id;
  if (typeof id === 'string') return id.trim();
  return String(id?.open_id || '').trim();
}

export function isMentionAll(mention) {
  if (!mention || typeof mention !== 'object') return false;
  const key = String(mention.key || '').toLowerCase();
  if (key === '@_all' || key === '@all') return true;
  const id = mention.id;
  const parts = typeof id === 'string' ? [id] : [id?.open_id, id?.user_id, id?.union_id];
  if (parts.some((p) => String(p || '').trim().toLowerCase() === 'all')) return true;
  const name = String(mention.name || '').trim();
  return name === '所有人' || name === 'Everyone' || /^@?all$/i.test(name);
}

function textMentionsAll(text) {
  const s = String(text || '');
  return /@_all\b/i.test(s) || /<at\b[^>]*\buser_id\s*=\s*\\?["']all\\?["']/i.test(s);
}

function walkMentionsAll(node) {
  if (node == null) return false;
  if (typeof node === 'string') return textMentionsAll(node);
  if (Array.isArray(node)) return node.some(walkMentionsAll);
  if (typeof node !== 'object') return false;
  if (node.tag === 'at' && String(node.user_id || '').toLowerCase() === 'all') return true;
  return Object.values(node).some(walkMentionsAll);
}

export function contentMentionsAll(message) {
  const raw = message?.content;
  if (textMentionsAll(typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''))) return true;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && walkMentionsAll(parsed)) return true;
  } catch {
    /* not json */
  }
  return false;
}

/** 群聊里只有明确 @ 本机器人才答。飞书 group_at 也会把 @所有人推过来。 */
export function addressedToBot(message, botOpenId) {
  const chatType = message?.chat_type;
  if (chatType !== 'group' && chatType !== 'topic_group') return true;

  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const others = [];
  let sawAll = contentMentionsAll(message);
  for (const m of mentions) {
    if (isMentionAll(m)) {
      sawAll = true;
      continue;
    }
    const openId = mentionOpenId(m);
    if (openId) others.push(openId);
  }

  if (botOpenId) {
    if (others.includes(botOpenId)) return true;
    const raw = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
    if (raw.includes(botOpenId)) return true;
    if (mentions.length > 0 || sawAll) return false;
    return true;
  }

  if (others.length > 0) return true;
  if (sawAll) return false;
  return true;
}

function extraChatRows(chats, { listed }) {
  const seen = new Set(chats.map((c) => c.chatId));
  const replyOn = new Set(chatAllowlist());
  const morningOn = new Set(morningAllowlist());
  for (const chatId of [...replyOn, ...morningOn]) {
    if (seen.has(chatId)) continue;
    chats.push({
      chatId,
      name: listed ? '已开通，但机器人不在该群' : replyOn.has(chatId) ? '已开通' : '已开早报',
      enabled: replyOn.has(chatId),
      morning: morningOn.has(chatId),
      missing: Boolean(listed),
      external: false,
    });
    seen.add(chatId);
  }
  for (const d of listDenials()) {
    if (d.kind !== 'chat') continue;
    if (seen.has(d.id)) continue;
    chats.push({
      chatId: d.id,
      name: '有人 @ 过，尚未开通',
      enabled: false,
      morning: morningOn.has(d.id),
      pending: true,
      missing: false,
      external: false,
    });
    seen.add(d.id);
  }
  for (const c of chats) {
    if (c.morning == null) c.morning = morningOn.has(c.chatId);
  }
  return chats;
}

let tenantToken = { value: null, exp: 0 };

export async function probeFeishuCredentials({ appId, appSecret }) {
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const token = tokenJson.tenant_access_token;
  if (!token) {
    throw new AppError(
      CODES.INVALID_INPUT,
      400,
      tokenJson.msg || `飞书凭证无效 ${tokenJson.code || tokenRes.status}`,
    );
  }
  return tokenJson;
}

async function getTenantToken() {
  const { appId, appSecret } = feishuCredentials();
  if (!appId || !appSecret) return null;
  if (tenantToken.value && Date.now() < tenantToken.exp) return tenantToken.value;
  const tokenJson = await probeFeishuCredentials({ appId, appSecret });
  const token = tokenJson.tenant_access_token;
  const ttl = Number(tokenJson.expire) || 7200;
  tenantToken = { value: token, exp: Date.now() + Math.max(60, ttl - 120) * 1000 };
  return token;
}

async function botOpenId() {
  const token = await getTenantToken();
  if (!token) return null;
  const res = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  return data.bot?.open_id || null;
}

export async function listBotChats() {
  if (!feishuConfigured()) {
    return { chats: extraChatRows([], { listed: false }), error: '飞书未配置' };
  }
  try {
    const token = await getTenantToken();
    if (!token) return { chats: extraChatRows([], { listed: false }), error: '拿不到飞书 token' };
    const allowed = new Set(chatAllowlist());
    const morningOn = new Set(morningAllowlist());
    const chats = [];
    let pageToken = '';
    for (let i = 0; i < 20; i++) {
      const url = new URL('https://open.feishu.cn/open-apis/im/v1/chats');
      url.searchParams.set('page_size', '100');
      url.searchParams.set('sort_type', 'ByActiveTimeDesc');
      if (pageToken) url.searchParams.set('page_token', pageToken);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.code && body.code !== 0) {
        const hint =
          body.code === 99991672
            ? '需要开通「获取群组信息」权限（im:chat:read），创建版本并发布后再刷新。'
            : body.msg || `飞书 ${body.code}`;
        return { chats: extraChatRows(chats, { listed: false }), error: hint };
      }
      for (const item of body.data?.items || []) {
        if (item.chat_status && item.chat_status !== 'normal') continue;
        if (item.chat_mode === 'p2p') continue;
        const chatId = item.chat_id;
        if (!chatId) continue;
        const name = item.name || '(未命名群)';
        chats.push({
          chatId,
          name,
          enabled: allowed.has(chatId),
          morning: morningOn.has(chatId),
          missing: false,
          external: Boolean(item.external),
        });
        if (item.name) setProfile(chatId, item.name, 'chat');
      }
      if (!body.data?.has_more) break;
      pageToken = body.data.page_token || '';
      if (!pageToken) break;
    }
    return { chats: extraChatRows(chats, { listed: true }), error: null };
  } catch (err) {
    return { chats: extraChatRows([], { listed: false }), error: err.message || '拉群列表失败' };
  }
}

async function react(client, messageId, emoji) {
  try {
    await client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emoji } },
    });
  } catch (err) {
    log('reaction failed', err?.message || err);
  }
}

async function postMessage(chatId, { msgType, content, uuid }) {
  const token = await getTenantToken();
  if (!token) throw new Error('飞书未配置');
  const payload = {
    receive_id: chatId,
    msg_type: msgType,
    content,
  };
  if (uuid) payload.uuid = String(uuid).slice(0, 50);
  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.code && body.code !== 0) {
    const err = new Error(body.msg || `飞书发消息 ${body.code}`);
    err.code = body.code;
    throw err;
  }
  return body;
}

export async function sendMarkdownToChat(chatId, markdown, { uuid } = {}) {
  const content = JSON.stringify({
    zh_cn: { content: [[{ tag: 'md', text: markdown }]] },
  });
  return postMessage(chatId, { msgType: 'post', content, uuid });
}

export async function sendCardToChat(chatId, card, { uuid } = {}) {
  return postMessage(chatId, {
    msgType: 'interactive',
    content: JSON.stringify(card),
    uuid,
  });
}

async function reply(_client, message, markdown) {
  // 发到群里，不要 reply 进话题。
  await sendMarkdownToChat(message.chat_id, markdown);
}

const membersCache = new Map();
const chatNameCache = new Map();
const MEMBERS_TTL_MS = 30 * 60 * 1000;
const CHAT_TTL_MS = 6 * 60 * 60 * 1000;

async function feishuJson(path, { method = 'GET', body } = {}) {
  const token = await getTenantToken();
  if (!token) return null;
  const res = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const json = await res.json();
  if (json.code && json.code !== 0) {
    log('feishu api', path, json.code, json.msg);
    return null;
  }
  return json.data || null;
}

export async function fetchChatName(chatId) {
  if (!chatId || !String(chatId).startsWith('oc_')) return '';
  const hit = chatNameCache.get(chatId);
  if (hit && Date.now() - hit.at < CHAT_TTL_MS) return hit.name;
  const stored = getProfile(chatId);
  if (stored) {
    chatNameCache.set(chatId, { at: Date.now(), name: stored });
    return stored;
  }
  const data = await feishuJson(`/im/v1/chats/${encodeURIComponent(chatId)}`);
  const name = String(data?.name || '').trim();
  if (name) {
    setProfile(chatId, name, 'chat');
    chatNameCache.set(chatId, { at: Date.now(), name });
  }
  return name;
}

export async function fetchChatMembers(chatId) {
  if (!chatId || !String(chatId).startsWith('oc_')) return [];
  const hit = membersCache.get(chatId);
  if (hit && Date.now() - hit.at < MEMBERS_TTL_MS) return hit.members;
  const members = [];
  let pageToken = '';
  let ok = false;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ member_id_type: 'open_id', page_size: '100' });
    if (pageToken) qs.set('page_token', pageToken);
    const data = await feishuJson(`/im/v1/chats/${encodeURIComponent(chatId)}/members?${qs}`);
    if (!data) break;
    ok = true;
    for (const item of data.items || []) {
      const id = item.member_id || '';
      const name = String(item.name || '').trim();
      if (!id) continue;
      members.push({ id, name });
      if (name) setProfile(id, name, 'user');
    }
    if (!data.has_more) break;
    pageToken = data.page_token || '';
    if (!pageToken) break;
  }
  if (ok) membersCache.set(chatId, { at: Date.now(), members });
  return members;
}

export async function resolveTurnNames({ chatId, openId, chatType }) {
  const type = chatType || (String(chatId || '').startsWith('oc_') ? 'group' : 'p2p');
  const chatName =
    type === 'p2p'
      ? '私聊'
      : displayChatName(chatId, '', type) || (await fetchChatName(chatId).catch(() => ''));
  let userName = displayUserName(openId, '');
  if (!userName && openId && String(openId).startsWith('ou_') && chatId) {
    const members = await fetchChatMembers(chatId).catch(() => []);
    userName = members.find((m) => m.id === openId)?.name || getProfile(openId) || '';
  }
  return { chatName: chatName || '', userName: userName || '', chatType: type };
}

export async function enrichTurns(rows) {
  if (!rows?.length) return rows || [];
  const chatIds = [...new Set(rows.map((r) => r.chatId).filter((id) => String(id || '').startsWith('oc_')))];
  await Promise.allSettled(
    chatIds.map(async (id) => {
      const needChat = rows.some((r) => r.chatId === id && !r.chatName);
      const needUser = rows.some(
        (r) => r.chatId === id && !r.userName && String(r.openId || '').startsWith('ou_'),
      );
      if (needChat) await fetchChatName(id);
      if (needUser) await fetchChatMembers(id);
    }),
  );
  return rows.map((row) => {
    const chatName = displayChatName(row.chatId, row.chatName, row.chatType);
    const userName = displayUserName(row.openId, row.userName);
    if (row.id && (chatName !== row.chatName || userName !== row.userName)) {
      patchTurnNames(row.id, { chatName, userName });
    }
    return { ...row, chatName, userName };
  });
}

async function handleEvent(client, data) {
  const message = data.message;
  const sender = data.sender;
  if (!message?.message_id) return;
  if (sender?.sender_type && sender.sender_type !== 'user') return;
  if (alreadySeen(message.message_id)) return;

  const openId = sender?.sender_id?.open_id || '';
  const chatId = message.chat_id;
  const chatType = message.chat_type;
  feishuState.lastEventAt = new Date().toISOString();

  // group_at 会推「@本机器人」和「@所有人」。后者不当成提问。
  if ((chatType === 'group' || chatType === 'topic_group') && !addressedToBot(message, feishuState.botOpenId)) {
    log('ignore @all', { chatId, messageId: message.message_id });
    return;
  }

  if (!allowChat({ chatType, chatId })) {
    log('denied', { chatType, chatId, openId });
    recordDenial({
      kind: chatType === 'p2p' ? 'p2p' : 'chat',
      id: chatType === 'p2p' ? openId : chatId,
      openId,
    });
    const hint = denyHint(chatType);
    if (hint) await reply(client, message, hint);
    return;
  }

  if (message.message_type !== 'text' && message.message_type !== 'post') {
    await reply(client, message, '我只看文字。问「今天」「热点」「日报」「AA榜」「模型榜」「Tibo重置」，或丢一个公司 / 模型名。');
    return;
  }

  const text = extractText(message);
  if (!text) {
    await reply(client, message, '没看到问题。试着问「今天有什么」。');
    return;
  }

  const lock = `${chatId}:${openId}`;
  if (busy.has(lock)) {
    await reply(client, message, userMessage(new AppError(CODES.BUSY)));
    return;
  }
  busy.add(lock);
  await react(client, message.message_id, 'OK');
  const namesP = resolveTurnNames({ chatId, openId, chatType }).catch(() => ({}));
  try {
    const { markdown, card, usedGrok, intent } = await answer({ text, chatId, openId });
    const names = await namesP;
    recordTurn({ chatId, openId, text, intent, usedGrok, ...names });
    if (card) {
      try {
        await sendCardToChat(chatId, card);
      } catch (err) {
        log('card send failed, markdown fallback', err?.message || err);
        await reply(client, message, markdown);
      }
    } else {
      await reply(client, message, markdown);
    }
  } catch (err) {
    log('answer failed', err?.code || '', err?.message || err);
    const names = await namesP;
    recordTurn({
      chatId,
      openId,
      text,
      intent: 'error',
      usedGrok: false,
      error: err?.code || err?.message,
      ...names,
    });
    await reply(client, message, userMessage(err));
  } finally {
    busy.delete(lock);
  }
}

export function stopFeishu() {
  const ws = runtime.wsClient;
  runtime = { client: null, wsClient: null };
  feishuState.connected = false;
  feishuState.botOpenId = null;
  tenantToken = { value: null, exp: 0 };
  if (!ws) return;
  try {
    ws.close({ force: true });
  } catch (err) {
    log('feishu close', err?.message || err);
  }
}

export function feishuAdminStatus() {
  const creds = feishuCredentials();
  const conn = runtime.wsClient?.getConnectionStatus?.();
  return {
    connected: feishuState.connected,
    botOpenId: feishuState.botOpenId,
    lastEventAt: feishuState.lastEventAt,
    lastError: feishuState.lastError,
    appId: creds.appId || null,
    configured: Boolean(creds.appId && creds.appSecret),
    secretSet: Boolean(creds.appSecret),
    source: creds.source,
    consoleUrl: feishuConsoleUrl(creds.appId),
    wsState: conn?.state || (feishuState.connected ? 'connected' : 'idle'),
  };
}

async function waitForFeishu(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (feishuState.connected || feishuState.lastError) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startFeishu() {
  if (starting) return starting;
  starting = startFeishuInner().finally(() => {
    starting = null;
  });
  return starting;
}

async function startFeishuInner() {
  stopFeishu();
  feishuState.lastError = null;
  const { appId, appSecret } = feishuCredentials();
  if (!appId || !appSecret) {
    log('飞书未配置：在后台填写应用 ID 和密钥，或写 .env');
    return null;
  }

  try {
    const baseConfig = {
      appId,
      appSecret,
      domain: Lark.Domain.Feishu,
    };
    const client = new Lark.Client(baseConfig);
    try {
      feishuState.botOpenId = await botOpenId();
      log('bot open_id', feishuState.botOpenId);
    } catch (err) {
      log('bot info skipped', err?.message || err);
    }

    const wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info,
      handshakeTimeoutMs: 15_000,
      onReady: () => {
        feishuState.connected = true;
        feishuState.lastError = null;
        log('feishu websocket ready');
      },
      onError: (err) => {
        feishuState.connected = false;
        feishuState.lastError = err?.message || String(err);
        log('feishu websocket error', feishuState.lastError);
      },
      onReconnecting: () => {
        feishuState.connected = false;
        log('feishu websocket reconnecting');
      },
      onReconnected: () => {
        feishuState.connected = true;
        feishuState.lastError = null;
        log('feishu websocket reconnected');
      },
    });

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data) => {
        // 长连接要求 3 秒内不抛异常；Grok 远超 3 秒，必须立即返回。
        handleEvent(client, data).catch((err) => log('handler', err?.message || err));
      },
    });

    runtime = { client, wsClient };
    wsClient.start({ eventDispatcher }).catch((err) => {
      feishuState.connected = false;
      feishuState.lastError = err?.message || String(err);
      log('feishu websocket start failed', feishuState.lastError);
    });
    log('feishu websocket starting', appId);
    return { client, wsClient };
  } catch (err) {
    feishuState.connected = false;
    feishuState.lastError = err?.message || String(err);
    throw err;
  }
}

export async function restartFeishu({ waitMs = 0 } = {}) {
  if (starting) {
    try {
      await starting;
    } catch {
      /* previous start already logged */
    }
  }
  const started = startFeishu();
  started.catch((err) => log('feishu restart', err?.message || err));
  if (waitMs) await waitForFeishu(waitMs);
  return feishuAdminStatus();
}

export async function saveAndReconnectFeishu({ appId, appSecret }) {
  let next;
  try {
    next = prepareFeishuAuth({ appId, appSecret });
  } catch (err) {
    throw new AppError(CODES.INVALID_INPUT, 400, err.message || '飞书凭证无效');
  }
  await probeFeishuCredentials(next);
  saveFeishuAuth(next);
  return restartFeishu({ waitMs: 8_000 });
}

export async function clearAndReconnectFeishu() {
  clearFeishuAuthFile();
  return restartFeishu({ waitMs: 8_000 });
}
