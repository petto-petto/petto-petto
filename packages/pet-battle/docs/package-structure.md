# 전투 패키지 구조

## 기준과 범위

하네스의 feature 내부 책임 분리와 Electron 규칙을 따른다. 전투 실행을 TypeScript로 통일하고,
동일 책임의 폴더를 합쳐 실행 경로를 명확히 한다. 전투 규칙·화면·펫룸 및 성장 저장 기능은 변경하지 않는다.

## 변경

| 기존                         | 현재                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| rust/                        | 제거. 전투 규칙은 src/domain에서 실행                                  |
| src/runtime/                 | 제거. Cargo 빌드·외부 바이너리 준비 불필요                             |
| src/ipc/client.ts·sidecar.ts | 제거. 외부 프로세스 통신 불필요                                        |
| src/ipc/host.ts              | src/app/ipc.ts                                                         |
| src/integration/             | src/app/의 읽기·이미지 연동                                            |
| client-rust.integration.cjs  | client-engine.integration.cjs. 같은 성장 시나리오를 내부 엔진으로 검증 |
| Cargo·sidecar 전용 테스트    | 제거. 소유자 오류·종료 후 요청 거부는 Electron 런타임 테스트에서 유지  |

공개 BattleClient·createBattleRuntime·mountBattle과 host preload는 유지한다. 폐기한 실행 방식의
binaryPath·preparationTimeoutMs 옵션과 RustBattleClient·spawnBattleSidecar export는 제거한다.
저장소의 실제 앱 호출자는 이 옵션을 사용하지 않는다. 외부 바이너리를 직접 실행하던 사용자는
기본 내부 엔진 호출로 전환해야 한다.

assets는 런타임에 필요한 적·배경과 생성 원본을, docs는 현재 기능 안내와 과거 작업 기록을 보관한다.
전투 파일을 다른 feature 폴더로 옮기지 않는다. 공통 변경은 사용하지 않는 Rust target 포맷 제외
항목 제거와 전투 feature 명세의 실행 기준 갱신뿐이다.

## 작업·검증

- Track: work standard. 사용자 요청의 성공 기준은 프로젝트 책임 분리에 맞춘 구조와 기존 Electron 전투 기능 유지다.
- Explorer: 하네스의 feature 구조 제안, Electron·계약 규칙, room·meta·gacha 패키지와 전투 호출자를 대조했다.
- Planner/Implementer: Rust 실행 경로 제거 → app 계층 통합 → 통합 테스트 이전 → 공개 안내와 구조 검증 갱신.
- RED: desktop-isolation 테스트가 남아 있는 build:rust 스크립트로 실패했다.
- 기능 검증: 저장 XP·정복·다음 적·중복 알림의 통합 시나리오는 삭제하지 않고 내부 엔진으로 이전했다.
- 최종 검증 결과는 아래에 기록한다.

- Mechanical: npm run typecheck 통과. npm test **523/523 통과**. test:integration **3/3 통과**. 실제 Electron smoke **7개 체크포인트 통과**.
- 공식 verify-electron.sh는 전투 외 파일을 포함한 포맷 경고 233개에서 중단됐다. 전체 게이트 통과로 표시하지 않는다.
- Semantic: 실제 임시 JSON/SQLite·Electron에서 선택·이미지·공격·STOP/START·성장 쓰기 거부·재진입 설정 유지 확인. 저장 XP 진행과 정복 시나리오는 내부 엔진으로 통과했다.
- Reviewer: 자체 diff 검토에서 domain·화면 로직과 앱 조립 변경이 없고, 제거된 경로의 소스 import가 남지 않음을 확인했다. 별도 독립 리뷰는 수행하지 않았다.
- Evolve: 공통 하네스 동작 변경 없음. feature 명세의 실행 기준만 현재 구조에 맞췄다.
- 빌드 산출물 dist의 재귀 삭제는 자동 승인 검토가 차단했다. TypeScript 강제 재빌드로 확인했으며, ignored dist에 과거 산출물이 남을 수 있다. 현재 소스·공개 진입점에서는 사용하지 않는다.
