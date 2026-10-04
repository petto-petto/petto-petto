# 전투 브랜치 rebase·교차 기능 영향 점검

## 2026-10-01 전투창 선택 읽기 연결 (최신)

후속 요청에 따라 `RoomSelectionClient/Adapter`로 룸의 현재 선택을 **전투창에만** 전달합니다.
`room.ts`·`collection.ts` 저장 복원 상태는 유지하며 메인 오버레이·공통 DB에는 쓰지 않습니다.
같은 개체 ID·종이 확인되면 저장 XP를 연결하고, 미연결 룸 펫은 외형·모션 및 성장 대기 안내를 표시합니다.
최신 영향·검증은 [MR](./2026-09-30-battle-mr.md)과 [작업 기록](./2026-09-30-client-isolation-work.md)을 따릅니다.
이번 후속 작업에서 원격 fetch·rebase·다른 feature 가상 병합·push는 하지 않았습니다.

## 2026-10-01 저장 연결 제거 후 (이전 기록)

요청자가 전투 브랜치의 펫룸 저장 연결 삭제를 명시해 `room.ts`·`collection.ts`와
`main.ts`의 펫룸 주입을 원격 main 상태로 복원했습니다. Adapter에는 원본 조회만 남겼습니다.
이제 기존 JSON 선택은 공통 활성 펫을 바꾸지 않습니다. 전투는 공통 Client의 선택·XP를 읽으며
JSON→공통 개체 연결을 대신 만들지 않았습니다. 최신 영향 표는 [MR §2](./2026-09-30-battle-mr.md)입니다.

아래 가상 병합·파일 수·펫룸 동작 결과는 각 기재 커밋 시점의 **과거 기록**입니다.
제거 후 다른 feature와의 병합을 재검사한 결과로 해석하지 않습니다.

## Client 격리 후 변경 사항 (과거 기록)

아래 1~6절은 **리팩토링 전 `30c235d`의 감사 기록**입니다. 당시 발견한 문제와 근거를
보존한 것이며, 현재 코드의 판정은 맨 위 제거 결과와 [최종 MR](./2026-09-30-battle-mr.md)을 따릅니다.

| 항목                                  | `1721ff9` 리팩토링 이후                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기존 `pet:overlay`가 오래된 펫을 반환 | 같은 `PetClientRoomAdapter`를 RoomState·RoomCollectionPort에 주입해 해결했습니다. 최신 선택·빈 명부·오류·JSON fallback을 테스트했습니다.                    |
| 앱에 있던 펫룸 뷰 변환                | 펫룸 소유 `RoomPetClient`·Adapter로 이동했습니다. 기존 공통 `PetClient`를 쓰며 새 DB 계층을 만들지 않았습니다.                                              |
| 전체 앱의 Rust 강제 빌드              | 루트 `package.json`을 main과 동일하게 복원했습니다. 전투 패키지가 첫 승인 요청에서 비동기 준비·실패 재시도를 담당합니다.                                    |
| 전투 수명                             | 앱은 종료·전투창 닫기 신호만 주입합니다. 준비 중 취소, 종료 후 늦은 생성 차단, 준비된 상태의 재진입 보존을 검증했습니다.                                    |
| 외부 파일 수                          | 17개입니다. 기존 10개보다 늘었지만 새 펫룸 Client·테스트·설계가 포함된 수치입니다. 단순 파일 수 감소가 아니라 책임 분리를 수행했습니다.                     |
| 가상 병합                             | `779ddaa`와 main.ts·windows.ts·collection.ts·pet-room/src/index.ts가 충돌합니다. room.ts의 성장 의미 조율도 여전히 필요합니다. 실제 병합은 하지 않았습니다. |
| 그대로인 한계                         | 오버레이 성장 테이블과 공통 펫 성장의 분리, 열린 펫룸의 명부 자동 갱신, 배포 바이너리 배치입니다.                                                           |

최신 검사에서도 공통 Client·DB·토큰·수집기·뽑기·합성의 소유 구현은 main과 동일합니다.
실제 Electron 검증은 임시 프로필·SQLite의 전투창과 단독 데모만 사용했으며 사용자 앱·DB는
실행하지 않았습니다. 검증 수치·독립 리뷰 보완은 [작업 기록](./2026-09-30-client-isolation-work.md)에 기록합니다.

## 최초 rebase 감사 결론 (`30c235d`)

최신 main으로 rebase를 완료했으며 전투 패키지의 기존 구현은 보존했습니다. 그러나 **전투 외 기능과 무관하거나, 다른 담당자 브랜치와 충돌하지 않는다고 판정할 수는 없습니다.** 공통 펫룸 연결의 동작 차이와 오버레이 저장소 미연동을 재현했고, 활성 펫 통합 브랜치와 실제 텍스트 충돌도 확인했습니다. 코드를 추가 수정하거나 원격에 push하지 않고 MR의 영향 표에 반영했습니다.

