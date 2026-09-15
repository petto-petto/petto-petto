/**
 * # @pet/room — 펫룸
 *
 * 숲 배경 위에서 보유 펫 전원이 동시에 배회하는 화면의 **규칙**을 담는다.
 *
 * ## 여기에 창도 캔버스도 없는 이유
 *
 * `@pet/meta`와 같은 원칙이다. Electron도 DOM도 의존하지 않는다. 그래서 "배회하는 펫이
 * 영역 밖으로 나가지 않는다", "1회 재생 모션은 마지막 프레임에서 멈춘다", "18시에는 밤
 * 배경을 쓴다" 같은 규칙을 **창을 띄우지 않고** `node --test`로 검증할 수 있다.
 *
 * 렌더러(`apps/desktop/renderer/petroom.js`)는 이 패키지의 컴파일 결과를 `<script
 * type="module">`로 직접 import한다. Electron은 `file:` 스킴에서 ESM import와 `fetch`를
 * 둘 다 허용하므로 번들러가 필요 없다.
 *
 * ## 내부 구조
 *
 * | 폴더 | 역할 |
 * |---|---|
 * | `domain/pet.ts` | 보유 펫 명부·종 카탈로그·활성 펫 |
 * | `domain/sprite.ts` | 에셋 경로 조립과 프레임 진행 (에셋 가이드 §1·§5·§7·§8) |
 * | `domain/scene.ts` | 배경 계약·낮밤 선택·배회 영역·위치 갱신·클릭 판정 |
 * | `persistence/` | 저장 형식과 저장소 포트 |
 *
 * ## 의존 방향
 *
 * `@pet/room` → `@pet/core` 한 방향뿐이다. `@pet/meta`를 의존하지 않는다 — meta가
 * 요구하는 `CollectionPort`를 이 패키지로 채우는 어댑터는 **앱**이 갖는다
 * (`apps/desktop/src/main/collection.ts`).
 */

export * from './domain/pet.ts';
export * from './domain/sprite.ts';
export * from './domain/scene.ts';
export * from './persistence/snapshot.ts';
