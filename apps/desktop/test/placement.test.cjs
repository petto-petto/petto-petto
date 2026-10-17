const assert = require('node:assert/strict');
const test = require('node:test');

const battle = { x: 400, y: 184, width: 640, height: 420 };

test('펫룸이 전투 창 아래에 깔리는지 — 조금이라도 겹치면 겹친 것이다', async () => {
  const { overlaps } = await import('../dist/main/placement.js');
  // 전투 창의 `펫룸`으로 연 펫룸이 놓이던 자리(실측). 항상 위인 전투 창에 통째로 가려졌다.
  assert.equal(overlaps({ x: 400, y: 224, width: 640, height: 452 }, battle), true);
  assert.equal(overlaps({ x: 1039, y: 603, width: 10, height: 10 }, battle), true);
});

test('모서리만 맞닿거나 떨어져 있으면 겹치지 않는다', async () => {
  const { overlaps } = await import('../dist/main/placement.js');
  assert.equal(overlaps({ x: 1040, y: 184, width: 640, height: 452 }, battle), false);
  assert.equal(overlaps({ x: 400, y: 604, width: 640, height: 452 }, battle), false);
  assert.equal(overlaps({ x: 0, y: 0, width: 100, height: 100 }, battle), false);
});
