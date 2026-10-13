import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAG_THRESHOLD_PX, isDragGesture, windowPositionDuringDrag } from '@pet/room';

test('a press that barely moves stays a click so pets remain selectable', () => {
  const start = { screenX: 100, screenY: 100 };
  assert.equal(isDragGesture(start, { screenX: 100, screenY: 100 }), false);
  assert.equal(isDragGesture(start, { screenX: 102, screenY: 101 }), false);
  assert.equal(isDragGesture(start, { screenX: 100 + DRAG_THRESHOLD_PX - 1, screenY: 100 }), false);
});

test('a press that moves past the threshold in any direction becomes a window drag', () => {
  const start = { screenX: 100, screenY: 100 };
  assert.equal(isDragGesture(start, { screenX: 100 + DRAG_THRESHOLD_PX, screenY: 100 }), true);
  assert.equal(isDragGesture(start, { screenX: 100, screenY: 100 - DRAG_THRESHOLD_PX }), true);
  assert.equal(isDragGesture(start, { screenX: 97, screenY: 97 }), true);
});

test('the window follows the pointer by the distance moved since the press', () => {
  const origin = { windowX: 200, windowY: 300, screenX: 250, screenY: 320 };
  assert.deepEqual(windowPositionDuringDrag(origin, { screenX: 250, screenY: 320 }), {
    x: 200,
    y: 300,
  });
  assert.deepEqual(windowPositionDuringDrag(origin, { screenX: 290, screenY: 300 }), {
    x: 240,
    y: 280,
  });
  assert.deepEqual(windowPositionDuringDrag(origin, { screenX: 250.6, screenY: 319.4 }), {
    x: 201,
    y: 299,
  });
});
