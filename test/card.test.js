import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAaCard, buildMorningCard, clipText, itemMarkdown, morningHeaderDate } from '../src/card.js';

test('header date is month-day weekday without leading zero', () => {
  assert.equal(morningHeaderDate('2026-09-03'), '9月3日 周四');
  assert.equal(morningHeaderDate('2026-08-20'), '8月20日 周四');
});

test('item markdown is title then grey summary then named source link', () => {
  const md = itemMarkdown({
    title: 'Cursor 推出 Self-Hosted Machines',
    summary: '云智能体的工具执行迁到企业自有机器。',
    source: 'Cursor Blog',
    url: 'https://cursor.com/blog/self-hosted-machines',
  });
  assert.match(md, /^\*\*Cursor 推出 Self-Hosted Machines\*\*\n/);
  assert.match(md, /<font color='grey'>云智能体的工具执行迁到企业自有机器。<\/font>/);
  assert.match(md, /\[Cursor Blog\]\(https:\/\/cursor.com\/blog\/self-hosted-machines\)/);
  assert.equal(md.includes('[来源]'), false);
});

test('clipText keeps short text and cuts long copy at a pause', () => {
  assert.equal(clipText('短标题', 32), '短标题');
  const long =
    '美国司法部向曼哈顿联邦法院提交利益声明，介入纽约时报诉 OpenAI 版权案，支持训练属合理使用，并以国家安全和产业竞争力为主要论据，同时梳理了双方核心论点。';
  const out = clipText(long, 72);
  assert.equal(out.endsWith('…'), true);
  assert.equal(out.length < long.length, true);
});

test('morning card is schema 2.0 with blue header and one block per item', () => {
  const card = buildMorningCard({
    day: '2026-09-03',
    items: [
      {
        title: 'GitHub Copilot 降本',
        summary: '四项改动压缩 token。',
        source: 'GitHub Blog',
        url: 'https://github.blog/a',
      },
      {
        title: '第二项',
        summary: '简介',
        source: 'X：Claude (@claudeai)',
        url: 'https://x.com/claudeai/1',
      },
    ],
  });
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'blue');
  assert.equal(card.header.title.content, 'AI 资讯 · 早报');
  assert.equal(card.header.subtitle.content, '9月3日 周四');
  assert.equal(card.header.icon.token, 'myai_colorful');
  assert.equal(card.body.elements.length, 2);
  assert.equal(card.body.elements[0].tag, 'markdown');
  assert.match(card.body.elements[1].content, /\[X：Claude \(@claudeai\)\]/);
});

test('aa card is chart-only with high score first and a fill-width link', () => {
  const card = buildAaCard({
    version: '4.3',
    catalogTotal: 644,
    sourceUrl: 'https://artificialanalysis.ai/#artificial-analysis-intelligence-index',
    fetchedAt: '2026-09-08T05:58:00.000Z',
    models: [
      {
        rank: 1,
        label: 'Claude Fable 5.1 (max with fallback)',
        score: 53,
        creator: 'Anthropic',
        color: '#cc785c',
        openWeights: false,
        url: 'https://artificialanalysis.ai/models/claude-fable-5-1',
      },
      {
        rank: 2,
        label: 'GLM-5.3 (max)',
        score: 45,
        creator: 'Z AI',
        color: '#1c7ff8',
        openWeights: true,
        url: 'https://artificialanalysis.ai/models/glm-5-3',
      },
    ],
  });
  assert.equal(card.config.width_mode, 'fill');
  assert.equal(card.header.title.content, 'Artificial Analysis Intelligence Index');
  assert.equal(card.header.subtitle.content, '9月8日 13:58');
  assert.deepEqual(
    card.body.elements.map((el) => el.tag),
    ['chart', 'button'],
  );
  assert.equal(card.body.elements[0].chart_spec.color.type, 'ordinal');
  assert.equal(card.body.elements[0].chart_spec.data.values[0].score, 53);
  assert.equal(card.body.elements[0].chart_spec.data.values[1].score, 45);
  assert.equal(card.body.elements[1].width, 'fill');
  assert.equal(card.body.elements[0].chart_spec.background, undefined);
  assert.equal(card.body.elements[0].chart_spec.barBackground.visible, false);
  assert.equal(card.body.elements[0].chart_spec.bar.state.hover.lineWidth, 2);
  assert.equal(card.body.elements[0].chart_spec.bar.state.dimension_hover.lineWidth, 2);
  assert.equal(card.body.elements[0].chart_spec.select.enable, false);
});
