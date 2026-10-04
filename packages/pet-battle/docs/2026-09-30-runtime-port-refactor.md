# 전투 런타임 Port / Adapter 분리

## 범위와 성공 기준

- Track: `work standard`. Seed: `docs/token-growth-integration.md`, 공통 `docs/pet-client-handoff.md`, 외부 변경 목록을 전투 패키지로 정리하라는 사용자 요청.
- 앱에 있는 전투 전용 런타임·에셋 매핑·IPC·preload·창 옵션을 전투 패키지로 이동한다.
- 기존 활성 펫 선택, 실제 에셋, Rust 규칙, 모션, 창 보안과 닫기 동작을 유지한다.
- 비목표: 펫룸/오버레이 구현 이동, 공통 PetClient·DB·성장 규칙 변경, 토큰을 XP로 재환산, UI 디자인 변경.

## Explorer / Planner

| 책임                                            | 유지 / 이동 위치                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| 펫 데이터 조회                                  | 기존 `@pet/client`의 `PetClient`를 주입. 별도 복제 인터페이스 없음 |
| 전투 명령 Port                                  | 기존 `BattleGateway` 유지                                          |
| 공통 펫 → 전투 동기화                           | 기존 `PetBattleIntegration` 유지                                   |
| 펫 이미지 해석                                  | 전투 `BattleSpritePort` + 파일 에셋 Adapter                        |
| 런타임 생성·해제 / IPC 등록                     | 전투 Node 진입점. 지연 생성, 송신자 검증, 종료 후 재생성 금지      |
| sandbox 전투 bridge                             | 전투 `ui/host-preload.cjs`. 데모용 sidecar preload와 분리          |
| 창 기본·최소 크기                               | 전투 JSON 설정을 앱과 데모가 공유                                  |
| 실제 창·공통 폰트·신뢰할 송신자                 | 앱이 소유. 전투 창에 대한 최소 연결만 유지                         |
| 펫룸 선택 저장 / 오버레이 이미지 경쟁 조건 수정 | 각 기능의 기존 구현 유지                                           |
| 루트 빌드·TS 참조·포맷 제외                     | 저장소 조립 설정이므로 유지                                        |

계획: Port/Adapter 및 host 경계 RED → 패키지로 구현 이동 → focused GREEN → Mechanical → 실제 SQLite/Rust 및 sandbox Electron Semantic → Independent Review.

## Implementer

- RED: `8625eca`에서 host 경계·창 설정 7개 중 6개가 기존 구조로 실패함을 확인했다. `e3cb5bf`에서 새 Port/Adapter 3개 부재에 대한 타입 실패를 확인했다.
- `apps/desktop/src/main/battle.ts`의 전투 구현을 제거하고 `@pet/battle/node`로 이전했다. 기존 저수준 API는 유지한다.
- `BattleGateway`를 `SpriteBattleGateway`로 보강한다. 파일 어댑터는 원본 파일을 읽고 종·진화·메타를 검증하며 캐시 반환값을 분리한다.
- IPC는 권한 검사 후 런타임을 한 번만 만든다. 등록 해제는 멱등이며, 종료된 연결은 재시작하지 않는다. 종료 시 진행 중 요청도 즉시 거절하고 child process를 정리한다.
- `apps/desktop` 변경은 main의 주입, 전투창 preload·공유 옵션, 공통 preload의 전투 bridge 제거, 기존 전투 통합 테스트의 새 진입점 적용뿐이다.
- 펫룸·오버레이·PetClient 구현·DB·루트 빌드 설정은 변경하지 않았다. 사용자 미추적 초안도 제외했다.

## Verifier

| 검증                                                                               | 결과                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash .harness/scripts/verify-electron.sh`                                         | 포맷·타입·전체 패키지 테스트 **369/369 PASS**                                                                                                   |
| Port/Adapter·Node·host 경계·창 설정                                                | **44/44 PASS** (전체 게이트에 포함)                                                                                                             |
| 새 runtime 계층 집중 커버리지                                                      | 라인 **94.39%**, 분기 **97.92%**, 함수 **94.12%**. 전체 앱 커버리지 아님                                                                        |
| `npm run test:rust --workspace @pet/battle`                                        | **43/43 PASS**                                                                                                                                  |
| `npm run test:integration --workspace @pet/battle`                                 | 실제 Rust HP·정복·동기화 **3/3 PASS**                                                                                                           |
| `ELECTRON_RUN_AS_NODE=1 electron --test apps/desktop/test/battle-runtime.test.cjs` | 실제 SQLite·펫룸 선택·에셋·권한 **5/5 PASS**                                                                                                    |
| `electron packages/pet-battle/test/attack.electron.cjs`                            | 실제 overlay 진입 → sandbox 전투 → 공통 활성 펫/진화 이미지 변경 → 성장명령 차단 → 공격·STOP/START·수동공격 → X 닫기 **PASS**. 독립 데모도 PASS |
| `npm run test:storage --workspace @pet/desktop`                                    | **42/43 PASS**, 기존 토큰 테스트 1건 실패(아래)                                                                                                 |

테스트는 임시 DB·임시 Electron 프로필만 사용했다. 실제 앱의 창 factory와 공통 SQLite 구현을 사용하되 사용자 DB·실제 토큰 수집을 실행하지 않았다. 성장 명령 차단 시 Electron의 예상 오류 로그가 나오며 명령 거부와 XP 보존을 확인했다.

### 남은 제한

- 기존 `apps/desktop/test/token-client.test.cjs:234`의 migration scope 기대값에서 `meta`가 빠져 전체 storage 테스트 1건이 실패한다. 해당 파일과 migration은 기준 커밋 `26d5dbb` 대비 변경이 없다. 다른 feature 범위라 수정하지 않는다.
- 오버레이 성장 저장소와 공통 `owned_pets`의 통합은 여전히 성장 담당 영역이다. 이번 구조 이동으로 연결됐다고 주장하지 않는다.
- 배포 호스트는 `binaryPath`로 패키징된 Rust 경로를 제공해야 한다. 개발 실행 기본값은 기존 debug 바이너리 경로를 유지한다.

## Reviewer

독립 에이전트가 기준 `26d5dbb`부터 변경 diff와 신규 production 파일 6개를 읽기 전용으로 검토했다. **수정이 필요한 finding 없음**. PetClient 읽기 계약, sender 검증, sandbox, 경로 검증, 종료 처리, 테스트 단언 및 외부 수정 범위를 확인했다. `git diff --check 26d5dbb`도 PASS. 리뷰어는 테스트를 재실행하지 않았으며 위 Verifier의 실제 실행 결과를 입력 증거로 사용했다.

## Evolve

`none` — 공통 하네스나 다른 feature 규칙은 변경하지 않는다.
