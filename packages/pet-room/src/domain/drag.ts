/**
 * 장면을 눌러 창을 옮기는 규칙.
 *
 * 장면은 펫 클릭을 받아야 하므로 `-webkit-app-region: drag`를 쓸 수 없다 — 그 영역은 마우스
 * 이벤트를 OS가 가져가 클릭이 렌더러에 닿지 않는다. 그래서 누른 뒤 조금이라도 움직였는지로
 * 클릭과 끌기를 가른다. 좌표는 모두 화면 절대 좌표다. 창이 움직이는 동안 창 기준 좌표는
 * 창과 함께 밀리기 때문이다.
 */

/** 이만큼 움직이기 전까지는 클릭이다. 손떨림으로 펫 클릭이 끌기로 바뀌지 않게 한다. */
export const DRAG_THRESHOLD_PX = 4;

export interface ScreenPoint {
  readonly screenX: number;
  readonly screenY: number;
}

/** 끌기를 시작한 순간의 창 위치와 포인터 위치. */
export interface DragOrigin extends ScreenPoint {
  readonly windowX: number;
  readonly windowY: number;
}

/** 누른 곳에서 직선거리로 문턱 이상 움직였으면 끌기다. 대각선으로 끌어도 같은 거리에서 시작한다. */
export function isDragGesture(start: ScreenPoint, current: ScreenPoint): boolean {
  return (
    Math.hypot(current.screenX - start.screenX, current.screenY - start.screenY) >=
    DRAG_THRESHOLD_PX
  );
}

/** 창은 누른 뒤 포인터가 움직인 만큼 따라간다. 창 위치는 정수 픽셀이어야 한다. */
export function windowPositionDuringDrag(
  origin: DragOrigin,
  pointer: ScreenPoint,
): { x: number; y: number } {
  return {
    x: Math.round(origin.windowX + pointer.screenX - origin.screenX),
    y: Math.round(origin.windowY + pointer.screenY - origin.screenY),
  };
}
