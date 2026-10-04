# 전투 Client 경계 리팩토링 작업 기록

앞부분은 각 시점 기록입니다. 최신 결과는 맨 아래 **펫룸 선택 읽기 연결 복구 — 2026-10-01** 절을 따릅니다. 저장 연결 제거는 유지됩니다.

## Track / Interview·Seed

`work standard`입니다. 요청자는 2026-09-30 “다 진행한 뒤 mr 리팩토링 진행”으로
[설계](../../../.harness/specs/features/2026-09-30-battle-integration.md)를 승인했습니다.
기준 HEAD는 `30c235d`입니다. 전투 동작 보존, 공통 변경의 소유자별 Client 격리,
루트 Rust 빌드 의존 제거와 실제 결과에 맞춘 MR 갱신이 성공 기준입니다.
공통 DB·성장 통합·새 명부 push·전투 디자인 변경·원격 push는 비목표입니다.

## Explorer

- 현재 전투는 `PetClient → PetBattleIntegration → Rust` 읽기 경계를 이미 갖고 있습니다.
  이 경계와 실제 종별 sprite·저장 XP 기반 진행은 유지합니다.
- 펫룸 뷰 변환·선택은 앱 `room.ts`에 있습니다. 별도의 기존 CollectionPort는 공통 선택을
  보지 못합니다. 같은 펫룸 화면 Client를 두 소비자에게 주입해야 합니다.
- 루트 build가 Rust를 강제하지만 `mountBattleIpc`는 원래 첫 승인 요청에서 지연 생성합니다.
  비동기 준비·실패·취소는 전투 소유로 추가하고 동기 팩터리의 기존 계약은 보존합니다.
- 공통 오버레이 이미지 경합 방지는 전투 소유가 아니므로 원래 수정과 테스트를 유지합니다.

## Planner

| 단계 | 변경                                   | 실패 재현 / 통과 조건                                                                              |
| ---- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | 펫룸 UI Client·PetClient Adapter       | 같은 종 다른 개체·별명·진화·빈 목록·조회 실패·선택 성공 후 push·무이중저장입니다.                  |
| 2    | 앱의 두 펫룸 소비자가 같은 Client 사용 | 펫룸·기존 `pet:overlay`·실제 Rust가 동일 개체를 조회합니다.                                        |
| 3    | 전투 비동기 준비·수명 경계             | 권한 검증 선행, 동시 준비 1회, 실패/재시도, 준비 중 창 닫기·앱 종료, ready 상태 보존입니다.        |
| 4    | 루트 Rust 빌드 제거·호스트 최소 조립   | 일반 앱 build는 Cargo를 호출하지 않고 첫 전투만 준비합니다. 명시 바이너리·데모는 유지합니다.       |
| 5    | 전체 회귀·문서 갱신                    | 공식 게이트, Rust·SQLite 통합, 격리 Electron, 변경 계층 커버리지, 독립 리뷰 후 MR §2를 갱신합니다. |

각 단계는 `tdd-workflow`의 RED 실행·체크포인트 → 구현 → 동일 테스트 GREEN·체크포인트로
진행합니다. 기존 미추적 HP 문서는 수정·커밋하지 않습니다.

## Implementer

| 체크포인트            | 결과                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `127a000`             | 앱 경계 4개 RED: 루트 Cargo 강제·같은 Client 미주입·수명 전역 상태·창 닫기 신호 누락입니다.   |
| `d338f27`             | 펫룸 Client 계약·기존 조회의 오래된 선택·창 닫기 구독 RED를 기록했습니다.                     |
| `686f675`             | 비동기 팩터리·취소·준비 모듈 부재의 RED를 기록했습니다.                                       |
| `e9295e9`             | Cargo 실행 어댑터 부재·실패/취소 계약의 RED를 기록했습니다.                                   |
| `1721ff9`             | RoomPetClient·Adapter, 앱의 같은 Client 주입, 전투 지연 준비·수명 포트의 GREEN입니다.         |
| `7bf8f5e`             | 취소 후 SIGTERM을 무시하는 빌드 후손까지 남는 실제 실행 RED 2건입니다.                        |
| `83189ca`             | POSIX 전용 프로세스 그룹 즉시 종료·Windows 제한 시간 있는 트리 종료의 GREEN입니다.            |
| `02e0932` → `06892b1` | macOS의 종료 직후 일시 EPERM RED → 확인 전용 재시도 GREEN입니다. 영구 오류는 숨기지 않습니다. |

