/**
 * # @pet/shell — 640 화면들의 공통 틀
 *
 * 기능 패키지는 서로를 import 하지 않는다(`.harness/rules/feature-contracts.md`). 그런데 펫룸·뽑기·
 * 합성·도감은 한 창처럼 보여야 해서 같은 틀이 필요하다. 그 틀을 여기 둔다.
 *
 * - 상단 바: `ui/topbar.css`와 `dist/ui/topbar.js`. 화면은 `<header class="petto-topbar">`만 둔다.
 * - 공통 디자인 토큰: `ui/tokens.css`. `design.md`의 공통 값(글꼴, 금색, 비활성 회색, 나무·양피지)이다.
 * - 토큰 금액 표기: `compactAmount`.
 *
 * 이 패키지는 다른 패키지를 import 하지 않는다. 화면이 번들러 없이 상대 경로로 읽기 때문이다.
 */

export * from './format.ts';
export * from './tabs.ts';
