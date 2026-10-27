import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineMaterialsLabel } from '@pet/combine';

test('재료 수와 비용을 늘 보인다', () => {
  assert.equal(combineMaterialsLabel('common', 5), '재료 5 / 10 · 30K 토큰');
  assert.equal(combineMaterialsLabel('rare', 0), '재료 0 / 10 · 100K 토큰');
});
