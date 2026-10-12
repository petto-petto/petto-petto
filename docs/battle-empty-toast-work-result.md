# 전투 창의 빈 알림 상자 수정

Track: lightweight. 성공 기준은 빈 살색 상자가 나타나지 않고 실제 알림만 표시되는 것이다.
XP, 애니메이션, 투명도 설정과 다른 UI 변경은 범위 밖이다.

원인: 전투 root의 자식 투명도 규칙이 알림 상자의 기본 opacity 0을 덮어썼다.
범위를 넓힌 이전 수정의 회귀이며, 알림 상자를 일괄 규칙에서 제외했다.
실제 visible 상태에는 전투 투명도를 적용하고 숨김 상태는 기존 opacity 0을 유지한다.

집중 증거: 실제 Electron에서 빈 알림의 opacity가 1로 나와 실패하는 테스트로 재현했다.
회귀 테스트는 빈 상태 숨김, 실제 알림의 35% 투명도, 만료 후 숨김 복귀까지 확인한다.

검증 명령: `npm run build:ui --workspace @pet/battle`,
Electron으로 `apps/desktop/test/battle-display.electron.cjs` 실행,
`bash .harness/scripts/verify-electron.sh`, `git diff --check`.
최종 실행 결과는 작업 응답에 기록한다.

Diff 리뷰: 변경 범위는 알림 상자의 CSS 적용 범위와 해당 Electron 회귀 검증에 한정된다.
다른 전투 요소의 투명도는 유지한다. 미해결 지적 없음.