펫룸 데이터 변환은 `packages/pet-room/src/client.ts`, 전투 준비는
`packages/pet-battle/src/runtime/{prepare,cargo}.ts`, 전투 수명은 `src/ipc/host.ts`가
소유합니다. 앱에는 주입·기존 IPC/push·창 신호를 남겼습니다. 루트 build는 main과
동일하며 DB·공통 Client·성장 소유 코드와 전투 화면·Rust 규칙은 바꾸지 않았습니다.

## Verifier / Reviewer

| 검증                                               | 이번 실행 결과                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 전체 `npm run build`                               | 통과. 루트에서 Cargo를 호출하지 않았습니다.                                                                                              |
| 공식 `bash .harness/scripts/verify-electron.sh`    | 포맷·타입·전체 패키지 484/484 통과. 최초 문서 포맷 경고는 보정 후 재실행했습니다.                                                        |
| `npm run test:rust --workspace @pet/battle`        | 46/46 통과입니다.                                                                                                                        |
| `npm run test:integration --workspace @pet/battle` | 실제 Rust 연동 3/3 통과입니다.                                                                                                           |
| `npm run test:storage --workspace @pet/desktop`    | 82건 중80통과·2실패. ccusage 바이너리 부재, token 테스트의 meta scope 누락이며 main 재현과 같습니다.                                     |
| 집중 계약                                          | 앱/룸/창22개, 전투 런타임86개 통과입니다.                                                                                                |
| 변경 계층 커버리지                                 | 펫룸 Adapter(dist/client.js)의 라인·분기·함수100%, 전투 node/host/runtime 라인97.31%·분기92.31%·함수100%입니다. 전체 앱 수치가 아닙니다. |
| 실제 Electron                                      | 임시 SQLite/프로필로 공통 펫 선택·실제 에셋·공격·STOP/START·수동 타격·검·닫기·재진입 PAUSED/35% 보존, 단독 데모 통과입니다.              |
| 실제 반응형 DOM                                    | 4크기×소·중·대12조건에서 펫96px·지면 오차0px·버튼 범위·투명도35%, 수동 타격239프레임 이탈 없음·오류0입니다.                              |
| 두더지                                             | 격리 브라우저3단계·3크기, 전용 동작·원본 팔·등급·취소·자동 전투·모션 감소 통과, 오류0입니다.                                             |

Semantic 실행은 `test/attack.electron.cjs`, `test/window-layout.browser.cjs`,
`test/arena.browser.cjs --mole-only`, `--camera-only`입니다. 카메라는 실제961프레임 중
보행 외 추적445프레임, STOP·메뉴 후 남은 추적·HUD 고정·오류0을 확인했습니다. 전부 임시 DB·프로필·fixture만 사용했습니다.
`--continuity-only`도 통과했습니다. 활성 펫·에셋·배경 교체와 창 확대 시 위치를 유지하고,
최소·세로·큰 창으로 변경해도 화면 안에 남으며 재배치 후 공격을 재개했습니다.
오래된 `resize.electron.cjs`는 과거128px 기대값이 남아 있어 이번 근거로 사용하지 않았으며,
현재96px 계약을 검사하는 `window-layout.browser.cjs`를 사용했습니다.

Independent Review: 펫룸 Client·주입 경계는 신규 문제 없음, 직접 계약13개 통과였습니다.
런타임 최종 리뷰에서 Cargo 취소 후 build.rs 자식이 계속 실행되는 P2를 실제 임시 Cargo
프로젝트로 재현했습니다. `83189ca`에서 자기 빌드 그룹을 취소 콜백 안에서 즉시
종료하도록 보완했습니다. SIGTERM 무시 후손·출력 제한·취소 직후 호스트 process.exit까지
테스트했습니다. 추가로 macOS의 종료 직후 일시 EPERM을 보완해 Cargo16/16,
런타임86/86을 통과했습니다. 최종 독립 재리뷰에서도 실제 Cargo `build.rs`를 실행해
정상 취소 오류·응답 전 자식 종료·2.3초 뒤 후속 파일 미생성을 확인했습니다.
리뷰어가 별도로 Cargo16/16과 diff 검사를 통과했으며 두 지적 모두 해결됐습니다.
남은 구체적인 신규 버그 지적은 없습니다.

