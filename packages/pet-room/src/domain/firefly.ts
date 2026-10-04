/**
 * 반딧불이 — 배경 위에 얹는 살아 있는 점.
 *
 * ## PNG 프레임을 쓰지 않는 이유
 *
 * 기존 배경은 `near` 레이어를 12프레임으로 교체해 반딧불이를 움직였다. 계절과
 * 시간대가 16장이 되면 그 방식은 192장이 되고, 12프레임 루프는 짧아서 반복이
 * 눈에 띈다. 여기서는 위치와 밝기를 **시각의 함수**로 계산해 런타임이 찍는다.
 * 배경이 몇 장이든 에셋이 늘지 않고, 주기가 서로 맞물리지 않아 반복도 없다.
 *
 * ## 그런데 부드러운 글로우는 못 쓴다
 *
 * `design.md` §4는 정수 배율과 `imageSmoothingEnabled = false`를 요구하고,
 * 오라도 같은 이유로 맥동을 **칸으로** 움직인다(`AURA_PULSE_STEPS`). 연속
 * 그라데이션을 깔면 도트 엣지가 뭉개져 스프라이트 옆에서 혼자 흐릿해진다.
 *
 * 그래서 밝기는 `FIREFLY_BLINK_STEPS` 단계로 양자화하고, 위치는 정수로 스냅한다.
 * 빛 번짐은 중심 픽셀 둘레에 **알파가 단계로 낮아지는 띠**를 얹어 흉내낸다 —
 * 그리는 쪽 몫이라 여기서는 단계값만 준다.
 */

import type { BackgroundPhase, Season } from './scene.ts';

/** 깜빡임 단계. 0이면 꺼진 것이고 최대값이 가장 밝다. */
export const FIREFLY_BLINK_STEPS = 4;

/** 중심에서 몇 칸까지 빛이 번지는가. 1이면 중심만, 2면 한 칸 띠가 더 붙는다. */
export const FIREFLY_GLOW_RADIUS = 2;

/** 한 마리. 궤도는 고정이고 시각만 넣으면 지금 위치가 나온다. */
export interface Firefly {
  /** 궤도의 중심. */
  readonly x: number;
  readonly y: number;
  /** 중심에서 좌우·상하로 얼마나 떠다니는가(px). */
  readonly driftX: number;
  readonly driftY: number;
  /** 한 바퀴 도는 데 걸리는 시간. 개체마다 달라야 무리가 함께 깜빡이지 않는다. */
  readonly periodMs: number;
  /** 시작 위상 0~1. */
  readonly phase: number;
}

/** 지금 찍어야 할 점. 좌표는 캔버스 픽셀이고 항상 정수다. */
export interface FireflyDot {
  readonly x: number;
  readonly y: number;
  /** 0 ~ `FIREFLY_BLINK_STEPS`. 0이면 그리지 않는다. */
  readonly level: number;
}

export interface FireflyArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 세로 궤도는 가로보다 **1.618배 느리게** 돈다.
 *
 * 두 주기가 정수비면 궤적이 금방 닫혀서 같은 자리를 왕복한다. 무리수비를 주면
 * 리사주 곡선이 오래 안 닫혀 떠다니는 것처럼 보인다.
 */
const DRIFT_RATIO = 1.618;

/**
 * 계절과 시간대에 맞는 마릿수.
 *
 * 낮에는 보이지 않는다 — 실제로도 그렇고, 밝은 배경 위의 노란 점은 먼지처럼
 * 읽힌다. 겨울에는 0이다. 눈 내린 숲에 벌레가 날면 계절이 무너진다.
 */
export function fireflyCountFor(season: Season, phase: BackgroundPhase): number {
  if (phase === 'day' || phase === 'dawn') return 0;
  if (season === 'winter') return 0;
  const byPhase = phase === 'night' ? 1 : 0.5; // 노을에는 막 나오기 시작한다
  const bySeason = season === 'summer' ? 18 : 12;
  return Math.round(bySeason * byPhase);
}

/**
 * 영역 안에 무리를 흩뿌린다.
 *
 * `random`을 받는 이유는 테스트가 같은 배치를 다시 만들 수 있어야 하기 때문이다.
 */
export function spawnFireflies(area: FireflyArea, count: number, random: () => number): Firefly[] {
  const flies: Firefly[] = [];
  for (let i = 0; i < count; i += 1) {
    flies.push({
      x: area.x + random() * area.width,
      y: area.y + random() * area.height,
      driftX: 6 + random() * 14,
      driftY: 4 + random() * 10,
      periodMs: 2600 + random() * 3400,
      phase: random(),
    });
  }
  return flies;
}

/**
 * 지금 이 마리를 어디에 어떤 밝기로 찍는가.
 *
 * `still`이면 움직임을 줄여 달라는 요청이다(`design.md` §8). 위치를 궤도
 * 중심에 세우고 밝기도 중간으로 고정한다 — 끄지는 않는다. 반딧불이가 사라지면
 * 밤 배경이 허전해지고, 정지한 빛은 그 자체로 읽힌다.
 */
export function fireflyDotAt(fly: Firefly, elapsedMs: number, still = false): FireflyDot {
  if (still) {
    return {
      x: Math.round(fly.x),
      y: Math.round(fly.y),
      level: Math.round(FIREFLY_BLINK_STEPS / 2),
    };
  }

  const turn = (elapsedMs / fly.periodMs + fly.phase) * Math.PI * 2;
  const wave = (Math.sin(turn) + 1) / 2;

  return {
    // 정수로 스냅한다. 반 픽셀에 찍으면 캔버스가 두 픽셀에 걸쳐 흐리게 칠한다.
    x: Math.round(fly.x + Math.sin(turn) * fly.driftX),
    y: Math.round(fly.y + Math.sin(turn * DRIFT_RATIO) * fly.driftY),
    level: Math.round(wave * FIREFLY_BLINK_STEPS),
  };
}

/**
 * 밝기 단계를 알파로.
 *
 * `ring`은 중심에서 몇 칸 떨어졌는지다. 바깥으로 갈수록 한 단씩 옅어지고,
 * 사이값이 없어 정수 배율로 확대해도 색이 번지지 않는다.
 */
export function fireflyAlpha(level: number, ring: number): number {
  if (level <= 0 || ring >= FIREFLY_GLOW_RADIUS) return 0;
  const base = level / FIREFLY_BLINK_STEPS;
  const falloff = 1 / (ring + 1);
  return base * falloff;
}
