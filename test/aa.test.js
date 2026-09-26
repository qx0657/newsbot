import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR ||= mkdtempSync(join(tmpdir(), 'newsbot-aa-'));

const { fetchAaIndex, parseAaPage, resetAaCache, sliceJsonValue } = await import('../src/aa.js');
const { answer } = await import('../src/brief.js');
const { buildAaCard, aaToMarkdown, aaItemMarkdown, shanghaiStamp } = await import('../src/card.js');
const { route } = await import('../src/intent.js');
const { openDb } = await import('../src/quota.js');

openDb();

function sampleModels(n = 6) {
  const rows = [
    {
      shortName: 'Claude Fable 5.1 (max with fallback)',
      name: 'Claude Fable 5.1',
      slug: 'claude-fable-5-1',
      intelligenceIndex: 53.37,
      chartDefaultSelected: true,
      isOpenWeights: false,
      creator: { name: 'Anthropic', color: '#cc785c' },
    },
    {
      shortName: 'GPT-6 Astra (max)',
      name: 'GPT-6 Astra (max)',
      slug: 'gpt-6-astra',
      intelligenceIndex: 52.81,
      chartDefaultSelected: true,
      isOpenWeights: false,
      creator: { name: 'OpenAI', color: '#1f1f1f' },
    },
    {
      shortName: 'GLM-5.3 (max)',
      name: 'GLM-5.3 (max)',
      slug: 'glm-5-3',
      intelligenceIndex: 44.86,
      chartDefaultSelected: true,
      isOpenWeights: true,
      creator: { name: 'Z AI', color: '#1c7ff8' },
    },
    {
      shortName: 'Grok 4.6 (high)',
      name: 'Grok 4.6 (high)',
      slug: 'grok-4-6',
      intelligenceIndex: 44.41,
      chartDefaultSelected: true,
      isOpenWeights: false,
      creator: { name: 'SpaceXAI', color: '#736cd3' },
    },
    {
      shortName: 'Kimi K3 (max)',
      name: 'Kimi K3 (max)',
      slug: 'kimi-k3',
      intelligenceIndex: 43.78,
      chartDefaultSelected: true,
      isOpenWeights: true,
      creator: { name: 'Kimi', color: '#047AFE' },
    },
    {
      shortName: 'GPT-5.5 Pro (xhigh)',
      name: 'GPT-5.5 Pro (xhigh)',
      slug: 'gpt-5-5-pro',
      intelligenceIndex: null,
      chartDefaultSelected: true,
      isOpenWeights: false,
      creator: { name: 'OpenAI', color: '#1f1f1f' },
    },
    {
      shortName: 'MiniMax-M3',
      name: 'MiniMax-M3',
      slug: 'minimax-m3',
      intelligenceIndex: 29.61,
      chartDefaultSelected: true,
      isOpenWeights: true,
      creator: { name: 'MiniMax', color: '#EB3568' },
    },
  ];
  return rows.slice(0, Math.max(n, rows.length));
}

function rscHtml(models) {
  const blob = `21:${JSON.stringify(['$', '$L29', null, { initialData: models }])}`;
  return `<!doctype html><html>Artificial Analysis Intelligence Index v4.3 24 of 644 models<script>self.__next_f.push([1,${JSON.stringify(blob)}])</script></html>`;
}

test('sliceJsonValue reads strings objects arrays', () => {
  assert.equal(sliceJsonValue('  "ab\\nc"', 0), '"ab\\nc"');
  assert.equal(sliceJsonValue('[1,{"a":[2]}]', 0), '[1,{"a":[2]}]');
  assert.equal(sliceJsonValue('{"x":true}', 0), '{"x":true}');
  assert.equal(sliceJsonValue(' 12.5, rest', 0), '12.5');
});

test('parseAaPage reads RSC default comparison set and drops null scores', () => {
  const board = parseAaPage(rscHtml(sampleModels()));
  assert.equal(board.kind, 'aa');
  assert.equal(board.version, '4.3');
  assert.equal(board.catalogTotal, 644);
  assert.equal(board.models.length, 6);
  assert.equal(board.models[0].label, 'Claude Fable 5.1 (max with fallback)');
  assert.equal(board.models[0].score, 53);
  assert.equal(board.models[0].creator, 'Anthropic');
  assert.equal(board.models[0].url, 'https://artificialanalysis.ai/models/claude-fable-5-1');
  assert.equal(board.models.some((m) => m.slug === 'gpt-5-5-pro'), false);
  assert.equal(board.models.find((m) => m.slug === 'glm-5-3').openWeights, true);
});

