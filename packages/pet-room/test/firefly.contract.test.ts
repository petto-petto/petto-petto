/** 반딧불이 규칙의 실행 증거 — 마릿수, 정수 스냅, 단계 밝기, 정지 모드. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fireflyAlpha,
  fireflyCountFor,
  fireflyDotAt,
  FIREFLY_BLINK_STEPS,
  FIREFLY_GLOW_RADIUS,
  spawnFireflies,
  type Firefly,
} from '@pet/room';

/** 결정론적 난수. 같은 배치를 다시 만들 수 있어야 한다. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREA = { x: 96, y: 120, width: 744, height: 200 };

/* ---------- 마릿수 ---------- */

test('낮과 새벽에는 반딧불이가 없다', () => {
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    assert.equal(fireflyCountFor(season, 'day'), 0, `${season} 낮`);
    assert.equal(fireflyCountFor(season, 'dawn'), 0, `${season} 새벽`);
  }
});

test('겨울에는 밤에도 없다 — 눈 덮인 숲에 벌레가 날면 계절이 무너진다', () => {
  assert.equal(fireflyCountFor('winter', 'night'), 0);
  assert.equal(fireflyCountFor('winter', 'dusk'), 0);
});

test('여름 밤이 가장 많고, 노을에는 그보다 적다', () => {
  const summerNight = fireflyCountFor('summer', 'night');
  const summerDusk = fireflyCountFor('summer', 'dusk');
  const autumnNight = fireflyCountFor('autumn', 'night');

  assert.ok(summerNight > 0);
  assert.ok(summerDusk > 0 && summerDusk < summerNight);
  assert.ok(autumnNight > 0 && autumnNight < summerNight);
});

/* ---------- 궤도 ---------- */

test('흩뿌린 무리는 모두 영역 안에서 시작한다', () => {
  const flies = spawnFireflies(AREA, 20, seededRandom(7));
  assert.equal(flies.length, 20);
  for (const fly of flies) {
    assert.ok(fly.x >= AREA.x && fly.x <= AREA.x + AREA.width);
    assert.ok(fly.y >= AREA.y && fly.y <= AREA.y + AREA.height);
    assert.ok(fly.periodMs > 0);
  }
});

test('같은 시드는 같은 배치를 만든다', () => {
  const a = spawnFireflies(AREA, 8, seededRandom(42));
  const b = spawnFireflies(AREA, 8, seededRandom(42));
  assert.deepEqual(a, b);
});

/**
 * 좌표가 정수여야 하는 이유: 반 픽셀에 찍으면 캔버스가 두 픽셀에 나눠 칠해
 * 흐려진다. 정수 배율 도트 화면에서는 그 한 점만 혼자 번져 보인다.
 */
test('위치는 언제나 정수로 스냅된다', () => {
  const flies = spawnFireflies(AREA, 12, seededRandom(3));
  for (let ms = 0; ms < 8000; ms += 137) {
    for (const fly of flies) {
      const dot = fireflyDotAt(fly, ms);
      assert.equal(dot.x, Math.trunc(dot.x), `x=${dot.x}`);
      assert.equal(dot.y, Math.trunc(dot.y), `y=${dot.y}`);
    }
  }
});

test('밝기는 0 ~ 최대 단계의 정수다 — 사이값이 없어야 색이 안 번진다', () => {
  const flies = spawnFireflies(AREA, 12, seededRandom(11));
  for (let ms = 0; ms < 8000; ms += 91) {
    for (const fly of flies) {
      const { level } = fireflyDotAt(fly, ms);
      assert.equal(level, Math.trunc(level));
      assert.ok(level >= 0 && level <= FIREFLY_BLINK_STEPS, `level=${level}`);
    }
  }
});

test('한 마리는 밝아졌다 어두워진다 — 고정된 점이 아니다', () => {
  const [fly] = spawnFireflies(AREA, 1, seededRandom(5));
  assert.ok(fly);
  const levels = new Set<number>();
  for (let ms = 0; ms < 12000; ms += 50) levels.add(fireflyDotAt(fly, ms).level);
  assert.ok(levels.size > 1, '밝기가 변하지 않는다');
});

test('무리가 한꺼번에 깜빡이지 않는다', () => {
  const flies = spawnFireflies(AREA, 16, seededRandom(9));
  const atOnce = new Set(flies.map((fly) => fireflyDotAt(fly, 1234).level));
  assert.ok(atOnce.size > 1, '같은 순간 모두 같은 밝기다');
});

/* ---------- 정지 모드 ---------- */

test('움직임을 줄이면 제자리에 고정되지만 꺼지지는 않는다', () => {
  const [fly] = spawnFireflies(AREA, 1, seededRandom(2));
  assert.ok(fly);
  const first = fireflyDotAt(fly, 0, true);
  const later = fireflyDotAt(fly, 9999, true);
  assert.deepEqual(first, later);
  assert.ok(first.level > 0, '정지 모드에서 꺼져 버리면 밤 배경이 허전해진다');
});

/* ---------- 빛 번짐 ---------- */

test('알파는 중심에서 멀어질수록 단계로 옅어지고 반경 밖은 0이다', () => {
  const center = fireflyAlpha(FIREFLY_BLINK_STEPS, 0);
  const ring1 = fireflyAlpha(FIREFLY_BLINK_STEPS, 1);
  assert.ok(center > ring1 && ring1 > 0);
  assert.equal(fireflyAlpha(FIREFLY_BLINK_STEPS, FIREFLY_GLOW_RADIUS), 0);
});

test('꺼진 반딧불이는 어느 칸에서도 그리지 않는다', () => {
  for (let ring = 0; ring <= FIREFLY_GLOW_RADIUS; ring += 1) {
    assert.equal(fireflyAlpha(0, ring), 0);
  }
});
