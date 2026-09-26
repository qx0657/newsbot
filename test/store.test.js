import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'newsbot-'));
process.env.DATA_DIR = dir;

const {
  allowChat,
  chatAllowlist,
  claimMorningChats,
  consumeQuota,
  displayChatName,
  displayUserName,
  getProfile,
  liveCaps,
  liveModel,
  listTurns,
  markMorningSent,
  morningAllowlist,
  morningDueToday,
  morningBriefCache,
  morningDefaultTime,
  morningTimeSlots,
  mutateAllowlist,
  normalizeMorningTime,
  openDb,
  setAllowlist,
  setMorningArmedAt,
  pendingMorningChats,
  recordDenial,
  recordTurn,
  releaseMorningClaim,
  listDenials,
  clearDenial,
  saveMorningBriefCache,
  setMorningDefaultTime,
  setProfile,
  setSetting,
  shanghaiDay,
  shanghaiHm,
  shanghaiDayBounds,
  usageRows,
} = await import('../src/quota.js');

test('allowlist add and remove', () => {
  openDb();
  assert.deepEqual(chatAllowlist(), []);
  const added = mutateAllowlist('chat', 'oc_abc', 'add');
  assert.deepEqual(added, ['oc_abc']);
  assert.deepEqual(chatAllowlist(), ['oc_abc']);
  mutateAllowlist('chat', 'oc_abc', 'remove');
  assert.deepEqual(chatAllowlist(), []);
});

test('reject bad id', () => {
  assert.throws(() => mutateAllowlist('chat', 'ou_nope', 'add'));
});

test('group must be checked in; p2p off by default', () => {
  assert.equal(allowChat({ chatType: 'group', chatId: 'oc_a' }), false);
  mutateAllowlist('chat', 'oc_a', 'add');
  assert.equal(allowChat({ chatType: 'group', chatId: 'oc_a' }), true);
  assert.equal(allowChat({ chatType: 'group', chatId: 'oc_b' }), false);
  assert.equal(allowChat({ chatType: 'p2p', chatId: 'oc_x' }), false);
  setSetting('p2pOpen', '1');
  assert.equal(allowChat({ chatType: 'p2p', chatId: 'oc_x' }), true);
  setSetting('p2pOpen', '0');
});

test('morning is per-group and independent of 开通', () => {
  assert.deepEqual(morningAllowlist(), []);
  mutateAllowlist('morning', 'oc_m1', 'add');
  assert.deepEqual(morningAllowlist(), ['oc_m1']);
  assert.equal(allowChat({ chatType: 'group', chatId: 'oc_m1' }), false);
  mutateAllowlist('chat', 'oc_m1', 'add');
  assert.equal(allowChat({ chatType: 'group', chatId: 'oc_m1' }), true);
  mutateAllowlist('morning', 'oc_m2', 'add');
  const day = shanghaiDay();
  const noon = new Date(`${day}T12:00:00+08:00`);
  setMorningArmedAt(['oc_m1', 'oc_m2'], Date.parse(`${day}T08:00:00+08:00`));
  assert.deepEqual(pendingMorningChats(day, noon).sort(), ['oc_m1', 'oc_m2']);
  markMorningSent(['oc_m1'], day);
  assert.deepEqual(pendingMorningChats(day, noon), ['oc_m2']);
  mutateAllowlist('morning', 'oc_m1', 'remove');
  assert.deepEqual(morningAllowlist(), ['oc_m2']);
});

