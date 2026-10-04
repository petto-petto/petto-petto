# 미푸시 변경 범위와 BattleClient 정리

## 점검 기준

- `git fetch origin` 후 원격 전투 브랜치 `0f1584f` → 작업 시작 HEAD `cb6e200`의 미푸시 86개 커밋을 확인했다. 원격으로부터 뒤처진 커밋은 0개다.
- 이번 점검은 fetch만 수행했다. 최신 main을 pull·merge·rebase하거나 원격으로 push하지 않았다.
- `origin/main` 끝점과 직접 비교하면 main에만 있는 새 코드가 삭제된 것처럼 보인다. 미푸시 범위는 전투 브랜치 upstream, PR 누적 변경은 `origin/main...HEAD`로 구분한다.

## 전투 밖 미푸시 변경: 6파일

| 파일                                               | 변경 내용                                                        | 판정                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/desktop/src/main/battle.ts`                  | 앱의 전투 구현 삭제 → `@pet/battle/node`로 이동                  | 이미 패키지로 이동 완료                                        |
| `apps/desktop/src/main/main.ts`                    | 패키지 진입점 호출, 공통 PetClient·성장 곡선·에셋·신뢰할 창 주입 | 앱에서 한 번 조립하는 최소 연결 유지                           |
| `apps/desktop/src/main/windows.ts`                 | 기본 640×420·최소 360×180·크기 조절, 패키지 전용 preload 사용    | 사용자 허용 크기 유지. 실제 창 수명·preload 지정은 호스트 책임 |
| `apps/desktop/src/preload/preload.cjs`             | 공통 창에서 전투 bridge 4줄 삭제                                 | 전투 전용 `ui/host-preload.cjs`로 이미 이동 완료               |
| `apps/desktop/test/battle-runtime.test.cjs`        | 패키지 Node 진입점과 새 옵션으로 통합 검증                       | 앱 소유 SQLite·펫룸과의 연결 테스트 유지                       |
| `apps/desktop/test/room-battle-selection.test.cjs` | 전투 preload 검사 경로만 패키지 경로로 변경                      | 펫룸 선택 회귀 검증 유지                                       |

위 변경은 `f7eeb82`·`7a4a7b9` 두 커밋에만 있다. 테스트를 옮기더라도 실제 앱 소유 구현과 연결되는 호스트 검증은 필요하므로 이번에는 위치를 바꾸지 않았다.

## 펫룸·오버레이·DB의 구분

| 대상                                | 미푸시 변경 | 처리                                                                                  |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| 펫룸 `room.ts`                      | 없음        | 공통 선택 연결 `933b62b`는 이미 원격 전투 브랜치에 있음. 전투로 옮기지 않음           |
| 오버레이 `PetSprite.jsx`와 테스트   | 없음        | 늦은 이미지 응답 버그 수정 `2ab6f9c`·`4aa7c17`은 이미 원격에 있음. 오버레이 자체 책임 |
| 공통 Client·Repository·DB migration | 없음        | PR 누적 순변경도 없음. 이전 전투 외 DB 수정은 `139383e`에서 철회됨                    |

펫룸의 선택 저장과 오버레이의 이미지 로딩을 전투가 대신하면 다른 기능이 전투에 의존한다. `.harness/rules/feature-contracts.md`에 따라 소유자의 기존 `PetClient`를 주입받으며, 전투용 펫 DB나 복제 PetClient는 만들지 않는다.

## 이번 리팩토링

```text
전투 화면 → BattleClient → 전투 IPC/런타임 → PetBattleIntegration → Rust
                                              ↑
                               앱이 주입한 공통 PetClient (읽기만)
```

- `@pet/battle/client`: 타입만 있는 공개 `BattleClient`·`BattleClientCommand`.
- 내부 엔진 명령과 화면 명령을 구분한다. 기존 화면 명령 14개만 공개하며 펫 생성·선택 저장·XP 지급·명부 동기화는 제외한다.
- IPC와 직접 integration이 하나의 정책을 사용한다. 금지 명령은 Rust 생성 전 거절하며 기존 비동기 오류 계약을 유지한다.
- renderer와 `BattleRuntime`가 실제로 새 계약을 소비한다. 단순 이름 alias를 추가한 것이 아니다.
- 공통 PetClient·DB·앱·펫룸·오버레이·창 설정은 이번에 변경하지 않았다. 기존 저수준 API와 앱 연결은 유지한다.

## 작업·검증 기록

- Track: `work standard`. Seed: 기존 `token-growth-integration.md`, 소유자 `docs/pet-client-handoff.md`, 미푸시 변경 감사 및 Client 경계 정리 요청. 새 전투 규칙이나 저장 형식은 추가하지 않는다.
- Explorer: 별도 에이전트 두 명이 미푸시 이력과 소유권 경계를 읽기 전용 점검했다. 다른 feature 구현 변경은 없고, renderer가 엔진 전체 명령 타입을 사용한다는 개선 지점을 확인했다.
- Planner: 전투 내부 Client 계약 → 공통 허용 정책 → renderer/IPC 적용. 성공 기준은 소유자 쓰기 명령 차단, 기존 선택·성장·에셋·창 동작 보존, 이번 전투 밖 변경 0건이다.
- Implementer: `15daa1e`에서 10건 실패와 없는 공개 타입을 재현, `4a4d170`에서 44/44와 타입 검사 통과. 실제 호스트 테스트가 비동기 오류 호환 문제를 찾아 `b7e4ed9`의 9건 RED → `d1213f0`의 44/44 GREEN으로 수정했다.
- Verifier / Mechanical: 공식 `bash .harness/scripts/verify-electron.sh`의 포맷·타입·전체 테스트 **392/392 PASS**. 집중 테스트 **54/54 PASS**, 변경 계층 line 100%·branch 97.37%·function 92.31%. `git diff --check cb6e200` 통과, 전투 밖 이번 변경 0파일.
- Verifier / Semantic: 기존 앱의 실제 임시 SQLite 테스트 **5/5 PASS**, 실제 Rust 연동 **3/3 PASS**. 격리된 Electron의 공통 활성 펫·진화 에셋·XP 쓰기 차단·공격·STOP/START·수동 공격·X 닫기 및 독립 demo 모두 PASS. 공개 `@pet/battle/client`의 런타임 export는 빈 목록으로 타입 전용임을 확인했다.
- Reviewer: 별도 에이전트가 diff·문서·소유권·오류 호환성을 검토하고 관련 테스트 **53/53**을 독립 재실행했다. 수정할 결함 없음.
- Evolve: none. 공통 하네스나 소유자 계약을 바꾸지 않는다.

기존 미추적 `2026-09-29-battle-hp-chip-effect.md`는 수정·커밋하지 않는다. 테스트는 임시 DB·임시 Electron 프로필만 사용한다.
