# 펫 도감 작업 결과

- 트랙: `$work` standard
- Seed: [`.harness/specs/features/2026-10-05-pet-dex.md`](../.harness/specs/features/2026-10-05-pet-dex.md) (Approved 2026-10-05)
- 비목표: 기획서 Non-goals 그대로(완성 보상, 설명 문구, 뽑기 결과 NEW 연출, 정보 화면 도감 기준 변경, 오버레이 진입점)

## 계획과 변경

| 순서 | 변경                                                                                                                                                                                                        | 검증                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | 펫 도메인: `pet` v2 `pet_discoveries`(기존 보유 종은 확인한 발견으로 채움), `PetRepository.#insertPet`이 같은 트랜잭션에서 발견 기록, `PetClient.listDexEntries`·`markDexSeen`, meta 의 `InMemoryPetClient` | `apps/desktop/test/pet-client.test.cjs` 도감 6건(먼저 실패 확인)  |
| 2    | `@pet/combine`이 `COMBINE_MATERIAL_COUNT`(10) 공개                                                                                                                                                          | 기존 합성 테스트                                                  |
| 3    | 새 패키지 `@pet/dex`: 화면 모델(`dexView`·`slotState`·`acquisitionHints`·`formatDiscoveredOn`·`roomFocusTarget`)과 UI                                                                                       | `packages/pet-dex/test/dex.contract.test.ts` 11건(먼저 실패 확인) |
| 4    | 앱 연결: 도감 창·preload·`dex:*` IPC, 펫룸 이동 대상 `dex`, 도감 버튼 NEW, `펫룸에서 보기` 포커스(`?focus=`·`room:focusPet`)                                                                                | `apps/desktop/test/dex-ipc.test.cjs` 5건, CDP 조작                |

## 기획서와 달라진 점

| 기획                                        | 구현                                       | 이유                                                                        |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `← 펫룸`을 머리줄 왼쪽에                    | 뽑기·합성과 같은 오른쪽 위                 | 세 화면이 한 창처럼 보이도록 창 버튼 자리를 맞춘다                          |
| 진화 썸네일 24px, 상세 무대 96px            | 썸네일 48px 상자에 1배, 무대 64px 상자     | 32·48px 카드를 정수 배율로 담고 패널 높이(약 290px)에 맞춘다                |
| 보유 수 배지 오른쪽 아래, 등급 배지 별도 줄 | 배지 오른쪽 위, 등급 배지는 무대 위에 얹음 | 72px 슬롯에서 번호와 겹치고, 상세가 넘쳐 버튼이 가려졌다                    |
| NEW 여부를 `room:scene`에 실음              | 펫룸 창 전용 `dex:hasNew` 채널             | `room:scene`은 펫룸 소유이고, 판정은 도감 화면 모델(`hasNew`)을 그대로 쓴다 |
| `펫룸에서 보기`는 종의 첫 개체              | 활성 개체, 없으면 최고 레벨 개체           | 사용자가 가장 아끼는 개체를 연다                                            |

## 검증

- Mechanical: `bash .harness/scripts/verify-electron.sh` exit 0 — Prettier 통과, typecheck 통과, `npm test` 253/253. `apps/desktop`의 `npm run test:storage` 86/86.
- Semantic: 임시 `--user-data-dir`로 앱을 띄워 CDP로 조작했다(가려진 창은 `--disable-backgrounding-occluded-windows` 등이 있어야 스크린샷이 찍힌다).

| AC                                  | 결과 | 증거                                                            |
| ----------------------------------- | ---- | --------------------------------------------------------------- |
| 1 펫룸 ↔ 도감 왕복                  | 통과 | 펫룸 버튼 클릭 → 도감 창, `← 펫룸` → 펫룸                       |
| 2 6종 등급 구역 표시                | 통과 | 슬롯 aria-label 6개, 스크린샷                                   |
| 3 미발견 실루엣·`???`·등급          | 통과 | 0종 상태 스크린샷, 상세 `???`·EPIC·힌트 2줄                     |
| 4 보유 `×N`                         | 통과 | 10연차 뒤 `×3`·`×6`·`×1` = 합성 창이 읽은 보유 수               |
| 5 뽑기 후 NEW, 상세 열면 해제       | 통과 | NEW 3종 → 열자 사라짐, 펫룸 배지 on → off                       |
| 6 합성 후 `×0` 유지                 | 통과 | 두더지 6마리 전부 합성 → `discovered-empty`, `×0`, 첫 만남 유지 |
| 7 진행도·탭 수치 일치               | 통과 | `5 / 6`·83%, 탭 `2/2·2/2·1/2`                                   |
| 8 migration 전 보유 = 발견·NEW 없음 | 통과 | 저장소 테스트                                                   |
| 9 방향키·Enter                      | 통과 | 003 → 004 → 005 → 006 이동, Enter 로 선택                       |

- 미확인: 도감 조회 실패 패널과 이동 실패 문구는 앱에서 재현하지 않았다(IPC 거부는 테스트). `prefers-reduced-motion`도 앱에서 켜 보지 않았다.

## Independent Review

`code-reviewer` 판정 COMMENT(HIGH 없음). 반영한 지적:

- M1 이동 실패가 도감 전체를 조회 실패로 바꿈 → 상세에 문구만 보이고 다시 읽는다.
- M2 자동 선택 슬롯이 NEW 를 해제하지 않음 → 상세에 보이면 확인한 것으로 처리한다.
- L1 focus 마다 그리드·무대를 다시 만듦 → 화면 모델이 같으면 선택 표시만 바꾼다(앱에서 같은 요소 유지 확인).
- L2 선택 슬롯의 포커스 외곽선 → 실선이 이긴다. L3 오류 시 상세가 남음 → 숨긴다.
- L4 `dex:hasNew` 발신자 제한·판정 중복 → 펫룸 창만, 판정은 `dexView().hasNew`.
- L5 열린 펫룸의 배지 → 펫룸 focus 때 다시 읽는다. L6 IPC 테스트 추가.
- 남김: 로드 중인 펫룸에 보내는 `room:focusPet` 유실 가능성(리뷰어도 낮은 확신, 실제 동선은 `?focus=` 경로).

## Evolve

가려진 Electron 창은 CDP `Page.captureScreenshot`이 멈춘다. 앱을 조작해 검증하는 메모리에 실행 플래그를 덧붙였다. 하네스 규칙 변경은 없음.
