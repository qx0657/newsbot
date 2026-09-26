import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR ||= mkdtempSync(join(tmpdir(), 'newsbot-codex-'));

const {
  compactEvent,
  fetchCodexResets,
  fingerprintOf,
  forecastDirectResets,
  isLiveAnnounced,
  newCodexChanges,
  parseCodexResets,
  resetCodexCache,
  summarizeCodex,
} = await import('../src/codex.js');
const { answer } = await import('../src/brief.js');
const { buildCodexCard, buildCodexEventCard, codexEventMarkdown, codexToMarkdown } = await import('../src/card.js');
const { helpText, route } = await import('../src/intent.js');
const { loadCodexSeen, openDb, saveCodexSeen } = await import('../src/quota.js');
const { codexUuid, runCodexWatch } = await import('../src/codex-watch.js');

openDb();

const NOW = Date.parse('2026-09-13T17:00:00+08:00');

function sampleEvents() {
  return [
    {
      id: 'reset-pending',
      type: 'direct_reset',
      label: '全员重置',
      status: 'announced',
      title: 'Tibo 预告将重置额度',
      scope: '所有付费订阅',
      createdAt: '2026-09-13T11:00:00.000+08:00',
      updatedAt: '2026-09-13T11:00:00.000+08:00',
      confirmedAt: null,
      occurredOn: null,
      schedule: {
        precision: 'deadline',
        from: '2026-09-13T15:00:00.000+08:00',
        through: '2026-09-13T15:00:00.000+08:00',
        label: '北京时间预计 9月13日 15:00 前',
      },
      posts: [
        {
          id: '1',
          publishedAt: '2026-09-13T11:00:00.000+08:00',
          stage: '预告',
          text: '今天午夜前还会有一个重置落地。',
          originalText: 'a reset is also landing by midnight today',
          url: 'https://x.com/thsottiaux/status/1',
        },
      ],
      url: 'https://aihot.news/codex-reset',
    },
    {
      id: 'reset-done',
      type: 'direct_reset',
      label: '全员重置',
      status: 'confirmed',
      title: 'Codex 额度重置已完成',
      scope: '',
      createdAt: '2026-09-12T11:20:36.000+08:00',
      updatedAt: '2026-09-12T16:09:17.000+08:00',
      confirmedAt: '2026-09-12T16:09:17.000+08:00',
      occurredOn: null,
      schedule: {
        precision: 'deadline',
        from: '2026-09-12T15:00:00.000+08:00',
        through: '2026-09-12T15:00:00.000+08:00',
        label: '北京时间预计 9月12日 15:00 前',
      },
      posts: [
        {
          id: '2',
          publishedAt: '2026-09-12T16:09:17.000+08:00',
          stage: '确认完成',
          text: '重置已全部生效。好梦。',
          originalText: 'Reset all propagated.',
          url: 'https://x.com/thsottiaux/status/2',
        },
      ],
      url: 'https://aihot.news/codex-reset',
    },
    {
      id: 'banked-old',
      type: 'reset_credit',
      label: '发重置卡',
      status: 'confirmed',
      title: '重置卡已发放',
      scope: 'Plus、Pro、Business',
      createdAt: '2026-09-05T04:57:17.000+08:00',
      updatedAt: '2026-09-13T10:36:02.000+08:00',
      confirmedAt: null,
      occurredOn: '2026-09-05',
      schedule: {
        precision: 'deadline',
        from: '2026-09-05T15:00:00.000+08:00',
        through: '2026-09-05T15:00:00.000+08:00',
        label: '北京时间预计 9月5日 15:00 前',
      },
      posts: [
        {
          id: '3',
          publishedAt: '2026-09-05T08:39:25.000+08:00',
          stage: '发卡预告',
          text: '我们今天也将为所有 Plus、Pro 和 Business 用户发放完整的重置卡。',
          originalText: 'we will do the full banked reset today too',
          url: 'https://x.com/thsottiaux/status/3',
        },
      ],
      url: 'https://aihot.news/codex-reset',
    },
    {
      id: 'reset-stale-announced',
      type: 'direct_reset',
      label: '全员重置',
      status: 'announced',
      title: 'Tibo 预告将重置额度',
      scope: '',
      createdAt: '2026-08-31T03:24:37.000+08:00',
      updatedAt: '2026-08-31T03:24:37.000+08:00',
      confirmedAt: null,
      occurredOn: null,
      schedule: {
        precision: 'window',
        from: '2026-08-31T09:00:00.000+08:00',
        through: '2026-08-31T10:00:00.000+08:00',
        label: '北京时间预计 8月31日 09:00–10:00',
      },
      posts: [
        {
          id: '4',
          publishedAt: '2026-08-31T03:24:37.000+08:00',
          stage: '预告',
          text: '你们的 Codex 重置将在太平洋标准时间下午6点到来。',
          originalText: 'Your Codex reset will land at 6pm PST.',
          url: 'https://x.com/thsottiaux/status/4',
        },
      ],
      url: 'https://aihot.news/codex-reset',
    },
  ];
}

