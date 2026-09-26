import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningUuid } from '../src/morning.js';

test('morning uuid is stable and within Feishu 50-char limit', () => {
  const a = morningUuid('2026-09-03', 'oc_demo_group_alpha');
  const b = morningUuid('2026-09-03', 'oc_demo_group_alpha');
  const c = morningUuid('2026-09-03', 'oc_demo_group_beta');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.startsWith('nb-v5-2026-09-03-'), true);
  assert.equal(a.length <= 50, true);
});
