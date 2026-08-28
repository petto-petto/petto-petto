/**
 * 패널 배치 규칙. 기획서 4.2·META-002가 이 파일의 명세다.
 *
 * ## 왜 창 API가 아니라 순수 함수인가
 *
 * "펫이 화면 오른쪽이면 왼쪽, 좌우가 모두 부족하면 위쪽, 그리고 모니터 작업 영역 안으로
 * 보정" — 이 규칙은 창을 띄우지 않고도 판단할 수 있는 산수다. 창 API에 섞어 두면
 * 검증하려고 매번 앱을 켜서 눈으로 봐야 하고, 멀티모니터 경계 같은 경우는 재현조차 어렵다.
 *
 * 그래서 좌표 계산만 떼어 내 여기에 두고, Electron 쪽은 이 함수가 돌려준 좌표를 창에
 * 적용하기만 한다.
 */

import { PANEL_HEIGHT, PANEL_WIDTH } from '../settings/index.ts';

/** 논리 픽셀 사각형. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rectRight = (rect: Rect): number => rect.x + rect.width;
export const rectBottom = (rect: Rect): number => rect.y + rect.height;
export const rectCenterX = (rect: Rect): number => rect.x + rect.width / 2;

/** 패널이 펫을 기준으로 어디에 놓였는가. 테스트와 디버깅에서 의도를 확인하는 데 쓴다. */
export type PanelSide = 'left' | 'right' | 'above';

export interface PanelPlacement {
  x: number;
  y: number;
  side: PanelSide;
}

/** 펫과 패널 사이 여백. */
export const PANEL_GAP = 12;

function clamp(value: number, low: number, high: number): number {
  if (low > high) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * 패널 위치를 정한다.
 *
 * 기획서 4.2의 우선순위를 그대로 따른다.
 *
 * 1. 펫이 화면 오른쪽이면 왼쪽, 왼쪽이면 오른쪽
 * 2. 좌우 공간이 모두 부족하면 펫 위쪽
 * 3. 어느 경우든 펫이 있는 모니터의 작업 영역 안으로 이동
 */
export function placePanel(pet: Rect, workArea: Rect): PanelPlacement {
  const leftX = pet.x - PANEL_GAP - PANEL_WIDTH;
  const rightX = rectRight(pet) + PANEL_GAP;

  const fitsLeft = leftX >= workArea.x;
  const fitsRight = rightX + PANEL_WIDTH <= rectRight(workArea);

  // 펫이 모니터의 오른쪽 절반에 있으면 왼쪽을 먼저 시도한다.
  const petOnRightHalf = rectCenterX(pet) >= rectCenterX(workArea);
  const order: readonly (readonly [PanelSide, number, boolean])[] = petOnRightHalf
    ? [
        ['left', leftX, fitsLeft],
        ['right', rightX, fitsRight],
      ]
    : [
        ['right', rightX, fitsRight],
        ['left', leftX, fitsLeft],
      ];

  for (const [side, x, fits] of order) {
    if (!fits) continue;
    // 세로는 펫과 가운데를 맞추고 작업 영역 안으로 보정한다.
    const y = clamp(
      pet.y + pet.height / 2 - PANEL_HEIGHT / 2,
      workArea.y,
      Math.max(rectBottom(workArea) - PANEL_HEIGHT, workArea.y),
    );
    return { x, y, side };
  }

  // 좌우가 모두 부족하면 위쪽에 놓는다.
  return {
    x: clamp(
      rectCenterX(pet) - PANEL_WIDTH / 2,
      workArea.x,
      Math.max(rectRight(workArea) - PANEL_WIDTH, workArea.x),
    ),
    y: clamp(
      pet.y - PANEL_GAP - PANEL_HEIGHT,
      workArea.y,
      Math.max(rectBottom(workArea) - PANEL_HEIGHT, workArea.y),
    ),
    side: 'above',
  };
}