잔여 한계는 main의 오버레이 성장 저장소 분리·열린 펫룸의 전체 명부 자동 push 부재·
배포 경로 및 Windows 실제 종료 검증 미실시입니다. Windows의 taskkill 경로는 구현되어
있지만 실제 OS 회귀를 통과했다고 주장하지 않습니다. 원격 활성 펫 브랜치와 가상 병합의4개 파일 충돌은 MR에 명시하며,
다른 담당자 코드나 실제 원격 브랜치를 병합·수정·push하지 않았습니다.

## Evolve

`none` — 공통 하네스의 규칙이나 자동화 동작을 바꾸지 않습니다.

## 활성 펫 읽기 계약 추가 — 2026-09-30

Track은 `standard`이며 기존 승인된 `battle-client-isolation` 명세와 요청자의
“client, adaptor 에 추가하면 되잖아”를 이번 조회 확장의 Seed로 사용했습니다.
별도 `battle-active-pet-reader` Draft의 JSON 원복·미연결 처리안은 승인·구현된 것으로 취급하지 않습니다.

- Interview/Seed: 활성 개체의 저장 ID·레벨·누적 XP·레벨 내 XP·진화 단계를 Client·Adapter가 전달하고, 전투는 읽기 기능만 요구합니다.
- Explorer: 공통 `OwnedPet`에는 데이터가 모두 있으며, 기존 `RoomPetView` 투영에서 XP가 제외됩니다. 원본 조회 위임만 추가하면 현재 연결을 보존할 수 있습니다.
- Planner: 기존 PetClient의 읽기 3메서드를 `RoomPetReadClient`로 공개하고 Adapter에서 위임합니다. 전투 소비 타입은 읽기 메서드로 좁히며 앱 조립은 `mountBattle(roomPets, ...)` 한 곳만 바꿉니다.
- Non-goals: 펫룸 저장·공통 활성 변경·DB·성장·모션·밸런스 변경, JSON/공통 개체의 추측 대응, 미연결 상태의 임의 XP 또는 기능 제한 추가는 하지 않습니다.
- Implementer: `6dda971`에서 읽기 타입 거부·원본 메서드 부재·앱 미연결의 RED를 확인했고, `06f09d4`에서 최소 구현으로 GREEN을 확인했습니다.
- Mechanical: 포맷·타입·492/492 패키지 테스트 통과, 집중 29/29, 실제 SQLite·Rust 호스트 12/12, 기존 실제 Rust 연동 3/3 통과입니다.
- Semantic: 같은 종의 다른 개체 선택·최신 XP·성장 단계·조회 실패·필터·null/빈 목록을 구분합니다. 실제 HP 감소·중복 알림 방지·재시작 유지·저장 데이터 비변경을 검증했습니다.
- UI: 임시 DB·프로필의 실제 Electron에 같은 Adapter를 연결해 선택·실제 에셋·공격·STOP/START·검·X·재진입35%를 통과했습니다. 실제 사용자 저장소는 쓰지 않았습니다.
- Coverage: `packages/pet-room/dist/client.js` 라인·분기·함수 100%입니다. 테스트는 공개 패키지를 사용하므로 dist 기준으로 계측했습니다.
- Independent Review: 신규 지적 없음입니다. 별도 리뷰어가 집중 24/24, 실제 SQLite→Adapter→Rust 신규 회귀 1건, 타입·diff 검사를 통과했습니다. 읽기 계약은 저장 메서드를 소비 타입에서 제외하는 것이며 객체 동결이나 기존 펫룸 선택 기능 제거를 뜻하지 않습니다.
- Evolve: `none`입니다. 새로운 테이블 계약이나 공통 하네스 규칙을 만들지 않았습니다.

