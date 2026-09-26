import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpText, isFollowUp, isOffTopic, normalizeText, parseIndex, route } from '../src/intent.js';

test('normalize strips at tokens', () => {
  assert.equal(normalizeText('@_user_1 今天有什么'), '今天有什么');
  assert.equal(normalizeText('<at user_id="ou_x">bot</at> 热点'), '热点');
});

test('help', () => {
  assert.equal(route('帮助').kind, 'help');
  assert.equal(route('你是谁').kind, 'help');
  assert.equal(route('').kind, 'help');
  assert.match(helpText(), /我是 \*\*AI 资讯\*\*/);
  assert.match(helpText(), /群里的 AI 资讯简报员/);
  const leaked = new RegExp(`${['Glow', '资讯'].join(' ')}|AIHOT|virxact|数据来自`, 'i');
  assert.equal(leaked.test(helpText()), false);
});

test('off-topic', () => {
  assert.equal(route('帮我写一个 python 爬虫').kind, 'off-topic');
  assert.equal(isOffTopic('写代码'), true);
});

test('latest today', () => {
  assert.deepEqual(route('今天有什么'), { kind: 'latest', window: '24h', category: null });
  assert.equal(route('过去24小时').kind, 'latest');
  assert.equal(route('过去24小时').window, '24h');
});

test('hot and daily', () => {
  assert.deepEqual(route('热点'), { kind: 'hot' });
  assert.deepEqual(route('日报'), { kind: 'daily' });
  assert.deepEqual(route('日报 2026-09-01'), { kind: 'daily', date: '2026-09-01' });
});

test('aa board', () => {
  assert.deepEqual(route('AA榜'), { kind: 'aa' });
  assert.equal(route('发一下AA榜单').kind, 'aa');
  assert.equal(route('模型榜').kind, 'aa');
  assert.equal(route('大模型排行榜').kind, 'aa');
  assert.equal(route('现在哪个模型最强').kind, 'aa');
  assert.equal(route('OpenAI 有什么新消息').kind, 'search');
  assert.equal(helpText().includes('AA榜'), true);
});

test('codex reset calendar', () => {
  assert.equal(route('Tibo重置').kind, 'codex');
  assert.equal(route('codex重置').kind, 'codex');
  assert.equal(route('重置卡').kind, 'codex');
  assert.equal(route('重置预测').kind, 'codex');
  assert.equal(route('下次重置什么时候').kind, 'codex');
  assert.equal(route('codex 有什么新闻').kind, 'search');
  assert.equal(helpText().includes('Tibo重置'), true);
});

test('search company', () => {
  const r = route('OpenAI 有什么新消息');
  assert.equal(r.kind, 'search');
  assert.match(r.q, /OpenAI/i);
});

test('search with category and week', () => {
  const r = route('最近一周论文');
  assert.equal(r.kind, 'latest');
  assert.equal(r.window, '7d');
  assert.equal(r.category, 'paper');
});

test('follow-up index', () => {
  assert.equal(parseIndex('第2条详细说说'), 2);
  assert.equal(isFollowUp('第3名'), true);
  assert.equal(isFollowUp('来龙去脉'), true);
  assert.equal(isFollowUp('今天有什么'), false);
});
