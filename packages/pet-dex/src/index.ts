/**
 * # @pet/dex — 펫 도감
 *
 * 등록된 모든 종을 슬롯으로 보여 주고, 만난 종은 컬러와 보유 수로, 못 만난 종은 실루엣으로
 * 그린다. 기획서는 `.harness/specs/features/2026-10-05-pet-dex.md`다.
 *
 * | 경로 | 역할 |
 * |---|---|
 * | `domain/dex.ts` | 화면 모델: 슬롯 상태, 진행도·탭, 획득 경로, 펫룸 포커스 대상 |
 * | `bridge.ts` | 도감 창 preload API 타입 |
 * | `ui/app.ts` | 화면 렌더러. 규칙 없이 화면 모델을 DOM 에 옮긴다 |
 *
 * 데이터는 펫 도메인의 `PetClient.listDexEntries()`가 정본이다. 이 패키지는 그 타입만 읽는다.
 */

export * from './domain/dex.ts';
export * from './bridge.ts';