이번 범위의 전투 외 생산 코드 변경은 펫룸 Client·Adapter의 조회 확장과 앱 주입 한 줄입니다.
이전 커밋의 `room.ts`·`collection.ts` 연결은 여전히 남아 있으며, 외부 변경 전체를 제거했다고 보고하지 않습니다.
조회 계약 확장과 기존 JSON 선택/공통 개체 연결 문제는 구분합니다.

## 펫룸 저장 연결 제거 — 2026-10-01

- Track / Interview·Seed: `work standard`. 요청자의 “내쪽에서 추가한건지? 그럼 삭제해”가 승인된 기존 명세의 펫룸 저장 연결 부분을 대체합니다. 별도 reader Draft의 전체 제안은 채택하지 않습니다.
- 성공 기준: `room.ts`·`collection.ts`는 `origin/main`과 동일, 앱의 펫룸 생성도 원래대로, 조회 Adapter는 저장 API 없이 전투에만 주입합니다.
- Non-goals: DB·공통 Client·성장 소유 코드·사용자 JSON/SQLite·전투 UI/Rust 변경, JSON ID 추측 대응·임의 XP·대체 동기화 추가, 원격 push는 하지 않습니다.
- Explorer: 저장 연결은 전투 브랜치 추가분이며 원격 main의 원래 펫룸은 JSON 명부를 사용합니다. JSON 선택 ID와 공통 UUID·XP 사이에 검증된 연결이 없습니다.
- Planner: 연결 제거를 먼저 테스트하고 두 호스트 파일 원복·앱 주입 제거·Adapter 쓰기 API 삭제 후 임시 SQLite와 실제 Rust/Electron으로 확인합니다.
- Implementer: `90837cb`에서 집중 테스트 18건 중 의도된 3실패(앱 주입 2·저장 API 1), 별도 생성자 타입 RED를 확인했습니다. `28cc1a0`에서 동일 집중 18/18 및 전체 타입 검사 GREEN입니다.
- Semantic: 실제 임시 SQLite·Rust 호스트 9/9, 실제 Rust 연동 3/3입니다. 공통 선택/XP 전달·동일 종 개체 구분·재시작·저장 무변경을 확인했습니다. 반대로 기존 펫룸 JSON 선택이 공통 활성·명부·XP·실행 중 전투에 전달되지 않고, 공통 빈 명부가 시드로 채워지지 않음도 확인했습니다.
- Coverage: 읽기 Adapter `dist/client.js` 라인·분기·함수 100%입니다.
- Mechanical: 공식 `bash .harness/scripts/verify-electron.sh`의 포맷·타입·패키지 490/490 통과, `git diff --check` 통과입니다. `room.ts`·`collection.ts`의 원격 main 대비 diff는 비어 있고, 공통 DB·Client·성장 소유 코드에 변화가 없습니다.
- UI: 임시 프로필·SQLite의 실제 Electron에서 읽기 Adapter→호스트 IPC→Rust 공격·STOP/START·수동 공격·검, 공통 활성 선택·종별 에셋·성장 쓰기 거절, X 닫기·재진입 STOP/35% 보존을 통과했습니다. 독립 데모도 통과했습니다. 공통 소유자 API로 선택한 것이며 JSON 펫룸 선택 연동 검증으로 표시하지 않습니다.
- Independent Review: 신규 지적 없음입니다. 별도 리뷰어가 `ff16ece` 대비 이번 변경과 main 대비 순차이를 검토하고 집중 18/18 및 `git diff --check`를 통과했습니다. 두 펫룸 호스트 파일·기존 생성자 원복, 전투 전용 조회 주입, 쓰기 API 제거, DB·성장·UI/Rust 무변경을 확인했습니다. JSON 선택 비전파는 의도된 제한으로 최종 보고에 명시합니다.
- Evolve: `none`. 공통 하네스 동작·규칙은 변경하지 않습니다.

**결과 한계:** 펫룸 JSON 선택의 자동 전투 전달은 저장 연결과 함께 제거됐습니다.
전투는 공통 Client의 활성 펫·XP만 읽습니다. 두 경로가 자동 동기화된다고 보고하지 않습니다.

## 펫룸 선택 읽기 연결 복구 — 2026-10-01

