# 중복 없는 전투 응원 펫 작업 결과

## Track and Seed

Standard. 요청자는 2026-10-07 명세 기준으로 구현 진행을 승인했다.
Seed: [승인 명세](../.harness/specs/features/2026-10-07-unique-battle-spectators.md).
최신 main `27ffe43`에서 `feature/srkim0917/battle-unique-cheering-pets`로 작업한다.

성공 기준은 응원 펫의 종류·진화 단계 중복 제거, 활성 펫과 같은 모습 제외,
다른 단계 허용, 후보 부족 시 중복 보충 금지, 성장 변경 시 후보 갱신이다.
레이아웃, 애니메이션, 성장 저장 및 전투 규칙은 범위 밖이다.

## Explorer

`OwnedPetBattleGateway`가 펫룸 어댑터의 스냅샷을 읽어 응원 개체 ID를 선택한다.
기존 `selectRandomPetSpectators`는 활성 개체 ID만 제외하며 모습 중복은 허용했다.
선택 캐시도 개체 ID만 비교해 진화 변경을 감지하지 않았다.
`RoomBattlePetAdapter`는 저장된 성장 데이터를 반영한 sprite와 evolutionStage를 제공한다.
실제 UI는 선택된 ID의 스프라이트를 표시하므로 UI 변경은 필요 없다.

## Planner

1. 종류·단계 중복, 활성 모습 제외, 다른 단계 허용, 빈 후보의 실패 테스트를 추가한다.
2. sprite·evolutionStage 조합을 중복 키로 사용하고 기존 무작위 최대 세 마리 선택을 유지한다.
3. 캐시 키에 sprite·evolutionStage를 포함해 성장 시 후보를 갱신한다.
4. 펫룸 통합 경로에서 중복 제외 및 활성 펫 진화 후의 후보 변경을 확인한다.
5. 공유 Electron 검증과 diff 리뷰를 수행한다.

## Implementer

초기 집중 테스트는 22개 중 19개 통과, 새 동작 테스트 3개 실패로 문제를 재현했다.
구현 후 같은 집중 테스트 22개가 모두 통과했다.
추가 펫룸 통합 테스트를 포함한 room-selection 테스트 8개도 모두 통과했다.
변경은 선택 함수, 선택 캐시, 세 테스트 파일 및 명세·작업 결과에 한정된다.
저장 형식, IPC, 외부 도메인 Port는 변경하지 않는다.

## Verifier

Mechanical: `bash .harness/scripts/verify-electron.sh`를 Git Bash로 실행해
`npm run format:check`, `npm run typecheck`, `npm test`가 모두 통과했다
(최종 전체 602개 통과, 실패 0개). `git diff --check`도 통과했다.

Semantic: 집중 테스트가 종류·단계 중복 및 활성 모습 제외, 0·2단계 허용,
부족한 후보와 활성 없음, 종류·단계 변경 후 갱신을 확인한다.
펫룸 통합 테스트는 활성 0단계일 때 1·2단계 허용, 활성 1단계로 변경 후
0·2단계 허용 및 같은 1단계 제외를 확인한다.

## Reviewer

구현과 별도 리뷰 단계에서 호출 경로, 변경 diff 및 테스트를 다시 검토했다.
후보가 많은 경우에는 기존 shuffle과 세 마리 제한을 유지하고, 같은 모습의 보유 수는
선택 확률을 늘리지 않는다. 선택 함수는 입력 목록을 변경하지 않는다.
캐시는 XP·이름 변경에는 재선택하지 않고 실제 후보 모습 변경에만 반응한다.
범위 이탈 또는 미해결 코드 지적 없음. 앱을 실행한 시각 검증은 수행하지 않았다.

## Evolve

None. 별도 harness 변경이 필요한 반복 문제는 확인하지 않았다.