test('morning time is one global clock, 15-minute slots', () => {
  setAllowlist('morning', ['oc_a', 'oc_b']);
  setMorningArmedAt(['oc_a', 'oc_b'], Date.parse('2026-09-02T00:00:00+08:00'));
  setMorningDefaultTime('09:00');
  assert.equal(morningDefaultTime(), '09:00');
  assert.equal(normalizeMorningTime('8:30'), '08:30');
  assert.equal(morningTimeSlots()[0], '06:00');
  assert.equal(morningTimeSlots().at(-1), '12:00');
  assert.throws(() => normalizeMorningTime('09:07'));
  assert.throws(() => normalizeMorningTime('24:00'));
  const day = '2026-09-02';
  const before = new Date('2026-09-02T00:59:00.000Z');
  const atTime = new Date('2026-09-02T01:00:00.000Z');
  assert.equal(shanghaiHm(before), '08:59');
  assert.equal(shanghaiHm(atTime), '09:00');
  assert.deepEqual(pendingMorningChats(day, before), []);
  assert.deepEqual(pendingMorningChats(day, atTime).sort(), ['oc_a', 'oc_b']);
  setMorningDefaultTime('08:00');
  assert.equal(morningDefaultTime(), '08:00');
  assert.deepEqual(pendingMorningChats(day, before).sort(), ['oc_a', 'oc_b']);
  setMorningDefaultTime('09:00');
});

test('late morning enable waits until next clock', () => {
  setAllowlist('morning', ['oc_late']);
  setMorningDefaultTime('09:00');
  setMorningArmedAt(['oc_late'], Date.parse('2026-09-03T13:40:00+08:00'));
  const afternoon = new Date('2026-09-03T05:40:00.000Z');
  assert.equal(morningDueToday('oc_late', '2026-09-03'), false);
  assert.deepEqual(pendingMorningChats('2026-09-03', afternoon), []);
  assert.deepEqual(claimMorningChats('2026-09-03', afternoon), []);
  const nextMorning = new Date('2026-09-04T01:00:00.000Z');
  assert.equal(morningDueToday('oc_late', '2026-09-04'), true);
  assert.deepEqual(pendingMorningChats('2026-09-04', nextMorning), ['oc_late']);
});

test('enable before clock still sends that day', () => {
  setAllowlist('morning', ['oc_early']);
  setMorningDefaultTime('09:00');
  setMorningArmedAt(['oc_early'], Date.parse('2026-09-03T08:50:00+08:00'));
  const atTime = new Date('2026-09-03T01:00:00.000Z');
  assert.equal(morningDueToday('oc_early', '2026-09-03'), true);
  assert.deepEqual(pendingMorningChats('2026-09-03', atTime), ['oc_early']);
});

test('denials then clear on add', () => {
  recordDenial({ kind: 'chat', id: 'oc_wait', openId: 'ou_1' });
  assert.equal(listDenials()[0].id, 'oc_wait');
  mutateAllowlist('chat', 'oc_wait', 'add');
  clearDenial('oc_wait');
  assert.equal(listDenials().length, 0);
});

test('caps default unlimited then override', () => {
  assert.equal(liveCaps().user, 0);
  assert.equal(liveCaps().global, 0);
  for (let i = 0; i < 25; i++) consumeQuota('ou_unlimited');
  setSetting('dailyUserCap', '1');
  setSetting('xaiModel', 'grok-4.6');
  consumeQuota('ou_capped');
  assert.throws(() => consumeQuota('ou_capped'));
  assert.equal(liveCaps().user, 1);
  assert.equal(liveModel(), 'grok-4.6');
  setSetting('dailyUserCap', '0');
});

test('turns keep names and usage groups by chat', () => {
  recordTurn({
    chatId: 'oc_a',
    openId: 'ou_1',
    text: '热点',
    intent: 'hot',
    usedGrok: true,
    chatName: '产品群',
    userName: '张三',
    chatType: 'group',
  });
  recordTurn({
    chatId: 'oc_a',
    openId: 'ou_2',
    text: '今天',
    intent: 'latest',
    usedGrok: true,
    chatName: '产品群',
    userName: '李四',
    chatType: 'group',
  });
  recordTurn({
    chatId: 'oc_b',
    openId: 'ou_1',
    text: '热点',
    intent: 'hot',
    usedGrok: true,
    chatName: '设计群',
    userName: '张三',
    chatType: 'group',
  });
  recordTurn({
    chatId: 'oc_a',
    openId: 'ou_1',
    text: '你能做啥',
    intent: 'help',
    usedGrok: false,
    chatName: '产品群',
    userName: '张三',
    chatType: 'group',
  });
  const turns = listTurns(10);
  const named = turns.find((t) => t.text === '热点' && t.chatId === 'oc_b');
  assert.equal(named.userName, '张三');
  assert.equal(named.chatName, '设计群');
  assert.equal(getProfile('ou_1'), '张三');
  const byId = Object.fromEntries(usageRows().map((u) => [u.chatId, u]));
  assert.equal(byId.oc_a.count, 2);
  assert.equal(byId.oc_b.count, 1);
  assert.equal(byId.oc_a.chatName, '产品群');
  assert.equal(byId.oc_b.chatName, '设计群');
});

