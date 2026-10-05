/**
 * 뽑기 가능 알림. 기획서 6.3 이 이 파일의 명세다.
 *
 * > 뽑기 가능은 잔액이 뽑기 비용 미만에서 이상으로 바뀌는 순간 한 번만 표시한다. 잔액이 다시
 * > 비용 미만으로 내려간 뒤 재상승해야 다시 표시할 수 있다.
 *
 * "가능한 상태"가 아니라 **"가능해진 순간"**을 알리는 것이 핵심이다. 그래서 판단에는 지금
 * 잔액뿐 아니라 직전에 본 상태가 필요하다.
 */

/** 펫이 말풍선으로 하는 말. */
export const GACHA_READY_BUBBLE = '뽑기를 할 수 있어!';

export interface GachaReadyTransition {
  /** 지금 뽑기 1회를 할 수 있는가. 다음 판단의 "직전 상태"가 된다. */
  affordable: boolean;
  /** 이번에 불가에서 가능으로 넘어갔는가. */
  notify: boolean;
}

/**
 * 직전 상태와 지금 잔액으로 알릴지를 정한다.
 *
 * `wasAffordable` 이 `undefined` 면 처음 보는 것이다. 처음 본 상태는 "바뀐 순간"이 아니므로
 * 알리지 않는다 — 앱을 켤 때마다 이미 뽑을 수 있다는 말을 다시 듣게 하지 않는다.
 */
export function gachaReadyTransition(
  wasAffordable: boolean | undefined,
  balance: number,
  drawCost: number,
): GachaReadyTransition {
  const affordable = balance >= drawCost;
  return { affordable, notify: wasAffordable === false && affordable };
}