function sampleBody(events = sampleEvents()) {
  return {
    schemaVersion: 1,
    timezone: 'Asia/Shanghai',
    checkedAt: '2026-09-13T17:18:39.962+08:00',
    historyFrom: '2026-06-12T00:00:00.000+08:00',
    count: events.length,
    events,
  };
}

test('route Tibo / Codex reset, not generic news', () => {
  assert.equal(route('Tibo重置').kind, 'codex');
  assert.equal(route('tibo 重置了吗').kind, 'codex');
  assert.equal(route('codex额度重置').kind, 'codex');
  assert.equal(route('重置卡到了吗').kind, 'codex');
  assert.equal(route('全员重置').kind, 'codex');
  assert.equal(route('重置预测').kind, 'codex');
  assert.equal(route('下次重置什么时候').kind, 'codex');
  assert.equal(route('codex 有什么新闻').kind, 'search');
  assert.equal(route('OpenAI 有什么新消息').kind, 'search');
  assert.equal(helpText().includes('Tibo重置'), true);
});

test('stale announced is history, live announced is pending', () => {
  const events = sampleEvents().map(compactEvent);
  const stale = events.find((e) => e.id === 'reset-stale-announced');
  const live = events.find((e) => e.id === 'reset-pending');
  assert.equal(isLiveAnnounced(stale, NOW), false);
  assert.equal(isLiveAnnounced(live, NOW), true);
  const summary = summarizeCodex(events, NOW);
  assert.equal(summary.pending.id, 'reset-pending');
  assert.equal(summary.hero.id, 'reset-pending');
  assert.equal(summary.items[0].id, 'reset-pending');
  assert.equal(summary.items[1].id, 'reset-done');
});

test('receipt_review updatedAt does not jump old banked cards to the top', () => {
  const events = sampleEvents().map(compactEvent);
  const summary = summarizeCodex(events, NOW);
  assert.equal(
    summary.items.some((e, i) => e.id === 'banked-old' && i === 0),
    false,
  );
});

test('parse and cards do not guess the next reset', () => {
  const cal = parseCodexResets(sampleBody(), NOW);
  const md = codexToMarkdown(cal);
  assert.match(md, /未确认预告/);
  assert.equal(/下一次.*(会是|预计|应该)/.test(md), false);
  const card = buildCodexCard(cal);
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'orange');
  assert.equal(card.header.icon.token, 'calendar_colorful');
  assert.deepEqual(
    card.body.elements.map((el) => el.tag),
    ['interactive_container', 'markdown', 'button'],
  );
  assert.match(card.body.elements[1].content, /^2\. /m);
  const eventCard = buildCodexEventCard(cal.hero, cal);
  assert.equal(eventCard.header.template, 'orange');
  assert.match(codexEventMarkdown(cal.hero), /所有付费订阅/);
});

test('no live pending says so instead of forecasting', () => {
  const events = sampleEvents().filter((e) => e.id !== 'reset-pending');
  const cal = parseCodexResets(sampleBody(events), NOW);
  assert.equal(cal.pending, null);
  assert.equal(cal.forecast, null);
  assert.match(codexToMarkdown(cal), /目前没有未确认的预告/);
  assert.equal(buildCodexCard(cal).header.template, 'green');
});

test('historical forecast matches aihot.news lognormal estimate', () => {
  const confirmedAt = [
    '2026-06-18T08:10:10.000+08:00',
    '2026-06-28T05:47:54.000+08:00',
    '2026-06-29T07:54:07.000+08:00',
    '2026-07-11T01:59:43.000+08:00',
    '2026-07-11T22:51:08.000+08:00',
    '2026-07-18T11:28:22.000+08:00',
    '2026-07-26T03:17:12.000+08:00',
    '2026-07-28T11:09:23.000+08:00',
    '2026-07-29T12:09:02.000+08:00',
    '2026-08-01T11:32:37.000+08:00',
    '2026-08-09T04:29:22.000+08:00',
    '2026-08-11T08:27:44.000+08:00',
    '2026-08-24T08:46:51.000+08:00',
    '2026-08-26T02:20:36.000+08:00',
    '2026-08-28T00:35:05.000+08:00',
    '2026-08-31T10:34:27.000+08:00',
    '2026-09-08T12:05:53.000+08:00',
    '2026-09-12T16:09:17.000+08:00',
  ];
  const events = confirmedAt.map((at, i) => ({
    id: `reset-${i}`,
    type: 'direct_reset',
    status: 'confirmed',
    title: 'Codex 额度重置已完成',
    createdAt: at,
    updatedAt: at,
    confirmedAt: at,
    posts: [{ id: String(i), publishedAt: at, stage: '确认完成', text: 'ok', url: 'https://x.com/x/1' }],
  }));
  const asOf = '2026-09-13T17:36:16.442+08:00';
  const forecast = forecastDirectResets(events.map(compactEvent), asOf);
  assert.equal(forecast.sampleCount, 18);
  assert.deepEqual(
    forecast.probabilities.map((row) => [row.day, Math.round(100 * row.probability)]),
    [
      ['2026-09-13', 5],
      ['2026-09-14', 20],
      ['2026-09-15', 17],
    ],
  );
  assert.equal(Math.round(100 * forecast.laterProbability), 59);

  const cal = parseCodexResets({ ...sampleBody(events), checkedAt: asOf }, Date.parse(asOf));
  assert.equal(cal.pending, null);
  assert.equal(cal.forecast.sampleCount, 18);
  assert.match(codexToMarkdown(cal), /重置预测/);
  assert.match(codexToMarkdown(cal), /仅供参考/);
  const card = buildCodexCard(cal);
  assert.equal(card.header.template, 'blue');
  assert.equal(card.body.elements[0].element_id, 'cxPred');
  assert.equal(card.body.elements[0].elements[1].flex_mode, 'trisect');
  assert.match(card.body.elements[0].elements[0].content, /仅供参考/);
});

