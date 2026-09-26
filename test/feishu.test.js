import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR ||= mkdtempSync(join(tmpdir(), 'newsbot-feishu-'));

const {
  addressedToBot,
  contentMentionsAll,
  extractText,
  enrichTurns,
  feishuAdminStatus,
  isMentionAll,
} = await import('../src/feishu.js');
const { denyHint, userMessage, AppError, CODES } = await import('../src/errors.js');
const { brandConfig } = await import('../src/config.js');
const { openDb, setProfile } = await import('../src/quota.js');

const BOT = 'ou_bot_newsbot';

test('isMentionAll covers Feishu @all shapes', () => {
  assert.equal(isMentionAll({ key: '@_all', name: '所有人', id: { open_id: '', user_id: '', union_id: '' } }), true);
  assert.equal(isMentionAll({ key: '@_user_1', name: '所有人', id: { open_id: '', user_id: '' } }), true);
  assert.equal(isMentionAll({ key: '@_user_1', id: { user_id: 'all', open_id: '' } }), true);
  assert.equal(isMentionAll({ key: '@_user_1', id: 'all' }), true);
  assert.equal(isMentionAll({ key: '@_user_1', name: 'AI 资讯', id: { open_id: BOT } }), false);
});

test('contentMentionsAll reads text and post payloads', () => {
  assert.equal(contentMentionsAll({ content: '{"text":"@_all 注意一下"}' }), true);
  assert.equal(contentMentionsAll({ content: '{"text":"<at user_id=\\"all\\">@所有人</at> 注意"}' }), true);
  assert.equal(
    contentMentionsAll({
      content: JSON.stringify({
        zh_cn: { content: [[{ tag: 'at', user_id: 'all', user_name: '所有人' }, { tag: 'text', text: '注意' }]] },
      }),
    }),
    true,
  );
  assert.equal(contentMentionsAll({ content: JSON.stringify({ text: '@_user_1 今天有什么' }) }), false);
});

test('addressedToBot ignores @all unless the bot is also mentioned', () => {
  assert.equal(addressedToBot({ chat_type: 'p2p', content: '{"text":"你好"}' }, BOT), true);

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: '{"text":"@_user_1 今天有什么"}',
        mentions: [{ key: '@_user_1', name: 'AI 资讯', id: { open_id: BOT } }],
      },
      BOT,
    ),
    true,
  );

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: '{"text":"@_all 各位注意一下"}',
        mentions: [{ key: '@_all', name: '所有人', id: { open_id: '', user_id: '', union_id: '' } }],
      },
      BOT,
    ),
    false,
  );

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: '{"text":"@_user_1 修改的代码都要自测"}',
        mentions: [{ key: '@_user_1', name: '所有人', id: { open_id: '', user_id: '' } }],
      },
      BOT,
    ),
    false,
  );

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: JSON.stringify({
          title: '',
          content: [[{ tag: 'at', user_id: 'all', user_name: '所有人' }, { tag: 'text', text: '各位注意一下' }]],
        }),
        mentions: [],
      },
      BOT,
    ),
    false,
  );

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: '{"text":"@_all @_user_2 今天有什么"}',
        mentions: [
          { key: '@_all', name: '所有人', id: { open_id: '' } },
          { key: '@_user_2', name: 'AI 资讯', id: { open_id: BOT } },
        ],
      },
      BOT,
    ),
    true,
  );

  assert.equal(
    addressedToBot(
      {
        chat_type: 'topic_group',
        content: '{"text":"<at user_id=\\"all\\">所有人</at> 注意"}',
        mentions: [],
      },
      BOT,
    ),
    false,
  );

  assert.equal(addressedToBot({ chat_type: 'group', content: '{"text":"@_user_1 热点"}', mentions: [] }, BOT), true);

  assert.equal(
    addressedToBot(
      {
        chat_type: 'group',
        content: '{"text":"@_all 注意"}',
        mentions: [{ key: '@_all', name: '所有人', id: { open_id: '' } }],
      },
      null,
    ),
    false,
  );
});

test('denyHint replies in p2p when private chat is off', () => {
  assert.equal(denyHint('p2p'), '私聊还没开通。请到已开通的群里 @ 我提问。');
  assert.equal(denyHint('group'), `这个群还没开通。站主在 ${brandConfig().name} 后台打开对应开关即可。`);
  assert.equal(denyHint('topic_group'), denyHint('group'));
  assert.equal(denyHint('unknown'), '');
  assert.equal(userMessage(new AppError(CODES.NOT_ALLOWED)), denyHint('group'));
});

test('extract text message', () => {
  const text = extractText({
    message_type: 'text',
    content: JSON.stringify({ text: '@_user_1 今天有什么' }),
  });
  assert.equal(text, '今天有什么');
});

test('extract post message', () => {
  const text = extractText({
    message_type: 'post',
    content: JSON.stringify({
      zh_cn: {
        content: [[{ tag: 'text', text: '热点' }, { tag: 'a', text: 'AIHOT', href: 'https://x' }]],
      },
    }),
  });
  assert.equal(text, '热点 AIHOT');
});

test('enrichTurns fills names from profiles', async () => {
  openDb();
  setProfile('oc_x', '测试群', 'chat');
  setProfile('ou_x', '王五', 'user');
  const out = await enrichTurns([
    { id: 1, chatId: 'oc_x', openId: 'ou_x', chatName: '', userName: '', chatType: 'group', text: '热点' },
  ]);
  assert.equal(out[0].chatName, '测试群');
  assert.equal(out[0].userName, '王五');
});

test('admin status never returns the app secret', () => {
  const prevId = process.env.FEISHU_APP_ID;
  const prevSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'cli_demoapp00000001';
  process.env.FEISHU_APP_SECRET = 'leaked-secret-token-xyz';
  try {
    const status = feishuAdminStatus();
    const json = JSON.stringify(status);
    assert.equal(json.includes('leaked-secret-token-xyz'), false);
    assert.equal(status.appId, 'cli_demoapp00000001');
    assert.equal(status.secretSet, true);
    assert.equal(status.consoleUrl, 'https://open.feishu.cn/app/cli_demoapp00000001');
    assert.equal(status.source, 'env');
  } finally {
    if (prevId == null) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = prevId;
    if (prevSecret == null) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = prevSecret;
  }
});