test('parseAaPage falls back to JSON-LD chart data', () => {
  const data = [
    { label: 'A', artificialAnalysisIntelligenceIndex: 50, detailsUrl: '/models/a' },
    { label: 'B', artificialAnalysisIntelligenceIndex: 40, detailsUrl: '/models/b' },
    { label: 'C', artificialAnalysisIntelligenceIndex: 30, detailsUrl: '/models/c' },
    { label: 'D', artificialAnalysisIntelligenceIndex: 20, detailsUrl: '/models/d' },
    { label: 'E', artificialAnalysisIntelligenceIndex: 10, detailsUrl: '/models/e' },
  ];
  const html = `<html><script type="application/ld+json">${JSON.stringify({ data })}</script></html>`;
  const board = parseAaPage(html);
  assert.equal(board.models[0].label, 'A');
  assert.equal(board.models[0].score, 50);
  assert.equal(board.models[4].slug, 'e');
});

test('fetchAaIndex caches within TTL and serves stale on failure', async () => {
  resetAaCache();
  const html = rscHtml(sampleModels());
  let n = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return { ok: true, status: 200, text: async () => html };
    throw new Error('down');
  };
  try {
    const a = await fetchAaIndex({ force: true, now: 1_000 });
    const b = await fetchAaIndex({ now: 1_000 + 10_000 });
    assert.equal(n, 1);
    assert.equal(a.models[0].slug, b.models[0].slug);
    const stale = await fetchAaIndex({ now: 1_000 + 2 * 60 * 60 * 1000 });
    assert.equal(n, 2);
    assert.equal(stale.models[0].slug, 'claude-fable-5-1');
  } finally {
    globalThis.fetch = orig;
    resetAaCache();
  }
});

test('buildAaCard is schema 2.0 with descending chart and no table', () => {
  const board = parseAaPage(rscHtml(sampleModels()));
  board.fetchedAt = '2026-09-08T05:58:00.000Z';
  const card = buildAaCard(board);
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'blue');
  assert.equal(card.header.title.content, 'Artificial Analysis Intelligence Index');
  assert.equal(card.header.subtitle.content, '9月8日 13:58');
  assert.equal(card.header.text_tag_list, undefined);
  const tags = card.body.elements.map((el) => el.tag);
  assert.deepEqual(tags, ['chart', 'button']);
  const values = card.body.elements[0].chart_spec.data.values;
  assert.equal(card.body.elements[0].chart_spec.direction, 'horizontal');
  assert.equal(values[0].score >= values[values.length - 1].score, true);
  assert.equal(values[0].model.includes('Claude Fable'), true);
  const openaiIdx = card.body.elements[0].chart_spec.color.domain.indexOf('OpenAI');
  assert.equal(openaiIdx >= 0, true);
  assert.equal(card.body.elements[0].chart_spec.color.range[openaiIdx].toLowerCase(), '#1f1f1f');
  assert.equal(card.body.elements[0].chart_spec.background, undefined);
  assert.equal(card.body.elements[0].chart_spec.bar.state.hover.stroke, '#ffffff');
  assert.equal(card.body.elements[0].chart_spec.bar.state.dimension_hover.stroke, '#ffffff');
  assert.equal(card.body.elements[0].chart_spec.barBackground.visible, false);
  assert.equal(card.body.elements[1].behaviors[0].type, 'open_url');
  assert.match(aaToMarkdown(board), /Claude Fable 5\.1/);
  assert.match(aaItemMarkdown(board.models[2]), /第 3 名/);
});

test('shanghaiStamp uses Shanghai clock', () => {
  assert.equal(shanghaiStamp('2026-09-08T05:58:00.000Z'), '9月8日 13:58');
});

test('route AA榜 before news search', () => {
  assert.equal(route('AA榜').kind, 'aa');
  assert.equal(route('看看 aa 指数').kind, 'aa');
  assert.equal(route('Artificial Analysis Intelligence Index').kind, 'aa');
  assert.equal(route('今天有什么').kind, 'latest');
});

test('answer AA榜 does not call Grok and supports 第N名', async () => {
  resetAaCache();
  const html = rscHtml(sampleModels());
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => html });
  try {
    const first = await answer({ text: 'AA榜', chatId: 'oc_t', openId: 'ou_t' });
    assert.equal(first.intent, 'aa');
    assert.equal(first.usedGrok, false);
    assert.equal(first.card.schema, '2.0');
    assert.match(first.markdown, /Grok 4\.6/);

    const item = await answer({ text: '第4名', chatId: 'oc_t', openId: 'ou_t' });
    assert.equal(item.intent, 'aa-item');
    assert.equal(item.usedGrok, false);
    assert.equal(item.card, undefined);
    assert.match(item.markdown, /Grok 4\.6/);
  } finally {
    globalThis.fetch = orig;
    resetAaCache();
  }
});