test('live announcement suppresses historical forecast', () => {
  const cal = parseCodexResets(sampleBody(), NOW);
  assert.equal(cal.pending.id, 'reset-pending');
  assert.equal(cal.forecast, null);
});

test('diff seeds first snapshot then reports new fingerprints', () => {
  const cal = parseCodexResets(sampleBody(), NOW);
  const first = newCodexChanges([], cal);
  assert.equal(first.seed, true);
  assert.equal(first.changes.length, 0);
  const confirmed = {
    ...cal,
    events: cal.events.map((e) =>
      e.id === 'reset-pending' ? { ...e, status: 'confirmed', title: 'Codex 额度重置已完成' } : e,
    ),
  };
  const second = newCodexChanges(first.fingerprints, confirmed);
  assert.equal(second.seed, false);
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].id, 'reset-pending');
  assert.equal(fingerprintOf(second.changes[0]), 'reset-pending:confirmed');
});

test('answer Tibo重置 does not call Grok and supports 第N条', async () => {
  resetCodexCache();
  const orig = globalThis.fetch;
  const realNow = Date.now;
  Date.now = () => NOW;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => sampleBody(),
  });
  try {
    const first = await answer({ text: 'Tibo重置', chatId: 'oc_t', openId: 'ou_t' });
    assert.equal(first.intent, 'codex');
    assert.equal(first.usedGrok, false);
    assert.equal(first.card.schema, '2.0');
    assert.match(first.markdown, /未确认预告/);

    const item = await answer({ text: '第2条', chatId: 'oc_t', openId: 'ou_t' });
    assert.equal(item.intent, 'codex-item');
    assert.equal(item.usedGrok, false);
    assert.equal(item.card.schema, '2.0');
    assert.match(item.markdown, /Codex 额度重置已完成/);
  } finally {
    globalThis.fetch = orig;
    Date.now = realNow;
    resetCodexCache();
  }
});

test('codex uuid is stable and within Feishu 50-char limit', () => {
  const a = codexUuid('reset-pending:announced', 'oc_demo_group_alpha');
  const b = codexUuid('reset-pending:announced', 'oc_demo_group_alpha');
  const c = codexUuid('reset-pending:confirmed', 'oc_demo_group_beta');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.startsWith('nb-cx-'), true);
  assert.equal(a.length <= 50, true);
});

test('watcher seeds without sending, then pushes new events to 开通 groups', async () => {
  resetCodexCache();
  saveCodexSeen([]);
  const chats = ['oc_test_a', 'oc_test_b'];
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => sampleBody(),
  });
  try {
    const seed = await runCodexWatch({
      now: NOW,
      chats,
      sendCard: async (chatId) => {
        sent.push(chatId);
      },
    });
    assert.equal(seed.seed, true);
    assert.deepEqual(sent, []);
    assert.equal(loadCodexSeen().length > 0, true);

    const nextEvents = [
      {
        id: 'reset-new',
        type: 'direct_reset',
        label: '全员重置',
        status: 'announced',
        title: 'Tibo 预告将重置额度',
        scope: '',
        createdAt: '2026-09-13T18:00:00.000+08:00',
        updatedAt: '2026-09-13T18:00:00.000+08:00',
        confirmedAt: null,
        occurredOn: null,
        schedule: {
          precision: 'window',
          from: '2026-09-13T20:00:00.000+08:00',
          through: '2026-09-13T21:00:00.000+08:00',
          label: '北京时间预计 9月13日 20:00–21:00',
        },
        posts: [
          {
            id: '9',
            publishedAt: '2026-09-13T18:00:00.000+08:00',
            stage: '预告',
            text: '再来一次重置。',
            originalText: 'another reset',
            url: 'https://x.com/thsottiaux/status/9',
          },
        ],
        url: 'https://aihot.news/codex-reset',
      },
      ...sampleEvents(),
    ];
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => sampleBody(nextEvents),
    });
    resetCodexCache();
    const push = await runCodexWatch({
      now: NOW,
      chats,
      sendCard: async (chatId, card) => {
        sent.push({ chatId, title: card.header.title.content });
      },
    });
    assert.equal(push.seed, false);
    assert.equal(push.changes.length, 1);
    assert.deepEqual(
      sent.map((row) => row.chatId).sort(),
      ['oc_test_a', 'oc_test_b'],
    );
  } finally {
    globalThis.fetch = orig;
    resetCodexCache();
    saveCodexSeen([]);
  }
});
