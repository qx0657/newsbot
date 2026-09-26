import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'newsbot-brand-'));
process.env.DATA_DIR = dir;
process.env.BOT_NAME = '样例机器人';
process.env.BOT_NAME_EN = 'Sample Bot';
process.env.BOT_TAGLINE = '一句介绍';
process.env.PUBLIC_URL = 'https://example.com/news';

const { brandConfig } = await import('../src/config.js');
const { fillIndexHtml } = await import('../src/admin.js');
const { aaUserAgent } = await import('../src/aa.js');
const { helpText } = await import('../src/intent.js');

test('brand, help text, user agent and html boot follow env', () => {
  const brand = brandConfig();
  assert.equal(brand.name, '样例机器人');
  assert.equal(brand.nameEn, 'Sample Bot');
  assert.equal(brand.short, '一句介绍');
  assert.match(helpText(), /\*\*样例机器人\*\*/);
  assert.match(helpText(), /一句介绍/);
  assert.equal(aaUserAgent().includes('newsbot/0.1; +https://example.com/news'), true);
  assert.equal(aaUserAgent().toLowerCase().includes('glow' + 'zora'), false);
  const html = fillIndexHtml('<html><!--brand-boot--><b data-brand="name">AI 资讯</b></html>');
  assert.match(html, /<script>window\.__BRAND__=/);
  assert.match(html, /样例机器人/);
  assert.equal(html.includes('<!--brand-boot-->'), false);
  assert.equal(html.toLowerCase().includes('glow' + 'zora'), false);
});

test('user agent omits a contact url when PUBLIC_URL is empty', () => {
  const prev = process.env.PUBLIC_URL;
  delete process.env.PUBLIC_URL;
  try {
    assert.equal(aaUserAgent().includes('+'), false);
    assert.match(aaUserAgent(), /newsbot\/0\.1\)/);
  } finally {
    process.env.PUBLIC_URL = prev;
  }
});
