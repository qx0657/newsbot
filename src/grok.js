import { config } from './config.js';
import { AppError, CODES } from './errors.js';
import { liveModel } from './quota.js';
import { getAccessToken } from './xai-token.js';

const SYSTEM = `你是 AI 资讯机器人，不是通用助手。

规则：
- 只根据用户消息后面的「资料」JSON 回答。
- 禁止写代码、改配置、闲聊、编造资料里没有的新闻、调用任何工具或上网。
- 若问题与 AI 资讯无关，或资料不足以回答：用一两句说明你只做 AI 资讯简报，并提示可以问「今天」「热点」「日报」或某个公司/产品。不要硬凑。
- 默认中文简报，3–8 条。每条标题用 Markdown 链接到 url 字段。
- reason 非空时用它写「为什么值得关注」，不要改写成更强的判断；为 null 就别编。
- 数字、政策、原话不要说得比资料更确定。
- 热点按 rank 显示「第 N 名」，不要推算热度值。
- 日报保留 lead / 分组，不要装成滚动资讯列表。
- 不要提及资料从哪来，不要写「数据来自…」，不要出现数据源名字。
- 不要输出工具调用、JSON、或「作为 AI」之类套话。`;

const SYSTEM_DIGEST = `你在写「AI 资讯 · 早报」的条目。只输出 JSON 数组，不要 markdown、不要代码围栏、不要前言后记。

每项字段：
{"title":"中文短标题，不超过 28 字","summary":"一两句简介，不超过 60 字","source":"来源名","url":"原文链接"}

规则：
- 5 到 8 条，顺序对应资料 items。
- title 是标题，不要编号、不要做成链接。
- summary 是简介，不要重复标题，不要写「为什么值得关注」。
- source、url 必须原样拷贝资料里的字段。有 source 就不要改成「来源」两个字。
- 只根据资料，禁止编造。`;

export function stripSourceLine(text) {
  return String(text || '')
    .replace(/\n[ \t]*[（(]?\s*(数据来自|资料来自|来源)[^\n]*/gu, '')
    .replace(/^[ \t]*[（(]?\s*(数据来自|资料来自|来源)[^\n]*\n?/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function forGrok(value) {
  if (Array.isArray(value)) return value.map(forGrok);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'original' && v) {
        out.url = v;
        continue;
      }
      if (k === 'aihot') {
        if (out.url == null) out.url = v;
        continue;
      }
      out[k] = forGrok(v);
    }
    return out;
  }
  return value;
}

export function parseDigestItems(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : raw).trim();
  const start = jsonText.indexOf('[');
  const objStart = jsonText.indexOf('{');
  let slice = '';
  if (start >= 0) {
    const end = jsonText.lastIndexOf(']');
    if (end > start) slice = jsonText.slice(start, end + 1);
  } else if (objStart >= 0) {
    const end = jsonText.lastIndexOf('}');
    if (end > objStart) slice = jsonText.slice(objStart, end + 1);
  }
  if (!slice) return [];
  let parsed;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return list.slice(0, 8).map(normalizeDigestItem).filter(Boolean);
}

function httpUrl(value) {
  const u = String(value || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

function normalizeDigestItem(it) {
  if (!it || typeof it !== 'object') return null;
  const title = String(it.title || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const summary = String(it.summary || it.desc || '').replace(/\s+/g, ' ').trim();
  const source = String(it.source || '').replace(/\s+/g, ' ').trim() || '来源';
  const url = httpUrl(it.url || it.original);
  return {
    title: title.slice(0, 80),
    summary: summary.slice(0, 200),
    source: source.slice(0, 80),
    url,
  };
}

export function mergeDigestItems(generated, evidence) {
  const src = digestEvidence(evidence).items;
  const rows = generated?.length ? generated : src.map((it) => ({
    title: it.title,
    summary: it.summary || '',
    source: it.source || '来源',
    url: it.url || '',
  }));
  return rows.map((it, i) => {
    const ev = src[i] || {};
    return {
      title: it.title || ev.title || '',
      summary: it.summary || ev.summary || '',
      source: it.source && it.source !== '来源' ? it.source : ev.source || it.source || '来源',
      url: httpUrl(it.url) || httpUrl(ev.url) || '',
    };
  }).filter((it) => it.title);
}

export function digestEvidence(evidence) {
  const src = forGrok(evidence);
  const raw = src.items || src.reports || [];
  const items = raw.slice(0, 8).map((it) => {
    if (!it || typeof it !== 'object') return null;
    const row = {
      title: it.title || null,
      summary: it.summary || null,
      source: it.source || null,
      url: it.url || null,
    };
    for (const k of Object.keys(row)) {
      if (row[k] == null || row[k] === '') delete row[k];
    }
    return row.title || row.summary ? row : null;
  }).filter(Boolean);
  return { items };
}

export async function grokBrief({ question, evidence, maxTokens, style = 'chat' }) {
  const digest = style === 'digest';
  const payload = digest ? digestEvidence(evidence) : forGrok(evidence);
  const tokens = maxTokens ?? (digest ? 800 : 1200);
  const token = await getAccessToken();
  const user = `用户问题：${question}\n\n资料：\n${JSON.stringify(payload, null, 2)}`;
  let res;
  try {
    res = await fetch(`${config.xaiApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: liveModel(),
        temperature: 0.2,
        max_tokens: tokens,
        messages: [
          { role: 'system', content: digest ? SYSTEM_DIGEST : SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(digest ? 20_000 : 60_000),
    });
  } catch (err) {
    const timedOut =
      err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.name === 'DOMException';
    if (timedOut) throw new AppError(CODES.XAI_UPSTREAM, 504, 'grok 超时');
    throw err;
  }
  if (res.status === 429) throw new AppError(CODES.XAI_QUOTA_EXHAUSTED, 429);
  if (res.status === 401) throw new AppError(CODES.XAI_AUTH_REQUIRED, 401, 'chat 401');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AppError(CODES.XAI_UPSTREAM, res.status, `grok HTTP ${res.status} ${detail.slice(0, 240)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new AppError(CODES.XAI_UPSTREAM, 502, 'grok 空回复');
  }
  if (data.choices?.[0]?.finish_reason === 'length') {
    console.warn(new Date().toISOString(), 'grok truncated', { style, tokens });
  }
  return stripSourceLine(text);
}