## 1. 기준·판정 방법

| 항목                    | 확인값                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| 점검일                  | 2026-09-30                                                              |
| 원격 기본 브랜치        | `main`입니다. `ls-remote --symref`에서 `master`는 없었습니다.           |
| 최신 기준               | `origin/main` = `5324d2d5413e422606154e01447606cb74b1f375`              |
| rebase 전               | `077fc2a6dacae60bb7f74ba108d92d8b3b2ce027`                              |
| rebase 후               | `feature/srkim0917/battle` = `30c235da16ee0be9df12d40c2d90e49e664ccd1d` |
| 복구용 로컬 브랜치      | `codex/backup-battle-before-rebase-20260930`                            |
| 조회한 원격 전투 브랜치 | `0f1584f70706481046b2524fa977fcf52dfc37b8`                              |
| diff 기준               | `origin/main...HEAD`입니다. 과거 수정 후 원복한 파일은 제외합니다.      |

판정은 세 가지로 나눴습니다. 최신 main의 구현 보존은 실제 diff로, 다른 원격 브랜치와의 충돌은 가상 병합으로, 공통 데이터의 정합성은 임시 SQLite와 실제 Rust 엔진으로 확인했습니다. 테스트 통과만으로 모든 GUI 동작이나 다른 담당자의 미푸시 코드를 보장하지 않습니다.

## 2. rebase 및 범위 보존

