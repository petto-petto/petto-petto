# 창 크기·활성 펫 변경 시 전투 위치 유지

## 범위

- Track: `standard`. Seed: 기존 승인된 `battle-ui.md`의 동적 배치·지면·카메라 규칙과 사용자의 중앙 재시작 버그 수정 요청.
- 성공 기준: 현재 좌우 위치와 지면 깊이 유지, 축소 시 최소 경계 보정, 카메라 유지, resize 중에도 보행·공격 계속 진행.
- 제외: 다른 기능 패키지·공통 Client·DB·Electron 호스트 변경, 새 저장 데이터, 두더지 전용 애니메이션 초안 구현.

## 변경

- Explorer: `ArenaDirector`가 크기·펫 식별자·진화 에셋·테마·시계 공백을 모두 신규 중앙 배치로 처리했다. 예전 테스트도 이 초기화를 기대하고 있었다.
- Planner: 최초 배치와 이후 좌표 보정을 분리한다. 현재 표시 좌표에서 교체하고, resize에는 보행·공격 시계를 유지한다. 지면을 옮기면 카메라 기준점·기록과 추격 경로 시작점도 함께 옮긴다.
- Implementer: `src/view/arena.ts`, `src/view/pursuit.ts`만 수정했다. 도약 중 창을 키워도 점프 높이가 갑자기 커지지 않으며, 축소하면 안전한 높이로 제한한다. 펫 교체·시계 공백은 이전 공격을 취소하지만 중앙으로 돌아가지 않는다.

## 검증 기록

- 단위 RED `e5aa300`: 37개 중 7개가 중앙 복귀·카메라 초기화·resize 시계 재시작으로 실패했다.
- 브라우저 RED `5181804`: 실제 렌더러에서 펫 선택·가로 확대·복구의 3개 위치 유지 검사가 실패했다.
- GREEN `41ea2c6`: 관련 67개 테스트 통과. 변경 모듈 커버리지 line 99.45%, branch 98.15%, function 100%.
- Mechanical: `bash .harness/scripts/verify-electron.sh`의 포맷·타입 검사와 전체 399개 테스트 통과.
- Semantic: 격리 브라우저 `--continuity-only`의 9개 검사, `--cadence-only`, `--fixture-only` 통과. 펫 선택·스프라이트 교체·폭 확대/복구에서 펫 X=153.22, 적 X=301.3136과 카메라가 유지됐다. 세 창 크기·HP 100/60/25%의 공격 순서와 STOP·메뉴도 확인했다. 사용자 DB는 열지 않았다.
- Independent Review: 차단 이슈 없음. 별도 검토자가 집중 테스트 53/53을 재실행했다. 공격·도약 중 크기 변경 23,040프레임, STOP·펫 변경·선택 해제·시계 공백·HP·테마·크기 변경 조합 120,000프레임을 추가 확인해 화면 이탈·최소 간격 위반이 없었다.
- 남은 검증 공백: 없음. 실제 사용자 앱·저장 데이터 대신 동일 렌더러의 격리 브라우저를 사용했다.
- Evolve: 초기 배치와 크기·선택 변경의 위치 보존 규칙을 `battle-ui.md`에 기록한다.

## 재검증

```bash
npm run build --workspace @pet/battle
node --test packages/pet-battle/test/position-continuity.test.ts packages/pet-battle/test/arena.test.ts
node packages/pet-battle/test/arena.browser.cjs --continuity-only
node packages/pet-battle/test/arena.browser.cjs --cadence-only
node packages/pet-battle/test/arena.browser.cjs --fixture-only
bash .harness/scripts/verify-electron.sh
```
