import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { AppError, CODES } from './errors.js';

let db;

export function shanghaiDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function openDb() {
  if (db) return db;
  db = new DatabaseSync(config.paths.db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      day TEXT NOT NULL,
      open_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, open_id)
    );
    CREATE TABLE IF NOT EXISTS seen (
      message_id TEXT PRIMARY KEY,
      seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS denials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      last_open_id TEXT,
      last_at INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      chat_id TEXT,
      open_id TEXT,
      text TEXT,
      intent TEXT,
      used_grok INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS morning_delivery (
      chat_id TEXT NOT NULL,
      day TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      sent_at INTEGER,
      PRIMARY KEY (chat_id, day)
    );
  `);
  ensureColumn('turns', 'chat_name', 'TEXT');
  ensureColumn('turns', 'user_name', 'TEXT');
  ensureColumn('turns', 'chat_type', 'TEXT');
  const migrated = db.prepare('SELECT value FROM settings WHERE key = ?').get('capsMigratedUnlimited');
  if (!migrated) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('dailyUserCap', '0')
       ON CONFLICT(key) DO UPDATE SET value = '0'`,
    ).run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('dailyGlobalCap', '0')
       ON CONFLICT(key) DO UPDATE SET value = '0'`,
    ).run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('capsMigratedUnlimited', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    ).run();
  }
  return db;
}

function tableColumns(table) {
  return new Set(openDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function ensureColumn(table, name, ddl) {
  if (!tableColumns(table).has(name)) {
    openDb().exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

export function shanghaiDayBounds(day = shanghaiDay()) {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return { day, start, end: start + 24 * 3600 * 1000 };
}

export function getProfile(id) {
  if (!id) return '';
  const row = openDb().prepare('SELECT name FROM profiles WHERE id = ?').get(id);
  return row ? String(row.name) : '';
}

export function setProfile(id, name, kind = 'user') {
  const n = String(name || '').trim();
  if (!id || !n) return;
  openDb()
    .prepare(
      `INSERT INTO profiles (id, kind, name, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         updated_at = excluded.updated_at`,
    )
    .run(id, kind, n, Date.now());
}

export function displayChatName(id, stored, chatType) {
  if (stored) return String(stored);
  if (chatType === 'p2p') return '私聊';
  if (!id) return '私聊';
  if (id === 'cli') return '命令行';
  if (id === 'morning') return '早报';
  if (id === 'codex') return 'Tibo重置';
  return getProfile(id) || '';
}

export function displayUserName(id, stored) {
  if (stored) return String(stored);
  if (id === 'morning') return '早报';
  if (id === 'codex') return 'Tibo重置';
  if (id === 'cli') return '命令行';
  return getProfile(id) || '';
}

function parseList(raw, fallback) {
  let list;
  if (raw == null || raw === '') {
    list = [...fallback];
  } else {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) list = v.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      /* csv */
    }
    if (!list) {
      list = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [...new Set(list)];
}

export function getSetting(key) {
  const row = openDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? String(row.value) : null;
}

export function setSetting(key, value) {
  openDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value));
}

export function chatAllowlist() {
  return parseList(getSetting('chatAllowlist'), config.chatAllowlist);
}

export function p2pAllowlist() {
  return parseList(getSetting('p2pAllowlist'), config.p2pAllowlist);
}

export function morningAllowlist() {
  return parseList(getSetting('morningAllowlist'), []);
}

function flag(key) {
  const v = getSetting(key);
  return v === '1' || v === 'true';
}

export function p2pOpen() {
  return flag('p2pOpen');
}

export function allowChat({ chatType, chatId }) {
  if (chatType === 'p2p') return p2pOpen();
  if (chatType === 'group') {
    const list = chatAllowlist();
    return list.length > 0 && list.includes(chatId);
  }
  return false;
}

export function liveCaps() {
  const user = Number(getSetting('dailyUserCap'));
  const global = Number(getSetting('dailyGlobalCap'));
  return {
    user: Number.isFinite(user) ? Math.floor(user) : config.dailyUserCap,
    global: Number.isFinite(global) ? Math.floor(global) : config.dailyGlobalCap,
  };
}

export function liveModel() {
  return getSetting('xaiModel') || config.xaiModel;
}

export function liveSettings() {
  const caps = liveCaps();
  return {
    chatAllowlist: chatAllowlist(),
    p2pAllowlist: p2pAllowlist(),
    p2pOpen: p2pOpen(),
    morningAllowlist: morningAllowlist(),
    morningSent: morningSentMap(),
    morningArmed: morningArmedMap(),
    morningDefaultTime: morningDefaultTime(),
    dailyUserCap: caps.user,
    dailyGlobalCap: caps.global,
    xaiModel: liveModel(),
    codexSeen: loadCodexSeen().length,
  };
}

export function loadCodexSeen() {
  try {
    const v = JSON.parse(getSetting('codexSeen') || '[]');
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

export function saveCodexSeen(list) {
  const uniq = [...new Set((list || []).map(String).filter(Boolean))];
  setSetting('codexSeen', JSON.stringify(uniq));
  return uniq;
}

function saveList(key, list) {
  const uniq = [...new Set(list.map(String).map((s) => s.trim()).filter(Boolean))];
  if (key === 'morningAllowlist') {
    const prev = parseList(getSetting('morningAllowlist'), []);
    setSetting(key, JSON.stringify(uniq));
    syncMorningArmed(prev, uniq);
    return uniq;
  }
  setSetting(key, JSON.stringify(uniq));
  return uniq;
}

const LIST_KINDS = {
  chat: { key: 'chatAllowlist', prefix: 'oc_', get: chatAllowlist },
  p2p: { key: 'p2pAllowlist', prefix: 'ou_', get: p2pAllowlist },
  morning: { key: 'morningAllowlist', prefix: 'oc_', get: morningAllowlist },
};

export function setAllowlist(kind, list) {
  const spec = LIST_KINDS[kind];
  if (!spec) throw new AppError(CODES.INVALID_INPUT, 400, 'kind');
  return saveList(spec.key, list);
}

export function mutateAllowlist(kind, id, op) {
  const spec = LIST_KINDS[kind];
  if (!spec) throw new AppError(CODES.INVALID_INPUT, 400, 'kind');
  const value = String(id || '').trim();
  if (!value.startsWith(spec.prefix)) {
    throw new AppError(CODES.INVALID_INPUT, 400, `id 应以 ${spec.prefix} 开头`);
  }
  const cur = spec.get();
  const next = op === 'remove' ? cur.filter((x) => x !== value) : cur.includes(value) ? cur : [...cur, value];
  return saveList(spec.key, next);
}

function jsonObjectSetting(key) {
  try {
    const v = JSON.parse(getSetting(key) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* ignore */
  }
  return {};
}

function morningSentMap() {
  return jsonObjectSetting('morningSent');
}

function morningArmedMap() {
  return jsonObjectSetting('morningArmed');
}

function syncMorningArmed(prevList, nextList, now = Date.now()) {
  const prev = new Set(prevList.map(String));
  const next = new Set(nextList.map(String));
  const map = morningArmedMap();
  let changed = false;
  for (const id of next) {
    if (!prev.has(id) && map[id] == null) {
      map[id] = now;
      changed = true;
    }
  }
  for (const id of prev) {
    if (!next.has(id) && map[id] != null) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) setSetting('morningArmed', JSON.stringify(map));
}

export function setMorningArmedAt(ids, at) {
  const map = morningArmedMap();
  const list = Array.isArray(ids) ? ids : [ids];
  for (const id of list) {
    if (at == null) delete map[id];
    else map[id] = Number(at);
  }
  setSetting('morningArmed', JSON.stringify(map));
  return map;
}

/** 过了当天早报点才打开的群，今天不再发，等到明天那个点。 */
export function morningDueToday(id, day = shanghaiDay()) {
  const armed = Number(morningArmedMap()[id]);
  if (!Number.isFinite(armed)) return true;
  const sendAt = Date.parse(`${day}T${morningDefaultTime()}:00+08:00`);
  if (!Number.isFinite(sendAt)) return true;
  return armed <= sendAt;
}

export const MORNING_CLAIM_STALE_MS = 15 * 60 * 1000;
export const MORNING_BRIEF_VERSION = 5;

function morningDelivery(id, day) {
  return openDb()
    .prepare('SELECT status, claimed_at AS claimedAt, sent_at AS sentAt FROM morning_delivery WHERE chat_id = ? AND day = ?')
    .get(id, day);
}

function morningOccupied(id, day, nowMs = Date.now()) {
  const row = morningDelivery(id, day);
  if (row?.status === 'sent') return 'sent';
  if (row?.status === 'claimed' && nowMs - Number(row.claimedAt) < MORNING_CLAIM_STALE_MS) return 'claimed';
  if (morningSentMap()[id] === day) return 'sent';
  return null;
}

export function pendingMorningChats(day = shanghaiDay(), now = new Date()) {
  if (morningDefaultTime() > shanghaiHm(now)) return [];
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  return morningAllowlist().filter((id) => !morningOccupied(id, day, nowMs) && morningDueToday(id, day));
}

function withImmediate(fn) {
  const database = openDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* no open transaction */
    }
    throw err;
  }
}

/** 跨进程认领今日待发群。先占坑再生成/发送，避免 tick 与手动补发各发一份。 */
export function claimMorningChats(day = shanghaiDay(), now = new Date()) {
  if (morningDefaultTime() > shanghaiHm(now)) return [];
  const nowMs = Date.now();
  return withImmediate((database) => {
    const ids = [];
    const insert = database.prepare(
      `INSERT INTO morning_delivery (chat_id, day, status, claimed_at) VALUES (?, ?, 'claimed', ?)`,
    );
    const update = database.prepare(
      `UPDATE morning_delivery SET status = 'claimed', claimed_at = ?, sent_at = NULL WHERE chat_id = ? AND day = ?`,
    );
    for (const id of morningAllowlist()) {
      if (morningOccupied(id, day, nowMs)) continue;
      if (!morningDueToday(id, day)) continue;
      const row = morningDelivery(id, day);
      if (row) update.run(nowMs, id, day);
      else insert.run(id, day, nowMs);
      ids.push(id);
    }
    return ids;
  });
}

export function releaseMorningClaim(ids, day = shanghaiDay()) {
  const list = Array.isArray(ids) ? ids : [ids];
  const stmt = openDb().prepare(
    `DELETE FROM morning_delivery WHERE chat_id = ? AND day = ? AND status = 'claimed'`,
  );
  for (const id of list) stmt.run(id, day);
}

export function markMorningSent(ids, day = shanghaiDay()) {
  const list = Array.isArray(ids) ? ids : [ids];
  const nowMs = Date.now();
  return withImmediate((database) => {
    const sent = morningSentMap();
    const upsert = database.prepare(
      `INSERT INTO morning_delivery (chat_id, day, status, claimed_at, sent_at)
       VALUES (?, ?, 'sent', ?, ?)
       ON CONFLICT(chat_id, day) DO UPDATE SET status = 'sent', sent_at = excluded.sent_at`,
    );
    for (const id of list) {
      sent[id] = day;
      upsert.run(id, day, nowMs, nowMs);
    }
    database
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run('morningSent', JSON.stringify(sent));
    return sent;
  });
}

export const DEFAULT_MORNING_TIME = '09:00';

export function shanghaiHm(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hourRaw = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  const hour = hourRaw === '24' ? '00' : hourRaw.padStart(2, '0');
  return `${hour}:${minute.padStart(2, '0')}`;
}

export function morningTimeSlots(from = '06:00', to = '12:00') {
  const parse = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + m;
  };
  const out = [];
  for (let t = parse(from); t <= parse(to); t += 15) {
    const h = Math.floor(t / 60);
    const min = t % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

export function normalizeMorningTime(raw) {
  const s = String(raw ?? '').trim();
  const matched = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) {
    throw new AppError(CODES.INVALID_INPUT, 400, '时间须为 HH:MM，15 分钟一档');
  }
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59 || minute % 15 !== 0) {
    throw new AppError(CODES.INVALID_INPUT, 400, '时间须为 HH:MM，15 分钟一档');
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function morningDefaultTime() {
  try {
    return normalizeMorningTime(getSetting('morningDefaultTime') || DEFAULT_MORNING_TIME);
  } catch {
    return DEFAULT_MORNING_TIME;
  }
}

export function setMorningDefaultTime(raw) {
  const time = normalizeMorningTime(raw);
  setSetting('morningDefaultTime', time);
  return time;
}

export function morningBriefCache(day = shanghaiDay()) {
  try {
    const v = JSON.parse(getSetting('morningBrief') || '{}');
    if (v && v.day === day && v.v === MORNING_BRIEF_VERSION && Array.isArray(v.items) && v.items.length) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveMorningBriefCache(row) {
  const stored = { ...row, v: MORNING_BRIEF_VERSION };
  setSetting('morningBrief', JSON.stringify(stored));
  return stored;
}

export function clearMorningBriefCache() {
  setSetting('morningBrief', '{}');
}

export function recordDenial({ kind, id, openId }) {
  const now = Date.now();
  openDb()
    .prepare(
      `INSERT INTO denials (id, kind, last_open_id, last_at, count) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         last_open_id = excluded.last_open_id,
         last_at = excluded.last_at,
         count = count + 1`,
    )
    .run(id, kind, openId || '', now);
}

export function listDenials() {
  return openDb()
    .prepare('SELECT id, kind, last_open_id AS lastOpenId, last_at AS lastAt, count FROM denials ORDER BY last_at DESC LIMIT 50')
    .all();
}

export function clearDenial(id) {
  openDb().prepare('DELETE FROM denials WHERE id = ?').run(id);
}

export function recordTurn(row) {
  const database = openDb();
  const chatName = String(row.chatName || '').trim();
  const userName = String(row.userName || '').trim();
  const chatType = String(row.chatType || '').trim();
  database
    .prepare(
      `INSERT INTO turns (at, chat_id, open_id, text, intent, used_grok, error, chat_name, user_name, chat_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Date.now(),
      row.chatId || '',
      row.openId || '',
      String(row.text || '').slice(0, 500),
      row.intent || '',
      row.usedGrok ? 1 : 0,
      row.error ? String(row.error).slice(0, 300) : null,
      chatName || null,
      userName || null,
      chatType || null,
    );
  if (row.chatId && chatName) setProfile(row.chatId, chatName, 'chat');
  if (row.openId && userName) setProfile(row.openId, userName, 'user');
  database.prepare('DELETE FROM turns WHERE id < (SELECT MAX(id) FROM turns) - 200').run();
}

