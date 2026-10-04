/**
 * 떨어지는 것들 — 눈 · 꽃잎 · 낙엽.
 *
 * 반딧불이(`firefly.ts`)는 제자리를 맴돌지만 이쪽은 위에서 아래로 지나간다.
 * 셋의 차이는 **속도 · 흔들림 · 색**뿐이라 한 곳에 둔다.
 *
 * ## 순환이 핵심이다
 *
 * 화면 아래로 나간 입자를 지우고 새로 만들면 마릿수가 출렁이고 난수를 계속
 * 쓰게 된다. 대신 **세로 위치를 화면 높이로 나눈 나머지**로 잡는다. 아래로
 * 나가는 순간 위에서 다시 들어오고, 상태를 들고 있을 필요가 없어 어느 시각을
 * 넣어도 같은 그림이 나온다(`fireflyDotAt`과 같은 규율이다).
 *
 * ## 좌표는 정수, 색은 단계
 *
 * `design.md` §4가 정수 배율과 `imageSmoothingEnabled = false`를 요구한다.
 * 반 픽셀에 찍으면 캔버스가 두 픽셀에 나눠 칠해 그 입자만 흐려진다. 그래서
 * 위치는 반올림하고, 깊이도 `WEATHER_DEPTHS` 단계로만 준다 — 먼 것은 작고
 * 흐리게, 가까운 것은 크고 진하게.
 */

import type { BackgroundPhase, Season } from './scene.ts';

/** 깊이 단계. 0이 가장 멀고 마지막이 가장 가깝다. */
export const WEATHER_DEPTHS = 3;

export const WEATHER_KINDS = ['snow', 'petal', 'leaf'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export interface WeatherParticle {
  /** 가로 기준 위치. 흔들림은 여기에 더해진다. */
  readonly x: number;
  /** 0~1. 화면 높이에 곱해 세로 위치가 된다. */
  readonly offset: number;
  /** 0 ~ `WEATHER_DEPTHS`-1. 크기·속도·진하기를 한꺼번에 정한다. */
  readonly depth: number;
  /** 좌우로 흔들리는 폭(px). */
  readonly swayX: number;
  /** 흔들림 주기. */
  readonly swayMs: number;
  readonly phase: number;
}

export interface WeatherDot {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  /** 한 변의 픽셀 수. 깊이가 정한다. */
  readonly size: number;
}

export interface WeatherArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 종류별 성격. 숫자를 한자리에 모아 두면 셋을 나란히 조율할 수 있다. */
interface WeatherProfile {
  /** 화면 높이를 한 번 지나는 데 걸리는 시간(가장 가까운 깊이 기준). */
  readonly fallMs: number;
  readonly swayMin: number;
  readonly swayMax: number;
  readonly swayMsMin: number;
  readonly swayMsMax: number;
  readonly color: string;
}

const PROFILES: Record<WeatherKind, WeatherProfile> = {
  // 눈은 곧게 내리고 흔들림이 작다.
  snow: {
    fallMs: 9000,
    swayMin: 3,
    swayMax: 10,
    swayMsMin: 2200,
    swayMsMax: 4200,
    color: '#FFFFFF',
  },
  // 꽃잎은 느리게, 크게 흔들리며 진다. 눈보다 옆으로 많이 간다.
  petal: {
    fallMs: 13000,
    swayMin: 10,
    swayMax: 26,
    swayMsMin: 1600,
    swayMsMax: 3200,
    color: '#F7B8D2',
  },
  // 낙엽은 꽃잎보다 무겁다. 조금 빠르고 흔들림은 비슷하다.
  leaf: {
    fallMs: 11000,
    swayMin: 8,
    swayMax: 22,
    swayMsMin: 1500,
    swayMsMax: 3000,
    color: '#E2823C',
  },
};

export function weatherColor(kind: WeatherKind): string {
  return PROFILES[kind].color;
}

/**
 * 계절이 무엇을 내리게 하는가.
 *
 * 여름은 비어 있다 — 반딧불이가 그 자리를 맡는다. 두 가지를 겹치면 화면이
 * 소란스러워진다.
 */
export function weatherFor(season: Season): WeatherKind | null {
  if (season === 'winter') return 'snow';
  if (season === 'spring') return 'petal';
  if (season === 'autumn') return 'leaf';
  return null;
}

/**
 * 몇 개를 띄울 것인가.
 *
 * 밤에는 줄인다. 어두운 화면에서 흰 점이 많으면 노이즈로 읽히고, 펫보다 눈에
 * 먼저 들어온다.
 */
export function weatherCountFor(season: Season, phase: BackgroundPhase): number {
  const kind = weatherFor(season);
  if (!kind) return 0;
  const base = kind === 'snow' ? 70 : 34;
  return phase === 'night' ? Math.round(base * 0.6) : base;
}

export function spawnWeather(
  area: WeatherArea,
  kind: WeatherKind,
  count: number,
  random: () => number,
): WeatherParticle[] {
  const profile = PROFILES[kind];
  const particles: WeatherParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: area.x + random() * area.width,
      offset: random(),
      depth: Math.min(WEATHER_DEPTHS - 1, Math.floor(random() * WEATHER_DEPTHS)),
      swayX: profile.swayMin + random() * (profile.swayMax - profile.swayMin),
      swayMs: profile.swayMsMin + random() * (profile.swayMsMax - profile.swayMsMin),
      phase: random(),
    });
  }
  return particles;
}

/**
 * 지금 이 입자를 어디에 찍는가.
 *
 * `still`이면 움직임을 줄여 달라는 요청이다(`design.md` §8). 떨어지는 것을
 * 멈추면 공중에 박힌 점이 되어 어색하므로, 흔들림만 끄고 세로는 시작 위치에
 * 세운다.
 */
export function weatherDotAt(
  particle: WeatherParticle,
  kind: WeatherKind,
  area: WeatherArea,
  elapsedMs: number,
  still = false,
): WeatherDot {
  const size = particle.depth + 1;
  // 가까운 것일수록 빨리 떨어진다. 먼 것은 느려서 원근이 생긴다.
  const speed = (particle.depth + 1) / WEATHER_DEPTHS;
  const fallMs = PROFILES[kind].fallMs / speed;

  const progress = still ? particle.offset : (particle.offset + elapsedMs / fallMs) % 1;

  const sway = still
    ? 0
    : Math.sin((elapsedMs / particle.swayMs + particle.phase) * Math.PI * 2) * particle.swayX;

  return {
    x: Math.round(particle.x + sway),
    y: Math.round(area.y + progress * area.height),
    depth: particle.depth,
    size,
  };
}

/**
 * 깊이를 알파로. 먼 것은 옅다.
 *
 * 연속값이 아니라 단계라서 정수 배율로 확대해도 색이 번지지 않는다 — 오라의
 * 맥동, 반딧불이의 빛 번짐과 같은 규율이다.
 */
export function weatherAlpha(depth: number): number {
  return (depth + 1) / WEATHER_DEPTHS;
}
