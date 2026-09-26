import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactItem, storyIdFromLink } from '../src/aihot.js';

test('story id only from aihot story URL', () => {
  assert.equal(
    storyIdFromLink('https://aihot.virxact.com/story/abc123'),
    'abc123',
  );
  assert.equal(storyIdFromLink('https://aihot.virxact.com/items/abc123'), null);
  assert.equal(storyIdFromLink('https://evil.example/story/abc'), null);
});

test('compact item drops nulls and keeps links', () => {
  const row = compactItem({
    title: 'Hello',
    summary: null,
    reason: '值得看',
    source: { name: 'X' },
    links: { aihot: 'https://aihot.virxact.com/items/1', original: 'https://x.com/1' },
    rank: 1,
  });
  assert.equal(row.title, 'Hello');
  assert.equal(row.summary, undefined);
  assert.equal(row.source, 'X');
  assert.equal(row.aihot, 'https://aihot.virxact.com/items/1');
  assert.equal(row.rank, 1);
});
