import { AppError, CODES } from './errors.js';

export const AA_PAGE_URL = 'https://artificialanalysis.ai/';
export const AA_INDEX_URL = 'https://artificialanalysis.ai/#artificial-analysis-intelligence-index';
export function aaUserAgent() {
  const contact = String(process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  const extra = contact ? `; +${contact}` : '';
  return `Mozilla/5.0 (compatible; newsbot/0.1${extra}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const FETCH_MS = 20_000;

/** @type {{ at: number, board: object } | null} */
let cache = null;

export function resetAaCache() {
  cache = null;
}

function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

/** Slice one JSON value starting at `start` (whitespace allowed). */
export function sliceJsonValue(text, start) {
  const i = skipWs(text, start);
  const ch = text[i];
  if (ch === '"') {
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === '"') return text.slice(i, j + 1);
      j += 1;
    }
    throw new Error('unterminated string');
  }
  if (ch === '{' || ch === '[') {
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (c === '\\') {
          j += 1;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === ch) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
    throw new Error('unterminated container');
  }
  const rest = text.slice(i);
  const m = rest.match(/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\b/);
  if (!m) throw new Error('no json value');
  return text.slice(i, i + m[0].length);
}

function parseJsonish(raw) {
  const text = String(raw)
    .replaceAll('"$undefined"', 'null')
    .replace(/:undefined\b/g, ':null');
  return JSON.parse(text);
}

function* rscStrings(html) {
  const needle = 'self.__next_f.push(';
  let from = 0;
  while (from < html.length) {
    const i = html.indexOf(needle, from);
    if (i < 0) return;
    const start = i + needle.length;
    try {
      const raw = sliceJsonValue(html, start);
      from = start + raw.length;
      const parsed = parseJsonish(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.length > 40) yield item;
        }
      }
    } catch {
      from = start + 1;
    }
  }
}

function extractKeyedArrays(text, key) {
  const needle = `"${key}":`;
  const out = [];
  let from = 0;
  while (from < text.length) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    const start = i + needle.length;
    try {
      const raw = sliceJsonValue(text, start);
      from = start + raw.length;
      const value = parseJsonish(raw);
      if (Array.isArray(value)) out.push(value);
    } catch {
      from = start + 1;
    }
  }
  return out;
}

function slugFromPath(path) {
  const s = String(path || '');
  const m = s.match(/\/models\/([a-z0-9-]+)/i);
  return m ? m[1] : '';
}

function modelUrl(slug, detailsUrl) {
  const raw = String(detailsUrl || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `https://artificialanalysis.ai${raw}`;
  if (slug) return `https://artificialanalysis.ai/models/${slug}`;
  return AA_INDEX_URL;
}

function roundScore(n) {
  return Math.round(Number(n));
}

function normalizeModel(row) {
  if (!row || typeof row !== 'object') return null;
  const scoreRaw = Number(row.intelligenceIndex ?? row.artificialAnalysisIntelligenceIndex);
  if (!Number.isFinite(scoreRaw)) return null;
  const creator = row.creator && typeof row.creator === 'object' ? row.creator : {};
  const label = String(row.shortName || row.label || row.name || '').trim();
  if (!label) return null;
  const slug = String(row.slug || '').trim() || slugFromPath(row.detailsUrl || row.url);
  return {
    label,
    name: String(row.name || label).trim(),
    slug,
    scoreRaw,
    score: roundScore(scoreRaw),
    creator: String(creator.name || row.modelCreatorName || '').trim(),
    color: String(creator.color || row.modelCreatorColor || '').trim(),
    openWeights: Boolean(row.isOpenWeights),
    url: modelUrl(slug, row.detailsUrl),
  };
}

function rankModels(rows) {
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const item = normalizeModel(row);
    if (!item) continue;
    const key = item.slug || item.label;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(item);
  }
  models.sort((a, b) => b.scoreRaw - a.scoreRaw || a.label.localeCompare(b.label));
  return models.map((item, i) => ({ ...item, rank: i + 1 }));
}

function scoreArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return -1;
  let n = 0;
  let selected = 0;
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    if (Number.isFinite(Number(row.intelligenceIndex ?? row.artificialAnalysisIntelligenceIndex))) n += 1;
    if (row.chartDefaultSelected === true) selected += 1;
  }
  if (n === 0) return -1;
  return selected * 1000 + n;
}

function modelsFromRsc(html) {
  let best = [];
  let bestScore = -1;
  for (const blob of rscStrings(html)) {
    if (!blob.includes('intelligenceIndex') && !blob.includes('artificialAnalysisIntelligenceIndex')) {
      continue;
    }
    for (const key of ['initialData', 'data', 'models']) {
      for (const arr of extractKeyedArrays(blob, key)) {
        const s = scoreArray(arr);
        if (s > bestScore) {
          bestScore = s;
          best = arr;
        }
      }
    }
  }
  if (bestScore < 0) return [];
  const selected = best.filter((row) => row && row.chartDefaultSelected === true);
  return rankModels(selected.length >= 8 ? selected : best);
}

function modelsFromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let best = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      const json = JSON.parse(m[1]);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const ranked = rankModels(data);
      if (ranked.length > best.length) best = ranked;
    } catch {
      /* ignore one script */
    }
  }
  return best;
}

function pageMeta(html) {
  const version = (String(html).match(/Intelligence Index v(\d+(?:\.\d+)?)/i) || [])[1] || '';
  const catalog = String(html).match(/(\d+)\s+of\s+(\d+)\s+models/i);
  return {
    version,
    catalogShown: catalog ? Number(catalog[1]) : 0,
    catalogTotal: catalog ? Number(catalog[2]) : 0,
  };
}

export function parseAaPage(html) {
  const text = String(html || '');
  if (!text) throw new AppError(CODES.AA_FAILED, 502, 'empty AA page');
  let models = modelsFromRsc(text);
  if (models.length < 8) {
    const ld = modelsFromJsonLd(text);
    if (ld.length > models.length) models = ld;
  }
  if (models.length < 5) {
    throw new AppError(CODES.AA_FAILED, 502, 'AA 榜数据不够');
  }
  const meta = pageMeta(text);
  return {
    kind: 'aa',
    version: meta.version,
    catalogShown: meta.catalogShown || models.length,
    catalogTotal: meta.catalogTotal,
    sourceUrl: AA_INDEX_URL,
    models,
  };
}

export async function fetchAaIndex({ force = false, now = Date.now() } = {}) {
  if (!force && cache?.board && now - cache.at < CACHE_TTL_MS) {
    return cache.board;
  }
  try {
    const res = await fetch(AA_PAGE_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,zh;q=0.8',
        'User-Agent': aaUserAgent(),
      },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) {
      throw new AppError(CODES.AA_FAILED, res.status, `AA HTTP ${res.status}`);
    }
    const html = await res.text();
    const board = parseAaPage(html);
    board.fetchedAt = new Date(now).toISOString();
    cache = { at: now, board };
    return board;
  } catch (err) {
    if (cache?.board && now - cache.at < STALE_MS) return cache.board;
    if (err instanceof AppError) throw err;
    throw new AppError(CODES.AA_FAILED, 502, err.message || 'AA fetch failed');
  }
}
