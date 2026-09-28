# 토큰·성장·전투 연결

## 구현 경로

`공통 집계 → TokenGrowthLink → TokenClient / PetClient → OwnedPetBattleGateway → Rust 전투 → 화면`

- `apps/desktop/src/main/token-linked-meta.ts`: 앱 시작·1분 집계·수동 재스캔을 같은 저장 경로로 연결. 기존 meta 패키지는 수정하지 않는다.
- `apps/desktop/src/main/token-growth.ts`: 공통 클라이언트로 토큰과 성장 저장. XP 공식은 성장 패키지의 `@pet/main-overlay/growth`를 사용한다.
- `apps/desktop/src/main/battle.ts`: 실제 전투 창에만 IPC 허용. 전투 패키지의 Rust 엔진을 조립한다.
- `packages/pet-battle/src/integration/owned-pet-gateway.ts`: 저장된 활성 펫·전체 명부·누적 XP를 매 조회 때 동기화. 외부에는 전투 UI 명령만 허용한다.
- Rust가 등급별 XP 구간, HP, 스테이지, 적 색상, 정복 이벤트를 계산한다.

## 유지한 경계

- 토큰 통계의 `reward`에는 캐시 생성 토큰이 포함되므로 XP 환산에 그대로 쓰지 않는다. 집계에서 입력+출력의 증가분을 별도로 전달한다.
- 기존 TokenClient 기록은 소급 XP로 지급하지 않는다.
- 기존 성장·펫 테이블은 보존하며 `growth-token-credit` migration으로 잔여 토큰 테이블만 추가한다.
- 현재 스테이지는 저장된 누적 XP에서 재계산한다. 정복 연출·START/STOP 상태는 실행 중 상태이며 재시작 시 자동 전투로 복원한다.
- 독립 `npm run demo --workspace @pet/battle`는 표현 확인용 데모다. 공통 DB 연동은 전체 앱 `npm start`에서 사용한다.

## 다른 기능 담당자에게 필요한 연결

- 현재 main의 수집기는 `FixtureCollector`다. 실제 CLI 수집기 연결은 이 변경에 포함하지 않는다.
- 펫 획득·선택 기능은 공통 `PetClient.createOwnedPets` / `setActivePet`으로 저장해야 한다. 전투는 이 공통 데이터만 읽는다.
- 기존 room JSON 명부와 오버레이의 종별 데모 성장 저장은 별도 경로다. 그 데이터를 임의로 공통 소유 펫으로 복제하거나 다른 기능의 UI를 변경하지 않았다.
- 공통 활성 펫이 비어 있으면 전투창에 선택 안내가 나온다. 기존 room의 데모 펫 선택만으로는 공통 활성 펫이 지정되지 않는다.

## 검증

- `npm run build`
- `bash .harness/scripts/verify-electron.sh`
- `npm run test:storage --workspace @pet/desktop`
- `npm run test:rust --workspace @pet/battle`

임시 SQLite와 실제 Rust 프로세스를 사용해 토큰 지급 → 레벨 상승 → 정복 → 클릭 → 적·배경 전환, 중복 방지, 펫 전환, 재연결 복원을 검증한다. 사용자 DB는 테스트하지 않는다.

## 작업 결과 — 2026-09-28

- Track: `standard`. 목표는 공통 토큰·펫 저장과 전투의 실제 연결 및 성장 구간별 적·배경 전환이다.
- Seed: 승인된 `.harness/specs/features/2026-09-21-token-usage.md`, 사용자가 제공한 `battle-system.md`·`growth-system.md`, 공통 앱·성장 연결을 허용한 후속 요청.
- 제외: 실제 CLI 수집기 구현, 펫룸·뽑기 명부 이관, 합성·도감, 그래픽 변경, push.
- Explorer: TokenClient의 `reward`와 성장용 토큰 범위 차이, 앱의 데모 전투 경로, 별도 room 명부를 확인했다.
- Planner: 성장 저장 원자화 → 공통 펫 동기화 → Rust XP 구간 계산 → 정복 화면 연결 순으로 분리했다.
- Implementer: 실패 테스트를 먼저 커밋하고 각 기능을 구현했다. 별도 성장 공식 복사 없이 공개 export로 연결했다.
- Verifier / Mechanical: 전체 빌드, 공통 포맷·타입·패키지 테스트 215개, SQLite 42개, Rust 26개 통과. Clippy `--all-targets -- -D warnings` 통과.
- Verifier / Semantic: 임시 DB·실제 엔진 통합 테스트로 XP → Lv.13 → COMMON 2스테이지 → 클릭 → 주황 적, 누적 684 XP → 4스테이지·수정 유적을 확인했다. 중복·재연결·활성 펫 전환도 통과했다.
- Reviewer: 구현 단계 이후 같은 세션에서 diff를 별도 검토했다. 정복 HP 100% 표시, 실제 정복 모션 미연결, 잘못된 IPC 요청의 무한 대기를 찾아 수정하고 재검증했다. 별도 리뷰 에이전트는 사용하지 않았다.
- 측정: `OwnedPetBattleGateway`와 `RustBattleClient`의 집중 테스트 커버리지는 라인 100%, 분기 91.49%다. 전체 앱 커버리지 수치가 아니다.
- 변경 영역: 전투 패키지, desktop 조립·preload·성장 잔여분 저장·테스트, 성장 패키지 공개 함수, 루트 빌드 설정. `pet-core`, `pet-meta`, 펫룸·뽑기 구현은 변경하지 않았다.
- 남은 사항: 위의 다른 기능 담당자 연결 조건. GUI 실행은 하지 않았으며 화면은 scene·UI 계약 테스트로 검증했다.
- Evolve: 토큰 통계 기준과 XP 환산 기준을 분리하고, 누적 XP 스냅샷으로 재시작·중복 이벤트를 처리하는 경계를 이 문서에 남겼다.
