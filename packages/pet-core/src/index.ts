/**
 * # @pet/core — 공용 커널
 *
 * 이 패키지에는 **계약만** 둔다. 업무 규칙은 한 줄도 넣지 않는다.
 *
 * 1. 다섯 도메인(meta, collection, gacha, battle, overlay-growth)이 서로를 직접
 *    의존하지 않게 하려면, 서로가 알아야 할 최소한의 어휘를 담는 중립 지점이 필요하다.
 * 2. 여기에 로직이 들어가기 시작하면 모든 도메인이 이 패키지를 고쳐야 하고, 결국
 *    "공용 커널"이 아니라 "공용 쓰레기통"이 된다. 그래서 규칙으로 못박는다.
 */

export * from './ids.ts';
export * from './clock.ts';
export * from './events.ts';
export * from './ports.ts';
