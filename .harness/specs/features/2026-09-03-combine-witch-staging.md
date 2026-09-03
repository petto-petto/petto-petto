# Feature specification: 합성 제단 배경 연출

## Status

Approved (요청자 승인, 2026-09-03)

## Owner

동우 (요청자)

## Problem and user outcome

합성 배경의 양쪽 수정 군락은 의도한 광물로 읽히지 않는다. 사용자는 합성 화면에서
항아리와 마법광을 통해 재료가 상위 등급 펫으로 합성되는 장면을 즉시 이해할 수 있어야 한다.

## Scope

- `bg_003_arcane_combine_cavern`에서 좌우 수정 군락을 제거한다.
- 중앙 하단 제단을 합성용 항아리로 표현한다.
- 항아리 위에는 작은 픽셀 버블만 짧게 반복한다.
- `prefers-reduced-motion`에서는 버블 모션을 정지한다.

## Non-goals

- 합성 확률·재료 소모·결과 등 도메인 규칙 구현
- 카드 배치와 합성 화면의 나머지 UI 구현
- 마녀를 포함한 별도 캐릭터 연출

## Domain rules

1. 항아리는 중앙 카드/결과 연출 영역을 가리지 않는다.
2. 버블 애니메이션은 장식성 반복이므로 모션 감소 환경에서는 정지한다.
3. 배경은 어두운 동굴 톤을 유지하고, 발광은 항아리와 합성 위치에만 집중한다.

## Acceptance criteria

- 합성 배경에 좌우 수정 군락이 보이지 않는다.
- 항아리 위에 작은 픽셀 버블이 보인다.
- 기본 환경에서 버블이 반복되고, 모션 감소 환경에서는 정지한다.
- 중앙 카드/결과 영역의 60%가 항아리에 가려지지 않는다.
- 배경 산출물은 `bg_check.py`를 통과하며, 변경된 TypeScript가 있으면 Electron 검증 게이트를 실행한다.

## Edge and error cases

- 좁은 화면에서는 항아리를 중앙 연출 영역보다 바깥으로 이동하지 않는다.

## API and data impact

없음. 정적 런타임 에셋과 CSS 애니메이션만 추가한다.

## Open questions

없음.

## Related implementation plan

요청자 승인 후 작성.