export function patchTurnNames(id, { chatName, userName }) {
  if (!id) return;
  openDb()
    .prepare(
      `UPDATE turns SET
         chat_name = COALESCE(NULLIF(?, ''), chat_name),
         user_name = COALESCE(NULLIF(?, ''), user_name)
       WHERE id = ?`,
    )
    .run(String(chatName || '').trim(), String(userName || '').trim(), id);
}

export function listTurns(limit = 40) {
  return openDb()
    .prepare(
      `SELECT id, at, chat_id AS chatId, open_id AS openId, text, intent,
              used_grok AS usedGrok, error, chat_name AS chatName,
              user_name AS userName, chat_type AS chatType
       FROM turns ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      ...row,
      chatName: displayChatName(row.chatId, row.chatName, row.chatType),
      userName: displayUserName(row.openId, row.userName),
    }));
}

export function usageRows() {
  const { start, end } = shanghaiDayBounds();
  const raw = openDb()
    .prepare(
      `SELECT chat_id AS chatId, chat_type AS chatType, COUNT(*) AS count
       FROM turns
       WHERE used_grok = 1 AND at >= ? AND at < ?
       GROUP BY chat_id, chat_type
       ORDER BY count DESC`,
    )
    .all(start, end);
  const merged = new Map();
  for (const row of raw) {
    const ids = String(row.chatId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const targets = ids.length ? ids : [''];
    for (const id of targets) {
      const prev = merged.get(id) || { chatId: id, chatType: row.chatType || '', count: 0 };
      prev.count += Number(row.count) || 0;
      if (!prev.chatType && row.chatType) prev.chatType = row.chatType;
      merged.set(id, prev);
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count)
    .map((row) => ({
      ...row,
      chatName: displayChatName(row.chatId, '', row.chatType),
    }));
}

export function alreadySeen(messageId) {
  const row = openDb().prepare('SELECT 1 FROM seen WHERE message_id = ?').get(messageId);
  if (row) return true;
  openDb().prepare('INSERT INTO seen (message_id, seen_at) VALUES (?, ?)').run(messageId, Date.now());
  openDb()
    .prepare('DELETE FROM seen WHERE seen_at < ?')
    .run(Date.now() - 2 * 24 * 3600 * 1000);
  return false;
}

export function consumeQuota(openId) {
  const day = shanghaiDay();
  const database = openDb();
  const caps = liveCaps();
  if (caps.global > 0) {
    const global = database.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM usage WHERE day = ?').get(day);
    if (Number(global?.n || 0) >= caps.global) throw new AppError(CODES.QUOTA_GLOBAL, 429);
  }
  if (caps.user > 0) {
    const mine = database.prepare('SELECT count FROM usage WHERE day = ? AND open_id = ?').get(day, openId);
    if (Number(mine?.count || 0) >= caps.user) throw new AppError(CODES.QUOTA_USER, 429);
  }
  database
    .prepare(
      `INSERT INTO usage (day, open_id, count) VALUES (?, ?, 1)
       ON CONFLICT(day, open_id) DO UPDATE SET count = count + 1`,
    )
    .run(day, openId);
}

export function quotaSnapshot() {
  const day = shanghaiDay();
  const caps = liveCaps();
  const global = openDb().prepare('SELECT COALESCE(SUM(count), 0) AS n FROM usage WHERE day = ?').get(day);
  return {
    day,
    global: Number(global?.n || 0),
    globalCap: caps.global,
    userCap: caps.user,
  };
}
