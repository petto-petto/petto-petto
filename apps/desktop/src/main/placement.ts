/** 창 배치 계산. Electron 을 모르므로 창 없이 시험할 수 있다. */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 두 사각형이 넓이를 갖고 겹치는가. 모서리만 맞닿은 것은 겹친 것이 아니다. */
export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
