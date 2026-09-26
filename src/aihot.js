import { config } from './config.js';
import { AppError, CODES } from './errors.js';
import { getSetting, listTurns, setSetting } from './quota.js';

const etagCache = new Map();
export const aihotState = { lastOkAt: null, lastError: null, lastStatus: null };
let hydrated = false;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  aihotState.lastOkAt = getSetting('aihotLastOkAt') || null;
  aihotState.lastError = getSetting('aihotLastError') || null;
  const st = getSetting('aihotLastStatus');
  aihotState.lastStatus = st == null || st === '' ? null : Number(st);
  if (!aihotState.lastOkAt) {
    const hit = listTurns(30).find((t) => t.usedGrok);
    if (hit?.at) {
      aihotState.lastOkAt = new Date(hit.at).toISOString();
      persist();
    }
  }
}

function persist() {
  setSetting('aihotLastOkAt', aihotState.lastOkAt || '');
  setSetting('aihotLastError', aihotState.lastError || '');
  setSetting('aihotLastStatus', aihotState.lastStatus == null ? '' : String(aihotState.lastStatus));
}

export function aihotSnapshot() {
  hydrate();
  return { ...aihotState, base: config.aihotBase };
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function aihotGet(path, params = {}) {
  hydrate();
  const url = `${config.aihotBase}${path}${qs(params)}`;
  const headers = {
    Accept: 'application/json',
    'User-Agent': config.aihotUserAgent,
  };
  const cached = etagCache.get(url);
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    aihotState.lastError = err.message;
    aihotState.lastStatus = 0;
    persist();
    throw new AppError(CODES.AIHOT_FAILED, 502, err.message);
  }

  aihotState.lastStatus = res.status;
  if (res.status === 304 && cached?.body) {
    aihotState.lastOkAt = new Date().toISOString();
    aihotState.lastError = null;
    persist();
    return cached.body;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    aihotState.lastError = `HTTP ${res.status}`;
    persist();
    throw new AppError(CODES.AIHOT_FAILED, res.status, `AIHOT ${path} ${res.status} ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  const etag = res.headers.get('etag');
  if (etag) etagCache.set(url, { etag, body });
  aihotState.lastOkAt = new Date().toISOString();
  aihotState.lastError = null;
  persist();
  return body;
}

export function compactItem(it) {
  if (!it || typeof it !== 'object') return null;
  const row = {
    title: it.title || null,
    summary: it.summary || null,
    reason: it.reason || null,
    source: it.source?.name || it.sourceName || null,
    aihot: it.links?.aihot || null,
    original: it.links?.original || null,
    publishedAt: it.publishedAt || null,
    discoveredAt: it.discoveredAt || null,
    category: it.category || null,
    selected: it.selected,
    rank: it.rank,
    story: it.links?.story || null,
  };
  for (const k of Object.keys(row)) {
    if (row[k] === undefined || row[k] === null) delete row[k];
  }
  return row;
}

export function storyIdFromLink(url) {
  const m = String(url || '').match(/^https:\/\/aihot\.virxact\.com\/story\/([^/?#]+)/);
  return m ? m[1] : null;
}

export async function fetchLatest({ window = '24h', category, mode = 'selected', limit = 8, q } = {}) {
  const body = await aihotGet('/api/v1/items', { mode, window, category, q, limit });
  return {
    kind: 'items',
    query: body.query || { mode, window, category, q },
    items: (body.items || []).map(compactItem).filter(Boolean),
  };
}

export async function fetchSearch(intent) {
  const first = await fetchLatest({
    window: intent.window || '7d',
    category: intent.category,
    mode: intent.mode || 'selected',
    limit: 8,
    q: intent.q,
  });
  if (first.items.length > 0 || intent.mode === 'all') return first;
  const all = await fetchLatest({
    window: intent.window || '7d',
    category: intent.category,
    mode: 'all',
    limit: 8,
    q: intent.q,
  });
  return { ...all, note: '精选池为空，以下来自公开池（未进入精选）' };
}

export async function fetchHot() {
  const body = await aihotGet('/api/v1/hot-topics');
  return {
    kind: 'hot',
    items: (body.items || []).map(compactItem).filter(Boolean),
  };
}

export async function fetchDaily(date) {
  let target = date;
  if (!target) {
    const index = await aihotGet('/api/v1/dailies', { limit: 1 });
    target = index.items?.[0]?.date;
    if (!target) return { kind: 'daily', date: null, report: null };
  }
  const body = await aihotGet(`/api/v1/dailies/${target}`);
  const report = body.report || null;
  return {
    kind: 'daily',
    date: target,
    aihot: report?.links?.aihot || `https://aihot.virxact.com/daily/${target}`,
    lead: report?.lead || report?.leadTitle || indexLead(report),
    sections: (report?.sections || []).slice(0, 8).map((s) => ({
      title: s.title || s.heading,
      items: (s.items || s.entries || []).slice(0, 6).map(compactItem).filter(Boolean),
    })),
    flashes: (report?.flashes || []).slice(0, 8).map(compactItem).filter(Boolean),
  };
}

function indexLead(report) {
  if (!report) return null;
  return report.leadParagraph || report.leadTitle || null;
}

export async function fetchStory(publicId) {
  const body = await aihotGet(`/api/v1/stories/${publicId}`);
  const story = body.story || body;
  return {
    kind: 'story',
    publicId,
    title: story.title,
    latest: story.latest,
    digest: story.digest,
    aihot: story.links?.aihot,
    reports: (story.reports || []).slice(0, 8).map((r) => ({
      title: r.title,
      aihot: r.links?.aihot,
      original: r.links?.original,
      publishedAt: r.publishedAt,
    })),
  };
}
