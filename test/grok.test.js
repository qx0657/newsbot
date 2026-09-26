import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestEvidence, mergeDigestItems, parseDigestItems, stripSourceLine } from '../src/grok.js';

test('strip trailing source attribution', () => {
  assert.equal(stripSourceLine('第1名：foo\n\n数据来自 AIHOT。'), '第1名：foo');
  assert.equal(stripSourceLine('hello\n来源：某处'), 'hello');
  assert.equal(stripSourceLine('第1名：foo'), '第1名：foo');
});

test('parseDigestItems reads JSON array and fenced payload', () => {
  const items = parseDigestItems(`废话
\`\`\`json
[{"title":"A","summary":"s","source":"GitHub Blog","url":"https://github.blog/a"}]
\`\`\``);
  assert.deepEqual(items, [
    { title: 'A', summary: 's', source: 'GitHub Blog', url: 'https://github.blog/a' },
  ]);
});

test('mergeDigestItems fills url from evidence and keeps named source', () => {
  const evidence = {
    items: [{ title: 'Hello', summary: 'short', source: 'The Verge', original: 'https://example.com/a' }],
  };
  const merged = mergeDigestItems([{ title: '你好', summary: '简介', source: '来源' }], evidence);
  assert.equal(merged[0].title, '你好');
  assert.equal(merged[0].source, 'The Verge');
  assert.equal(merged[0].url, 'https://example.com/a');
});

test('digest evidence keeps one-liners and drops reason', () => {
  const out = digestEvidence({
    items: [
      {
        title: 'Hello',
        summary: 'short',
        reason: '为什么值得关注：很长一段',
        source: 'The Verge',
        original: 'https://example.com/a',
        aihot: 'https://aihot.virxact.com/items/1',
      },
      { title: '', summary: '' },
    ],
  });
  assert.deepEqual(out, {
    items: [
      {
        title: 'Hello',
        summary: 'short',
        source: 'The Verge',
        url: 'https://example.com/a',
      },
    ],
  });
});
