/**
 * 스프라이트 경로 조립과 프레임 진행.
 *
 * 에셋 가이드가 실패 원인 1~4순위로 꼽은 규칙들이 전부 여기 있다. 렌더러가 아니라
 * 도메인에 두는 이유는 하나다 — **창을 띄우지 않고 검증할 수 있어야 한다.** 지금까지
 * 이 규칙들은 `renderer/pet.js` 안에만 있었고 테스트가 하나도 없었다.
 */

import type { Rarity } from '@pet/core';
import type { PetStage } from './pet.ts';

/** 사용 가능한 모션. **walk가 없다** — 배회는 idle을 유지한 채 위치만 옮겨서 만든다. */
export type PetMotion = 'idle' | 'click' | 'click2' | 'attack';

/** 클릭 반응용 모션. 한 종만 쓰면 반복 클릭이 죽어 보인다(가이드 §8). */
export const CLICK_MOTIONS: readonly PetMotion[] = ['click', 'click2'];

/**
 * 모션 시트 옆 `.json`의 내용.
 *
 * `_card.png`만 예외적으로 메타가 없다 — 정지 이미지 한 장이라서다(가이드 §5).
 */
export interface SpriteMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  fps: number;
  loop: boolean;
}

/**
 * 에셋 경로. 가이드 §1의 폴더 구조를 그대로 조립한다.
 *
 * 등급 폴더는 **소문자**이고 `pet.json`의 `grade`는 대문자다. 그 변환이 여기서 일어난다.
 *
 * 반환값은 **에셋 루트 기준 상대 경로**다(`pets/…`). 루트가 어디인지는 이 함수가 알지
 * 못한다 — 창을 여는 쪽이 `?assets=` 로 알려 주고, UI 의 `assetUrl()` 이 합친다.
 * 선두 슬래시를 붙이면 안 된다. `loadFile` 로 뜬 창에서 그것은 파일 시스템 루트다.
 */
export function petAssetPath(
  rarity: Rarity,
  slug: string,
  petId: string,
  stage: PetStage,
  motion: PetMotion | 'card',
): string {
  return `pets/${rarity.toLowerCase()}/${slug}/stage${stage}/pet_${petId}_s${stage}_${motion}.png`;
}

/** 시트 PNG 옆의 메타 경로. `card`에는 쓰면 안 된다(가이드 §5). */
export function spriteMetaPath(pngPath: string): string {
  return pngPath.replace(/\.png$/, '.json');
}

/**
 * 프레임 i의 소스 사각형. 가로 1행이라 y는 항상 0이다(가이드 §4).
 *
 * `frameWidth`를 32로 하드코딩하면 EPIC stage3(48px)만 잘린다. 그래서 이 함수는 크기를
 * 인자로만 받고 상수를 갖지 않는다.
 */
export function frameRect(
  meta: SpriteMeta,
  frameIndex: number,
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: frameIndex * meta.frameWidth,
    sy: 0,
    sw: meta.frameWidth,
    sh: meta.frameHeight,
  };
}

/**
 * 경과 시간 → 프레임 번호.
 *
 * 루프 모션은 순환하고, **1회 재생 모션은 마지막 프레임에서 멈춘다**(가이드 §5). 1회
 * 재생을 루프로 처리하면 재생 끝에 툭 튄다.
 */
export function frameIndexAt(meta: SpriteMeta, elapsedMs: number): number {
  const advanced = Math.floor(Math.max(0, elapsedMs) / (1000 / meta.fps));
  if (meta.loop) return advanced % meta.frameCount;
  return Math.min(advanced, meta.frameCount - 1);
}

/** 1회 재생 모션의 총 길이. 이 시간이 지나면 idle로 돌아간다(가이드 §8). */
export function motionDurationMs(meta: SpriteMeta): number {
  return (meta.frameCount / meta.fps) * 1000;
}

/**
 * 1회 재생이 끝났는가. `loop`인 모션은 영원히 끝나지 않는다.
 */
export function isMotionFinished(meta: SpriteMeta, elapsedMs: number): boolean {
  return !meta.loop && elapsedMs >= motionDurationMs(meta);
}

/**
 * click / click2 중 하나를 고른다.
 *
 * 난수를 인자로 받는다 — 그래야 "두 종이 모두 뽑힌다"를 테스트할 수 있다. 두 종은 서로
 * 다른 감정(놀람 / 기뻐서 폴짝)으로 제작되어 있어 번갈아 나와야 반응이 살아 있다.
 */
export function pickClickMotion(random: number): PetMotion {
  const index = Math.min(CLICK_MOTIONS.length - 1, Math.floor(random * CLICK_MOTIONS.length));
  return CLICK_MOTIONS[index] ?? 'click';
}