일반 rebase는 과거 병합 이력에서 add/add 충돌을 일으켜 안전하게 중단한 뒤, `git rebase --rebase-merges --no-update-refs origin/main`으로 병합 구조를 보존했습니다. `main.ts`·루트 `package.json`의 충돌은 최신 수집기·뽑기·합성 연결을 유지하도록 해결했습니다. Git의 병합 이력 보존 동작은 [공식 rebase 문서](https://git-scm.com/docs/git-rebase)에 설명되어 있습니다.

| 검증                                            | 결과                                                                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge-base --is-ancestor origin/main HEAD` | 종료 코드 0입니다. 최신 main이 현재 브랜치에 포함됩니다.                                                                                                          |
| rebase 전후 `packages/pet-battle` tracked diff  | 차이가 없습니다. 이번 점검 문서 작성 전의 전투 구현 전체가 동일합니다.                                                                                            |
| 기존 미추적 문서 2개                            | rebase 직후 SHA-256이 모두 동일했습니다. 이후 요청 대상 MR 문서만 갱신했습니다. 기존 HP 연출 문서는 그대로입니다.                                                 |
| 전투 밖 순변경                                  | 10개 파일, 508줄 추가·16줄 삭제입니다. MR §2에 전부 표기했습니다.                                                                                                 |
| 공통 Client·DB·토큰·수집기 코드                 | `apps/desktop/src/main/{clients,persistence,usage,ipc}`와 공통 preload는 최신 main과 동일합니다.                                                                  |
| 다른 기능 패키지                                | `pet-core`, `pet-client`, `pet-room`, `pet-gacha`, `pet-combine`, `pet-meta`는 최신 main과 동일합니다. `pet-overlay`에는 이미지 경합 방지와 그 테스트만 남습니다. |

최종 [main.ts](../../../apps/desktop/src/main/main.ts)의 뽑기·합성 transaction 및 요청 창/mainFrame 검사(296–305행), 실제 수집기 주입(318행), 집계 완료 후 재예약(365행), 종료 시 집계 대기 후 DB 정리(389–403행)를 확인했습니다. 루트 `token:grant`도 보존됐습니다. 전투 프로세스 정리는 별도 `before-quit` 구독입니다.

## 3. 확인된 교차 기능 동작

실제 `RoomState`, `RoomCollectionPort`, SQLite `PetClient`·`TokenClient`, 뽑기·합성 클라이언트 및 Rust 전투 엔진을 사용했습니다. 사용자 DB 대신 `/tmp/petto-battle-rebase-20260930.zxMLFb/isolated-state-nR35XE/petto.sqlite`를 새로 만들었습니다. 펫룸의 Electron IPC는 대역으로 격리했고 GUI는 실행하지 않았습니다. 진단의 종료 코드 0은 아래 **불일치까지 예상대로 재현했다는 의미**이며, 모든 연동이 정상이라는 뜻이 아닙니다.

| 검증 항목                            | 관찰 결과                                                                                                                                        | 판정·영향                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 펫룸 선택 → 공통 Client → 전투       | 선택한 두더지의 `ownedPetId`가 세 경로에서 일치했습니다.                                                                                         | 전투 연동은 정상입니다.                                                                      |
| 같은 선택 → 기존 CollectionPort      | 공통 Client와 전투는 두더지인데 `overlayPet()`는 별빛마법사 Lv.25를 유지했습니다.                                                                | **이번 펫룸 연결 변경의 영향입니다.** 기존 `pet:overlay` 소비자는 오래된 값을 받습니다.      |
| main 원문의 기존 펫룸과 비교         | 같은 시드 명부에서 다른 펫 선택 시 CollectionPort는 두더지 Lv.3으로 바뀌고 JSON 저장이 1회 실행됐습니다. 반대로 공유 Client는 바뀌지 않았습니다. | 기존 명부 경로에서 공통 DB 경로로 바뀌면서 양쪽 소비자가 갈라졌음을 확인했습니다.            |
| 실제 뽑기                            | 보유 2→3마리, 재화 10,000,000→9,900,000입니다. 결과는 비활성이며 기존 활성 펫을 보존했습니다. 펫룸 재조회는 3마리입니다.                         | 최신 뽑기 거래와 공통 명부 조회는 정상입니다.                                                |
| 활성 펫을 재료로 합성                | 요청을 거부했고 보유 수·잔액이 그대로였습니다.                                                                                                   | 활성 펫 보호를 보존했습니다.                                                                 |
| 정상 합성 및 전투 조회               | 보유 13→4마리, 재화 9,900,000→9,870,000입니다. RARE 1마리를 생성하고 활성 두더지를 보존했습니다. 전투 조회는 추가 재화를 쓰지 않았습니다.        | 최신 합성 거래와 활성 펫 보존은 정상입니다.                                                  |
| 오버레이 선택 저장                   | `overlay_metadata`에 별빛마법사를 저장해도 공유 활성 펫은 두더지였습니다.                                                                        | **main에도 존재하는 선택 저장소 분리**입니다.                                                |
| 오버레이 성장 저장                   | `pet_profiles`에 두더지 Lv.25/누적 XP 999를 저장해도 `owned_pets`는 Lv.1/XP 0, 전투도 Lv.1입니다.                                                | **main에도 존재하는 성장 미연동**입니다. 공통 `updateGrowth()`에 저장돼야 전투가 반영합니다. |
| 열린 펫룸에서 뽑기·합성 후 목록 갱신 | 코드상 최초 `roomScene()`에서만 전체 목록·스프라이트를 생성하며 명부 변경 구독은 없습니다.                                                       | 추가 연동이 필요합니다. GUI 재현은 미수행이므로 화면 실측 결과로 표기하지 않습니다.          |

근거 원문:

- [room.ts](../../../apps/desktop/src/main/room.ts) 98–139·155–159행: 공통 Client 조회·선택 분기가 기존 CollectionPort 갱신·JSON 저장을 건너뜁니다.
- [collection.ts](../../../apps/desktop/src/main/collection.ts) 42–59행과 [handlers.ts](../../pet-meta/src/app/handlers.ts) 238행: 기존 `pet:overlay`는 별도 명부를 조회합니다. 최신 정보 화면의 공통 Client 조회와 구별해야 합니다.
- [App.jsx](../../pet-overlay/src/App.jsx) 8–29행, [성장 저장소](../../../apps/desktop/src/main/persistence/repositories/pet-growth-repository.ts) 93–138·228행: 오버레이 선택·성장은 공유 파일 안의 다른 테이블에 저장됩니다. DB 파일이 같다는 이유만으로 자동 동기화되지는 않습니다.
- [petroom.js](../../pet-room/ui/petroom.js) 307–358행 및 [뽑기 IPC](../../../apps/desktop/src/main/ipc/gacha.ts)·[합성 IPC](../../../apps/desktop/src/main/ipc/combine.ts): 명부 재적재 알림이 연결되어 있지 않습니다.

## 4. 다른 담당자 브랜치와의 충돌

현재 fetch한 ref에서 새로 조율할 대상은 `origin/feature/active-pet-source-of-truth`의 `779ddaa9193f7e237f17000b8e1154e46b61459b`입니다. 최신 main 위의 1개 커밋입니다.

`git merge-tree --write-tree --name-only HEAD origin/feature/active-pet-source-of-truth`는 종료 코드 1이며, 작업 파일·index·브랜치를 바꾸지 않는 가상 병합 결과는 다음과 같습니다.

| 파일                               | 텍스트 병합 | 의미·담당 조율                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/main.ts`    | 충돌 확인   | 전투 Client 마운트와 상대 브랜치의 성장 초기화·IPC 연결을 함께 살려야 합니다.                                                                                                                                                                                                                            |
| `apps/desktop/src/main/windows.ts` | 충돌 확인   | 전투창 연결과 상대 브랜치의 구형 펫 창 제거를 구분해야 합니다.                                                                                                                                                                                                                                           |
| `apps/desktop/src/main/room.ts`    | 자동 병합   | **실행 의미는 합의가 필요합니다.** 상대 브랜치의 `growthSeeds()`·`applyGrowth()`는 옛 `#collection`을 사용하지만 전투 브랜치는 공통 Client에서 활성·성장을 읽습니다. 그대로 합치면 성장 반영 대상과 조회 대상이 달라집니다. 알림 누락 가능성은 코드 기반 판단이며 병합된 앱 실행 검증은 하지 않았습니다. |

나머지 겹치는 원격 ref 6개는 관련 파일이 이미 main에 squash 통합된 작업과 byte 단위로 같았습니다. 단순히 `--no-merged`에 나온다고 새 충돌 후보로 세지 않았습니다.

| 원격 ref (`origin/` 생략)                     | 겹친 파일         | 동일 파일을 포함한 main 커밋 |
| --------------------------------------------- | ----------------- | ---------------------------- |
| `chore/ohk9134/native-rebuild-on-install`     | `package.json`    | `de153be` / #11              |
| `feature/ohk9134/meta-contracts-and-currency` | `main.ts`         | `2d9e574` / #12              |
| `feature/ohk9134/meta-design-guide`           | `.prettierignore` | `c2b589a` / #5               |
| `feature/ohk9134/meta-pet-client`             | `main.ts`         | `09c06a3` / #15              |
| `feature/ohk9134/meta-pet-portrait`           | `windows.ts`      | `8bfd9cd` / #10              |
| `feature/sh111-coder/ccusage-collector`       | `main.ts`         | `729f8cf` / #17              |

## 5. 테스트와 한계

| 실행                                               | 결과                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `npm run build`                                    | 통과: 오버레이·Rust·전체 TypeScript 빌드입니다.        |
| `bash .harness/scripts/verify-electron.sh`         | 포맷·타입 검사 통과, 패키지 테스트 435/435 통과입니다. |
| `npm run test:rust --workspace @pet/battle`        | 46/46 통과입니다.                                      |
| `npm run test:integration --workspace @pet/battle` | 실제 Rust 연동 3/3 통과입니다.                         |
| `npm run test:storage --workspace @pet/desktop`    | 70건 중 68건 통과·2건 실패입니다.                      |
| main 원문으로 실패 2건 재현                        | 같은 2건이 실패했습니다. 아래에 원인을 구분했습니다.   |

호스트 실패 ① [ccusage-collector.test.cjs](../../../apps/desktop/test/ccusage-collector.test.cjs) 342–345행은 현재 플랫폼용 ccusage 바이너리를 찾지 못했습니다. 최신 main에 추가된 의존성이 현재 설치 환경에서 해결되지 않은 상태입니다. ② [token-client.test.cjs](../../../apps/desktop/test/token-client.test.cjs) 224–234행은 기대 migration scope 목록에 `meta`가 빠져 실제 5개와 기대 4개가 다릅니다.

Baseline 재현은 별도 checkout이 아니라 `git show 5324d2d:<test>` 원문을 현재와 동일한 Electron 33.4.11 / Node 20.18.3 / darwin-arm64 환경에서 실행했습니다. 테스트·전이 import 소스·migration·의존성 잠금 등 51개 파일의 main/HEAD/working tree 동일성을 먼저 확인했고, 동일 원문에서 생성한 현재 dist를 공유했습니다. 관련 테스트 2건 실패·나머지 16건 선택 제외 결과입니다. 전투 회귀가 아닌 기존 코드/설치 환경 문제로 분류하되, 전체 호스트 테스트를 통과했다고 표기하지 않습니다. 의존성 설치나 다른 담당자 테스트 수정은 하지 않았습니다.

미검증 범위는 실제 전체 앱 GUI, 열려 있는 펫룸의 명부 변화, 다른 OS/CI의 Rust·ccusage 설치, 담당자의 로컬 미푸시 변경 및 이후 원격 변경입니다. 그러므로 최종 앱 병합 승인은 활성 펫·성장 담당자와 공통 경로를 합의한 뒤 별도로 확인해야 합니다.

## 6. push 주의

이번 작업은 로컬 rebase와 MR 문서 갱신까지이며 원격 push·MR 게시/수정은 하지 않았습니다. 전투 브랜치 하나를 명시한 push가 다른 원격 feature ref를 직접 바꾸지는 않지만, MR이 main에 병합되면 위 공통 변경이 다른 담당자에게 전달됩니다.

Rebase로 원격 전투 브랜치와 이력이 달라졌으므로 이후 승인된 push는 원격 tip을 다시 확인하고, 전투 ref와 예상 SHA를 명시한 `--force-with-lease=<ref>:<expect>`로 보호해야 합니다. 일반 `--force`는 사용하지 않습니다. 예상 tip과 다르면 거절한다는 보장은 [공식 git-push 문서](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt)를 따릅니다. Lease는 위 기능 충돌이나 연동 공백을 해결해 주지는 않습니다.
