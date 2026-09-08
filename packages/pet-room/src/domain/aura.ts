/**
 * 활성 펫 주변의 등급 오라.
 *
 * ## 왜 규칙이 여기 있는가
 *
 * 고리 수·맥동 위상은 시각이 아니라 **계산**이다. 캔버스에 그리는 코드 안에 두면 창을
 * 띄우지 않고는 "EPIC이 COMMON보다 두껍다", "움직임을 줄이면 맥동이 멈춘다"를 확인할 수
 * 없다. 색만 렌더러(CSS 변수)가 가진다 — 팔레트는 디자인 토큰이지 규칙이 아니다.
 *
 * ## 가챠와 같은 눈금
 *
 * 등급이 올라갈수록 길고 두껍게 간다. 주기는 `@pet/gacha`의 `introDuration`과 같은 값이다
 * (1800 / 2400 / 3200ms). 두 화면이 같은 등급을 같은 속도로 말해야 "이 색과 이 리듬이
 * EPIC"이라는 것이 학습된다. 다만 **묶어 두지는 않는다** — 한쪽의 연출 길이를 바꾸는 것이
 * 다른 쪽을 강제로 바꿔야 할 이유는 없고, 어긋나도 기능이 아니라 인상만 달라진다.
 *
 * ## 금색은 왜 남는가
 *
 * design.md §2는 금색을 현재 선택에 **예약**하고, 등급 색은 등급을 말하는 데만 쓰라고
 * 한다. 오라를 등급 색으로만 칠하면 COMMON(`#9AA0A6`)이 숲 배경 위에서 선택 표시로 읽히지
 * 않는다. 그래서 가장 안쪽 고리 하나는 금색으로 둔다 — 등급은 색이, 선택은 금색 고리와
 * "오라가 있다는 사실" 자체가 말한다. 색 하나에만 기대지 않는다(design.md §8).
 */

import type { Rarity } from '@pet/core';

/** 오라 색을 고르는 토큰 이름. 실제 색은 `petroom.css`의 `--grade-*`가 가진다. */
export type AuraToken = 'common' | 'rare' | 'epic';

export interface AuraSpec {
  token: AuraToken;
  /** 등급 색 고리 수. 금색 고리는 여기 세지 않는다. */
  rings: number;
  /** 한 번 맥동하는 데 걸리는 시간(ms). */
  periodMs: number;
}

const AURA: Readonly<Record<Rarity, AuraSpec>> = {
  COMMON: { token: 'common', rings: 3, periodMs: 1_800 },
  RARE: { token: 'rare', rings: 4, periodMs: 2_400 },
  EPIC: { token: 'epic', rings: 5, periodMs: 3_200 },
};

export function auraOf(rarity: Rarity): AuraSpec {
  return AURA[rarity];
}

/** 한 겹. `offset`은 펫 상자에서 바깥으로 몇 픽셀인지다. */
export interface AuraRing {
  offset: number;
  alpha: number;
}

/** 맥동을 나누는 칸 수. 연속으로 밝히면 도트 화면에서 색이 뭉개진다(design.md §4). */
export const AURA_PULSE_STEPS = 4;

/**
 * 오라를 펫 실루엣에서 얼마나 부풀려 **둥글게** 만들지.
 *
 * 0 이면 오라가 팔·다리·귀를 그대로 따라 흘러서, 빛이라기보다 펫을 한 겹 더 그린 것처럼
 * 보인다. 이만큼 부풀리면 다리 사이나 귀 옆의 좁은 홈이 메워져 덩어리진 빛으로 읽힌다.
 *
 * 고리 오프셋과 **더해져서** 쓰인다 — 원판으로 부풀리는 연산은 반지름이 더해지므로
 * (민코프스키 합), 렌더러가 `AURA_ROUNDNESS + ring.offset` 한 번으로 끝낼 수 있다.
 */
export const AURA_ROUNDNESS = 3;

/**
 * 지금 그려야 할 고리들. 바깥으로 갈수록 옅어진다.
 *
 * 값이 커 보이는 이유: 렌더러가 이 알파를 **겹치지 않는 띠 하나에 그대로** 쓴다. 예전에는
 * 실루엣을 여덟 방향으로 화면에 직접 겹쳐 찍어 알파가 `1-(1-α)^n` 으로 누적됐고, 그래서
 * 0.6 이 화면에서는 거의 불투명이었다. 누적을 없애고 나니 같은 숫자가 너무 옅어져 COMMON
 * 회색이 숲 배경에서 사라졌다 — 숫자를 화면에 맞춰 올린 것이지 연출을 세게 한 것이 아니다.
 *
 * 맥동은 **칸으로** 움직인다. `AURA_PULSE_STEPS` 칸을 오가며 밝기를 바꾸므로 중간값이 없고,
 * 정수 배율 화면에서 색이 번지지 않는다.
 *
 * `reducedMotion`이면 맥동을 멈추고 가장 밝은 칸에 고정한다 — 선택 표시는 정보라서 없앨 수
 * 없고, 없애도 되는 것은 움직임뿐이다(design.md §8).
 */
export function auraRingsAt(spec: AuraSpec, elapsedMs: number, reducedMotion: boolean): AuraRing[] {
  const step = reducedMotion ? 0 : pulseStep(spec, elapsedMs);
  // 0칸일 때 가장 밝고, 칸이 멀어질수록 어두워진다.
  const pulse = 1 - (step / AURA_PULSE_STEPS) * 0.5;

  const rings: AuraRing[] = [];
  for (let index = 0; index < spec.rings; index += 1) {
    rings.push({
      // 금색 선택 고리(1px) 바로 바깥부터 2px 간격. 겹치면 등급 색이 금색에 먹힌다 —
      // 실제로 COMMON 회색이 금색 테두리에 완전히 가려져 등급이 안 보였다.
      offset: 2 + index * 2,
      alpha: round2((0.85 - index * 0.15) * pulse),
    });
  }
  return rings;
}

/** 삼각 왕복. 0 → 최대 → 0 으로 돌아오므로 한 바퀴가 튀지 않는다. */
function pulseStep(spec: AuraSpec, elapsedMs: number): number {
  const half = AURA_PULSE_STEPS;
  const cycle = Math.floor((elapsedMs / spec.periodMs) * half * 2) % (half * 2);
  return cycle < half ? cycle : half * 2 - cycle;
}

function round2(value: number): number {
  // 위아래로 모두 자른다. 상한이 없으면 경과 시간이 음수로 들어왔을 때 맥동이 최대치를
  // 넘어 `globalAlpha` 가 무시되고 **직전 알파가 그대로 남는다** — 안 그려지는 게 아니라
  // 엉뚱한 밝기로 그려져서 눈으로만 잡힌다.
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}
