import { AppError, CODES } from './errors.js';
import { aihotGet } from './aihot.js';

export const CODEX_PAGE_URL = 'https://aihot.news/codex-reset';
const CACHE_TTL_MS = 3 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const LIVE_GRACE_MS = 24 * 60 * 60 * 1000;
const LIVE_CREATED_MS = 36 * 60 * 60 * 1000;

/** @type {{ at: number, cal: object } | null} */
let cache = null;

export function resetCodexCache() {
  cache = null;
}

export function fingerprintOf(event) {
  return `${event?.id || ''}:${event?.status || ''}`;
}

function asIso(value) {
  const s = String(value || '').trim();
  return s || null;
}

function asDate(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function compactPost(row) {
  if (!row || typeof row !== 'object') return null;
  const url = String(row.url || '').trim();
  const text = String(row.text || '').replace(/\s+/g, ' ').trim();
  if (!text && !url) return null;
  return {
    id: String(row.id || ''),
    publishedAt: asIso(row.publishedAt),
    stage: String(row.stage || '').trim(),
    text,
    originalText: String(row.originalText || '').replace(/\s+/g, ' ').trim(),
    url: /^https?:\/\//i.test(url) ? url : '',
  };
}

export function compactEvent(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const type = row.type === 'reset_credit' ? 'reset_credit' : row.type === 'direct_reset' ? 'direct_reset' : '';
  if (!id || !type) return null;
  const status = row.status === 'announced' ? 'announced' : row.status === 'confirmed' ? 'confirmed' : '';
  if (!status) return null;
  const posts = (Array.isArray(row.posts) ? row.posts : []).map(compactPost).filter(Boolean);
  const schedule =
    row.schedule && typeof row.schedule === 'object'
      ? {
          precision: String(row.schedule.precision || ''),
          from: asIso(row.schedule.from),
          through: asIso(row.schedule.through),
          label: String(row.schedule.label || '').trim(),
        }
      : null;
  const createdAt = asIso(row.createdAt);
  let when = asDate(createdAt) || 0;
  for (const post of posts) {
    const t = asDate(post.publishedAt) || 0;
    if (t > when) when = t;
  }
  return {
    id,
    type,
    label: type === 'reset_credit' ? '发重置卡' : '全员重置',
    status,
    title: String(row.title || '').trim() || (status === 'confirmed' ? '已完成' : '预告'),
    scope: String(row.scope || '').trim(),
    createdAt,
    updatedAt: asIso(row.updatedAt),
    confirmedAt: asIso(row.confirmedAt),
    occurredOn: asIso(row.occurredOn),
    schedule: schedule?.label || schedule?.from ? schedule : null,
    posts,
    url: /^https?:\/\//i.test(String(row.url || '')) ? String(row.url) : CODEX_PAGE_URL,
    when,
  };
}

export function isLiveAnnounced(event, nowMs = Date.now()) {
  if (!event || event.status !== 'announced') return false;
  const through = asDate(event.schedule?.through);
  if (through != null) return nowMs <= through + LIVE_GRACE_MS;
  const created = asDate(event.createdAt);
  if (created != null) return nowMs - created <= LIVE_CREATED_MS;
  return false;
}

function byWhenDesc(a, b) {
  return (b.when || 0) - (a.when || 0) || String(b.id).localeCompare(String(a.id));
}

function shanghaiYmd(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function addDaysYmd(day, n) {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/** Abramowitz & Stegun 26.2.17: lognormal survival P(X > days). */
function lognormalSurvival(days, mu, sigma) {
  if (days <= 0) return 1;
  const z = (Math.log(days) - mu) / sigma;
  const abs = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * abs);
  const tail =
    (Math.exp((-abs * abs) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return z < 0 ? 1 - tail : tail;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Same historical estimate as aihot.news/codex-reset.
 * Lognormal fit on confirmed 全员重置 intervals; first day starts at asOf, not midnight.
 * Returns null if a live Tibo announcement exists, or the sample is too small.
 */
export function forecastDirectResets(events, asOf, { pending = null } = {}) {
  if (pending) return null;
  const asOfMs = asDate(asOf);
  if (asOfMs == null) return null;

  const earliest = new Map();
  for (const event of events || []) {
    if (event.type !== 'direct_reset' || event.status !== 'confirmed') continue;
    if (!event.confirmedAt || !(event.posts || []).length) continue;
    const at = asDate(event.confirmedAt);
    if (at == null || at > asOfMs) continue;
    const prev = earliest.get(event.id);
    if (prev == null || at < prev) earliest.set(event.id, at);
  }

  const confirmed = [...earliest.values()].sort((a, b) => a - b);
  const intervals = confirmed.slice(1).map((at, i) => (at - confirmed[i]) / 864e5).filter((d) => d > 0);
  if (intervals.length < 8) return null;

  const logs = intervals.map(Math.log);
  const mu = logs.reduce((sum, n) => sum + n, 0) / logs.length;
  const variance = logs.reduce((sum, n) => sum + (n - mu) ** 2, 0) / logs.length;
  if (variance < 1e-8) return null;
  const sigma = Math.sqrt(variance);
  const lastAt = confirmed[confirmed.length - 1];
  const elapsedDays = (asOfMs - lastAt) / 864e5;
  const remaining = lognormalSurvival(elapsedDays, mu, sigma);
  if (remaining < 1e-6) return null;

  const survival = (days) => lognormalSurvival(days, mu, sigma);
  const today = shanghaiYmd(asOf);
  const probabilities = Array.from({ length: 3 }, (_, i) => {
    const day = addDaysYmd(today, i);
    const start = Math.max(asOfMs, Date.parse(`${day}T00:00:00+08:00`));
    const end = Date.parse(`${addDaysYmd(day, 1)}T00:00:00+08:00`);
    return {
      day,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      probability: clamp01((survival((start - lastAt) / 864e5) - survival((end - lastAt) / 864e5)) / remaining),
    };
  });
  const horizon = Date.parse(probabilities[probabilities.length - 1].endsAt);
  const sorted = intervals.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    asOf: new Date(asOfMs).toISOString(),
    lastConfirmedAt: new Date(lastAt).toISOString(),
    sampleCount: confirmed.length,
    intervalCount: intervals.length,
    medianIntervalDays: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    timeZone: 'Asia/Shanghai',
    probabilities,
    laterProbability: clamp01(survival((horizon - lastAt) / 864e5) / remaining),
  };
}

export function summarizeCodex(events, nowMs = Date.now()) {
  const list = (events || []).slice().sort(byWhenDesc);
  const pending = list.filter((e) => isLiveAnnounced(e, nowMs));
  const confirmed = list.filter((e) => e.status === 'confirmed');
  const hero = pending[0] || confirmed[0] || list[0] || null;
  const items = [];
  if (hero) items.push(hero);
  for (const event of list) {
    if (hero && event.id === hero.id) continue;
    items.push(event);
    if (items.length >= 6) break;
  }
  return {
    pending: pending[0] || null,
    latestConfirmed: confirmed[0] || null,
    hero,
    items,
  };
}

export function parseCodexResets(body, nowMs = Date.now()) {
  const events = (Array.isArray(body?.events) ? body.events : []).map(compactEvent).filter(Boolean);
  if (!events.length) {
    throw new AppError(CODES.CODEX_FAILED, 502, 'Tibo 重置日历为空');
  }
  const summary = summarizeCodex(events, nowMs);
  const asOf = asIso(body?.checkedAt) || new Date(nowMs).toISOString();
  return {
    kind: 'codex',
    timezone: body?.timezone || 'Asia/Shanghai',
    checkedAt: asIso(body?.checkedAt),
    historyFrom: asIso(body?.historyFrom),
    sourceUrl: CODEX_PAGE_URL,
    count: events.length,
    events,
    forecast: forecastDirectResets(events, asOf, { pending: summary.pending }),
    ...summary,
  };
}

export function newCodexChanges(prevFingerprints, cal) {
  const next = (cal?.events || []).map(fingerprintOf).filter(Boolean);
  const prev = prevFingerprints instanceof Set ? prevFingerprints : new Set(prevFingerprints || []);
  if (prev.size === 0) {
    return { seed: true, fingerprints: next, changes: [] };
  }
  const changes = (cal?.events || []).filter((event) => {
    const fp = fingerprintOf(event);
    return fp && !prev.has(fp);
  });
  return { seed: false, fingerprints: next, changes };
}

export async function fetchCodexResets({ force = false, now = Date.now() } = {}) {
  if (!force && cache?.cal && now - cache.at < CACHE_TTL_MS) {
    return cache.cal;
  }
  try {
    const body = await aihotGet('/api/v1/codex-resets');
    const cal = parseCodexResets(body, now);
    cache = { at: now, cal };
    return cal;
  } catch (err) {
    if (cache?.cal && now - cache.at < STALE_MS) return cache.cal;
    if (err instanceof AppError && err.code === CODES.CODEX_FAILED) throw err;
    throw new AppError(CODES.CODEX_FAILED, err?.status || 502, err?.message || 'Tibo 重置日历拉取失败');
  }
}
