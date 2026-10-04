# Electron 내부 전투 엔진 전환

상태: Approved, 2026-10-04. 요청자의 “가능하면 그렇게 변경해야함”을 구현 승인으로 삼습니다. 기존 전투 기능을 유지하며 Rust 설치 없이 실제 전투를 실행하는 것이 성공 기준입니다. `work standard`이며 이 문서가 Seed입니다.

## 검토와 결정

Rust 엔진은 순수 XP 진행 계산·정복 전이·미리보기 상태를 처리합니다. TypeScript의 기존 BattleGateway를 구현하면 Electron 메인 프로세스 내부에서 같은 일을 수행할 수 있습니다. 기존 UI, 공개 Client, 소유자 저장소 계약은 유지합니다. 브라우저 데모의 가짜 명부를 실제 앱에 연결하지 않습니다.

## 구현 계획

1. Rust growth/protocol/overlay/motion-preview 계약을 TypeScript 도메인 엔진으로 이식합니다. 기존 sampleCombatMotion을 재사용합니다.
2. createBattleRuntime/mountBattle 기본 경로가 내부 엔진을 조립하게 합니다. 명시적 binaryPath는 이전 소비자 호환을 위해 남기되 기본 앱은 Cargo 준비와 자식 프로세스를 사용하지 않습니다.
3. 단독 Electron 데모도 내부 엔진을 사용하며 demo 스크립트의 Rust 빌드를 제거합니다. Rust 원본·도구는 비교/기존 명시 소비자용으로 보존합니다.
4. 저장 XP 복원, 중복 알림, 21단계, 정복 시간 경계, 미연결 펫, 읽기 전용 경계, STOP/투명도 및 IPC 수명을 검증합니다. Cargo가 없는 실제 Electron에서 초기 조회·창 표시를 확인합니다.

## 수용 기준

- 기본 실제 앱과 Electron 데모는 Cargo/Rust 실행 파일 없이 실행됩니다.
- 저장 XP가 같은 입력이면 기존 progression과 같은 stage/intervalXp/HP를 반환합니다. 초깃값 복원이나 연결 상태 전환이 과거 정복 이벤트를 재생하지 않습니다.
- 1480ms 처치→720ms 등장, 클릭 생략, 추가 XP의 목적지 병합, 모든 등급의 Lv.50 21단계 규칙을 유지합니다.
- 펫 선택·진화·STOP·투명도·미리보기·카메라·실제 에셋과 Client 권한 검사는 기존 흐름을 유지합니다.
- 룸/공통 DB에 쓰지 않습니다. 새 동작 소스·검증·문서는 pet-battle 안에 둡니다.
- JavaScript에서 정확히 표현할 수 없는 정수 입력은 거부합니다. 기존 공개 TypeScript 계약은 number이므로 u64 전체 범위 지원을 주장하지 않습니다.

공식 게이트는 기존 verify-electron.sh이며, 기존 Windows/포맷 실패와 신규 실패를 구분해 기록합니다. 실제 Rust 실행 비교는 Cargo 미설치로 불가하므로 Rust 계약의 수치·이벤트 시나리오를 이식한 테스트를 사용합니다. 독립 비교 실행을 통과했다고 주장하지 않습니다.

## 구현·검증 기록

- Explorer: Rust protocol/growth/overlay/motion-preview와 공개 BattleGateway를 대조했습니다. 데이터 조회·화면을 유지한 채 계산 구현만 교체할 수 있습니다.
- Planner/Implementer: 신규 규칙 테스트의 모듈 부재 RED를 확인한 뒤 `src/domain/{engine,growth}.ts`를 추가했습니다. `node.ts` 기본 경로는 이 엔진을 조립하고 명시적 `binaryPath`만 이전 sidecar를 사용합니다. 단독 demo의 Rust 빌드·spawn도 제거했습니다. 실제 앱 조립·외부 Client·DB는 변경하지 않았습니다.
- 새 엔진/기본 런타임 테스트 12개 통과. 3등급×21단계의 시작/종료 직전 경계 126조건, 레벨 상한 이후/짧은 성장 곡선, 중복 XP·초기 복원·연결 상태 전환·정복/클릭·동일 종 개체 구분·모든 미리보기·권한/재진입을 포함합니다.
- `node packages/pet-battle/test/run-electron-smoke.cjs`: PASS, exit 0. 자식 Electron의 PATH를 비워 Cargo를 사용할 수 없도록 하고, 임시 JSON/SQLite/프로필로 실제 호스트 IPC와 Electron 데모를 검사했습니다. 룸 선택→미연결 실제 이미지→연결된 개체/진화 에셋, 공격·STOP/START·수동 타격·성장 쓰기 거부·닫기/재열기 STOP·35% 유지의 7개 체크포인트를 통과했습니다.
- 첫 Electron 검증은 모든 기능 체크 후 Windows 캐시 삭제 EPERM으로 종료됐습니다. 부모 프로세스가 Electron 종료 후 임시 프로필을 삭제하도록 runner를 추가했습니다. 후속 1회는 단독 데모 수동 타격의 화면 관찰 타임아웃이 있었고, 동일 코드 재실행에서 전체 통과했습니다. 타이밍 관련 불안정 가능성은 남아 있습니다.
- `npm run typecheck`: 통과. `npm test`: 507개 중 492 통과·15 실패. 이전 실행의 동일한 15개 Windows sidecar/Cargo fixture·창 경로 테스트가 실패했습니다. 기본 TypeScript 엔진의 새 테스트는 모두 통과했습니다. 전체 게이트 통과로 표시하지 않습니다.
- 최종 집중 명령은 `node --test packages/pet-battle/test/electron-engine.test.ts packages/pet-battle/test/electron-runtime.test.ts packages/pet-battle/test/desktop-isolation.test.ts packages/pet-battle/test/runtime-lifecycle.test.ts packages/pet-battle/test/room-selection.test.ts`이며 28/28 통과했습니다. 공식 `bash .harness/scripts/verify-electron.sh`는 기존 파일을 포함한 포맷 경고 304개에서 중단됐고, 별도 타입 검사·수정 파일 포맷·diff 검사는 통과했습니다. 전체 공식 게이트를 통과했다고 표시하지 않습니다.
- Reviewer: Rust의 상태 전이·설정 초기화·연결 상태 전환·단계 상한 계산과 비교하는 자체 리뷰를 수행했습니다. 전체 Rust 테스트를 실시간 대조 실행하거나 별도 독립 리뷰어가 검증한 결과는 아닙니다.
- Evolve: none. 하네스 문서는 바꾸지 않았으며 기존 Rust 관련 하네스 설계보다 이번 사용자 승인에 따른 패키지 내 실행 기준이 우선합니다. 과거 검증 문서는 역사 기록으로 남깁니다.

호환 한계: JavaScript 안전 정수 범위의 저장 XP를 받으며 더 큰 정수·음수·비정상 곡선은 오류로 거부합니다. Rust 원본은 선택적 비교/에셋 도구 및 명시적 sidecar 소비자를 위해 남아 있고, 일반 앱·전투창·Electron 데모는 그 파일을 실행하지 않습니다.

사용자 앱도 새 빌드로 `npm start` 재실행했고 `[UI] panel 준비 완료` 및 실제 오버레이 창을 확인했습니다. 임시 프로필 검증과 사용자 앱 실행은 구분하며, 앱의 XP·선택 저장 값을 시험용으로 변경하지 않았습니다.