- Track / Interview·Seed: `work standard`. “펫룸에서 오버레이 클릭하면 펫이 안나옴, 필요하면 만든 port/adapter에 추가” 및 “전투창. 메인 오버레이는 ㄴㄴ”를 범위로 삼았습니다. [선택 읽기 명세](../../../.harness/specs/features/2026-09-30-battle-integration.md)를 이 제한 범위로 갱신했습니다.
- Explorer: 기존 read wrapper는 공통 활성값만 위임하므로 룸 JSON의 선택은 도달하지 않았습니다. 룸 JSON에는 개체 ID·레벨·에셋 정보는 있지만 실제 XP가 없으며 같은 종 매칭은 개체를 혼동합니다.
- Planner: 소유자 공개 `RoomSelectionClient` → 전투 `RoomBattlePetAdapter` → Rust 동기화. 룸은 선택·명부의 원천, 공통 `PetClient`는 정확히 같은 개체의 저장 성장 원천입니다. 룸 저장·DB·메인 오버레이는 변경하지 않습니다.
- Implementer: RED `f501d79` — TS 신규 API/룸 선택 실패, Rust nullable 입력 7건 거절, 실제 호스트 신규 3건 및 Electron 조회 Adapter 부재를 확인했습니다. GREEN `012908f`는 조회 콜백 주입·nullable 내부 XP·미연결 표시를 추가하며 기존 owner-only 소비 계약을 유지합니다.
- Mechanical: 공식 게이트의 포맷·타입·패키지 **501/501**, 집중 **31/31**, Rust **53/53**, Rust fmt·Clippy 통과입니다.
- Semantic: 실제 임시 JSON·SQLite·Rust 호스트 **16/16**(룸 파일 재사용으로 4건 중복), 기존 Rust 연동 **3/3**. 열린 전투/재연결 선택 변경, 빈 공통 명부, 같은 종 다른 개체·정확한 XP, 오류 후 회복, 저장 무변경을 검증했습니다. XP 미연결↔연결 전환은 누락된 성장 이벤트를 임의 재생하지 않으며 다음 실제 증가분부터 반영합니다.
- Coverage: 전투 room adapter·owned gateway·integration 및 공개 room client 계층 라인 **100%**, 분기 **98.61%**, 함수 **100%**. Rust 정량 커버리지는 llvm-cov/llvm-tools 미설치로 측정하지 않았으며 설치하지 않았습니다.
- UI: 실제 Electron `attack.electron.cjs` 종료 0·PASS 체크포인트 7개. 임시 JSON의 `petApi.setActivePet`으로 두더지→별빛마법사를 선택해 열린 전투창의 실제 에셋과 미연결 안내를 확인했습니다. 정확히 연결된 개체 성장·공격·STOP/START·검·X·재열기·35% 보존·기본 창 크기도 통과했습니다. 사용자 DB·메인 React 오버레이는 실행하거나 수정하지 않았습니다. 화면 아티팩트는 `/tmp/petto-battle-ui-artifacts-6FUwE3/`이며 임시 파일입니다.
- Independent Review: 별도 리뷰어의 집중 31/31·diff 검사 통과, 신규 코드 버그 지적 없음입니다. 룸의 저장 경로 유지, 정확한 개체별 성장, 연결 상태 변경 시 stale 정복 정리, owner-only 호환 경로를 확인했습니다. 기존 문서의 “JSON 선택 미전달” 설명 3곳은 현재 앱 경로와 이전 호출 경로로 구분해 정정했습니다.
- Evolve: `none`. 공통 자동화 규칙·DB 계약·다른 기능 저장소는 변경하지 않습니다.

미연결 JSON 펫은 `성장 정보 연결 대기 · 모션 미리보기`를 안내하고 stage1/HP100%로 표시합니다.
외형·공격·STOP/START·프리뷰는 사용할 수 있지만, 레벨로 XP를 만들거나 다른 개체의 성장값을 빌리지 않습니다.
이번 추가 생산 코드의 전투 외 변경은 `packages/pet-room/src/client.ts`의 읽기 공개 API와
`apps/desktop/src/main/main.ts`의 전투 전용 콜백 주입뿐입니다. 기존 오버레이 이미지 경합 수정은 추가 수정하지 않았습니다.
