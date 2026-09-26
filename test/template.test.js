import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skipDir = new Set(['.git', 'node_modules', 'data', 'tmp-ui', 'coverage']);
const skipFile = new Set(['CLAUDE.md', 'AGENTS.md']);
const textExt = new Set([
  '.js',
  '.mjs',
  '.html',
  '.css',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.json',
  '.example',
  '.sh',
]);

const forbidden = [
  'glow' + 'zora',
  'uq' + 'idc',
  'Glow ' + '资讯',
  'Glow ' + 'News',
  'Glow' + 'Newsbot',
  'Glow ' + 'AI',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    const rel = relative(root, full);
    if (
      skipFile.has(name) ||
      rel === 'scripts/deploy.sh' ||
      rel === 'scripts/sync-public.sh' ||
      rel === 'scripts/check-public.sh'
    ) {
      continue;
    }
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (!textExt.has(ext)) continue;
    out.push(rel);
  }
  return out;
}

test('files that ship in the public repo stay generic', () => {
  const hits = [];
  for (const rel of walk(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const needle of forbidden) {
      if (text.includes(needle)) hits.push(`${rel}: ${needle}`);
    }
  }
  assert.deepEqual(hits, []);
});
