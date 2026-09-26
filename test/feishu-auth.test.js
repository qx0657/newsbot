import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'newsbot-feishu-auth-'));
process.env.DATA_DIR = dir;
delete process.env.FEISHU_APP_ID;
delete process.env.FEISHU_APP_SECRET;

const {
  clearFeishuAuthFile,
  feishuConfigured,
  feishuConsoleUrl,
  feishuCredentials,
  normalizeFeishuAppId,
  prepareFeishuAuth,
  saveFeishuAuth,
} = await import('../src/config.js');

const APP = 'cli_demoapp00000001';
const SECRET = 'unit-test-secret-value';

function reset() {
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  clearFeishuAuthFile();
}

test('console url follows app id', () => {
  assert.equal(feishuConsoleUrl(APP), `https://open.feishu.cn/app/${APP}`);
  assert.equal(feishuConsoleUrl('not-an-id'), 'https://open.feishu.cn/app');
  assert.equal(feishuConsoleUrl(''), 'https://open.feishu.cn/app');
});

test('normalize app id', () => {
  assert.equal(normalizeFeishuAppId(` ${APP} `), APP);
  assert.throws(() => normalizeFeishuAppId('app_xxx'), /cli_/);
  assert.throws(() => normalizeFeishuAppId(''), /cli_/);
});

test('env bootstrap when no file', () => {
  reset();
  process.env.FEISHU_APP_ID = APP;
  process.env.FEISHU_APP_SECRET = SECRET;
  const creds = feishuCredentials();
  assert.equal(creds.source, 'env');
  assert.equal(creds.appId, APP);
  assert.equal(creds.appSecret, SECRET);
  assert.equal(feishuConfigured(), true);
});

test('saved file wins over env and never appears in public json', () => {
  reset();
  process.env.FEISHU_APP_ID = 'cli_oldoldoldoldold1';
  process.env.FEISHU_APP_SECRET = 'env-secret-should-not-win';
  saveFeishuAuth({ appId: APP, appSecret: SECRET });
  const creds = feishuCredentials();
  assert.equal(creds.source, 'file');
  assert.equal(creds.appId, APP);
  assert.equal(creds.appSecret, SECRET);
  const raw = JSON.parse(readFileSync(join(dir, 'feishu-auth.json'), 'utf8'));
  assert.equal(raw.appId, APP);
  const publicJson = JSON.stringify({
    appId: creds.appId,
    secretSet: Boolean(creds.appSecret),
    source: creds.source,
    consoleUrl: feishuConsoleUrl(creds.appId),
  });
  assert.equal(publicJson.includes(SECRET), false);
  assert.equal(publicJson.includes('env-secret-should-not-win'), false);
});

test('omit secret keeps the saved one', () => {
  reset();
  saveFeishuAuth({ appId: APP, appSecret: SECRET });
  assert.equal(prepareFeishuAuth({ appId: APP, appSecret: '  ' }).appSecret, SECRET);
  assert.equal(prepareFeishuAuth({ appId: APP, appSecret: '' }).appSecret, SECRET);
  clearFeishuAuthFile();
  assert.throws(() => prepareFeishuAuth({ appId: APP, appSecret: '' }), /密钥/);
});

test('clear file falls back to env', () => {
  reset();
  process.env.FEISHU_APP_ID = APP;
  process.env.FEISHU_APP_SECRET = SECRET;
  saveFeishuAuth({ appId: APP, appSecret: 'file-secret-value' });
  assert.equal(feishuCredentials().source, 'file');
  clearFeishuAuthFile();
  assert.equal(existsSync(join(dir, 'feishu-auth.json')), false);
  const creds = feishuCredentials();
  assert.equal(creds.source, 'env');
  assert.equal(creds.appSecret, SECRET);
});