test('old morning row with joined chat ids splits in usage', () => {
  recordTurn({
    chatId: 'oc_m1,oc_m2',
    openId: 'morning',
    text: '早报',
    intent: 'latest',
    usedGrok: true,
    userName: '早报',
    chatType: 'group',
  });
  const byId = Object.fromEntries(usageRows().map((u) => [u.chatId, u]));
  assert.equal(byId.oc_m1.count, 1);
  assert.equal(byId.oc_m2.count, 1);
});

test('allowlist JSON duplicates collapse', () => {
  setSetting('morningAllowlist', JSON.stringify(['oc_dup', 'oc_dup', 'oc_other']));
  assert.deepEqual(morningAllowlist(), ['oc_dup', 'oc_other']);
  setAllowlist('morning', ['oc_a', 'oc_b']);
});

test('claimMorningChats is exclusive and honors legacy sent map', () => {
  setAllowlist('morning', ['oc_claim1', 'oc_claim2', 'oc_legacy']);
  setMorningArmedAt(
    ['oc_claim1', 'oc_claim2', 'oc_legacy'],
    Date.parse('2026-09-03T08:00:00+08:00'),
  );
  setMorningDefaultTime('09:00');
  const day = '2026-09-03';
  const noon = new Date('2026-09-03T04:00:00.000Z');
  setSetting('morningSent', JSON.stringify({ oc_legacy: day }));

  const first = claimMorningChats(day, noon);
  assert.deepEqual(first.sort(), ['oc_claim1', 'oc_claim2']);
  assert.deepEqual(pendingMorningChats(day, noon), []);
  assert.deepEqual(claimMorningChats(day, noon), []);

  releaseMorningClaim('oc_claim2', day);
  assert.deepEqual(claimMorningChats(day, noon), ['oc_claim2']);

  markMorningSent(['oc_claim1'], day);
  releaseMorningClaim('oc_claim1', day);
  assert.equal(pendingMorningChats(day, noon).includes('oc_claim1'), false);
  assert.equal(claimMorningChats(day, noon).includes('oc_claim1'), false);
});

test('old long morning cache is ignored after version bump', () => {
  const day = shanghaiDay();
  setSetting('morningBrief', JSON.stringify({ day, markdown: '旧长文', at: 1 }));
  assert.equal(morningBriefCache(day), null);
  saveMorningBriefCache({
    day,
    markdown: '1. **短标题**',
    items: [{ title: '短标题', summary: '简介', source: 'GitHub Blog', url: 'https://example.com' }],
    at: 2,
  });
  assert.equal(morningBriefCache(day).items[0].source, 'GitHub Blog');
});

test('display names for special ids', () => {
  assert.equal(displayChatName('', '', 'p2p'), '私聊');
  assert.equal(displayChatName('cli', ''), '命令行');
  assert.equal(displayUserName('morning', ''), '早报');
  assert.equal(displayUserName('codex', ''), 'Tibo重置');
  setProfile('oc_cached', '缓存群', 'chat');
  assert.equal(displayChatName('oc_cached', ''), '缓存群');
  const { start, end } = shanghaiDayBounds('2026-09-02');
  assert.equal(end - start, 24 * 3600 * 1000);
  assert.equal(new Date(start).toISOString(), '2026-09-01T16:00:00.000Z');
});
