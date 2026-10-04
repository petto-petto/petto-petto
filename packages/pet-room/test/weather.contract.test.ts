/** 떨어지는 것들의 실행 증거 — 계절 배정, 순환, 정수 스냅, 깊이 단계. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  spawnWeather,
  weatherAlpha,
  weatherColor,
  weatherCountFor,
  weatherDotAt,
  weatherFor,
  WEATHER_DEPTHS,
  WEATHER_KINDS,
  type WeatherKind,
} from '@pet/room';

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

const AREA = { x: 0, y: 0, width: 960, height: 360 };

/* ---------- 계절 배정 ---------- */

test('계절마다 내리는 것이 다르고, 여름은 비어 있다', () => {
  assert.equal(weatherFor('winter'), 'snow');
  assert.equal(weatherFor('spring'), 'petal');
  assert.equal(weatherFor('autumn'), 'leaf');
  // 여름은 반딧불이가 맡는다. 겹치면 화면이 소란스러워진다.
  assert.equal(weatherFor('summer'), null);
});

test('여름에는 개수가 0이다', () => {
  for (const phase of ['dawn', 'day', 'dusk', 'night'] as const) {
    assert.equal(weatherCountFor('summer', phase), 0);
  }
});

test('밤에는 수를 줄인다 — 어두운 화면의 흰 점은 노이즈로 읽힌다', () => {
  const day = weatherCountFor('winter', 'day');
  const night = weatherCountFor('winter', 'night');
  assert.ok(day > 0 && night > 0);
  assert.ok(night < day, `밤(${night})이 낮(${day})보다 적어야 한다`);
});

test('눈이 꽃잎·낙엽보다 많다', () => {
  const snow = weatherCountFor('winter', 'day');
  assert.ok(snow > weatherCountFor('spring', 'day'));
  assert.ok(snow > weatherCountFor('autumn', 'day'));
});

test('종류마다 색이 다르다', () => {
  const colors = new Set(WEATHER_KINDS.map((k) => weatherColor(k)));
  assert.equal(colors.size, WEATHER_KINDS.length);
});

/* ---------- 순환 ---------- */

test('흩뿌린 입자는 영역 안에서 시작하고 깊이는 선언된 단계 안이다', () => {
  const particles = spawnWeather(AREA, 'snow', 40, seededRandom(4));
  assert.equal(particles.length, 40);
  for (const p of particles) {
    assert.ok(p.x >= AREA.x && p.x <= AREA.x + AREA.width);
    assert.ok(p.offset >= 0 && p.offset < 1);
    assert.ok(Number.isInteger(p.depth));
    assert.ok(p.depth >= 0 && p.depth < WEATHER_DEPTHS);
  }
});

/**
 * 순환이 핵심이다. 아래로 나간 입자를 지우면 마릿수가 출렁이므로, 나머지 연산
 * 으로 위에서 다시 들어오게 한다. 어느 시각을 넣어도 화면 안에 있어야 한다.
 */
test('어느 시각에도 입자는 화면 세로 범위를 벗어나지 않는다', () => {
  for (const kind of WEATHER_KINDS) {
    const particles = spawnWeather(AREA, kind, 20, seededRandom(8));
    for (let ms = 0; ms < 60_000; ms += 373) {
      for (const p of particles) {
        const dot = weatherDotAt(p, kind, AREA, ms);
        assert.ok(
          dot.y >= AREA.y && dot.y <= AREA.y + AREA.height,
          `${kind} y=${dot.y} (ms=${ms})`,
        );
      }
    }
  }
});

test('한 입자는 실제로 아래로 내려간다', () => {
  const [p] = spawnWeather(AREA, 'snow', 1, seededRandom(1));
  assert.ok(p);
  const start = weatherDotAt(p, 'snow', AREA, 0).y;
  const later = weatherDotAt(p, 'snow', AREA, 1500).y;
  assert.notEqual(start, later, '세로로 움직이지 않는다');
});

test('가까운 입자가 먼 입자보다 빨리 떨어진다', () => {
  const near = { x: 100, offset: 0, depth: WEATHER_DEPTHS - 1, swayX: 0, swayMs: 1000, phase: 0 };
  const far = { ...near, depth: 0 };
  const ms = 2000;
  const nearY = weatherDotAt(near, 'snow', AREA, ms).y;
  const farY = weatherDotAt(far, 'snow', AREA, ms).y;
  assert.ok(nearY > farY, `가까운 쪽(${nearY})이 더 내려가 있어야 한다 (먼 쪽 ${farY})`);
});

/* ---------- 도트 규격 ---------- */

test('좌표는 언제나 정수다', () => {
  for (const kind of WEATHER_KINDS) {
    const particles = spawnWeather(AREA, kind, 16, seededRandom(6));
    for (let ms = 0; ms < 10_000; ms += 211) {
      for (const p of particles) {
        const dot = weatherDotAt(p, kind, AREA, ms);
        assert.equal(dot.x, Math.trunc(dot.x));
        assert.equal(dot.y, Math.trunc(dot.y));
      }
    }
  }
});

test('크기와 알파는 깊이가 정하는 단계값이다', () => {
  const sizes = new Set<number>();
  const alphas = new Set<number>();
  for (let depth = 0; depth < WEATHER_DEPTHS; depth += 1) {
    const dot = weatherDotAt(
      { x: 0, offset: 0, depth, swayX: 0, swayMs: 1000, phase: 0 },
      'snow',
      AREA,
      0,
    );
    sizes.add(dot.size);
    alphas.add(weatherAlpha(depth));
  }
  assert.equal(sizes.size, WEATHER_DEPTHS, '깊이마다 크기가 달라야 원근이 생긴다');
  assert.equal(alphas.size, WEATHER_DEPTHS);
  assert.equal(weatherAlpha(WEATHER_DEPTHS - 1), 1, '가장 가까운 것은 불투명하다');
});

/* ---------- 정지 모드 ---------- */

test('움직임을 줄이면 흔들림이 멈추고 위치가 고정된다', () => {
  const kind: WeatherKind = 'petal';
  const [p] = spawnWeather(AREA, kind, 1, seededRandom(3));
  assert.ok(p);
  const a = weatherDotAt(p, kind, AREA, 0, true);
  const b = weatherDotAt(p, kind, AREA, 50_000, true);
  assert.deepEqual(a, b);
});
