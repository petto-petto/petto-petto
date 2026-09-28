# 펫 뽑기 — PetClient 연결 및 테스트 안내

뽑기 화면의 고정 종 목록을 제거하고 `PetClient.listSpecies()`로 후보와 확률표를 구성하도록 연결했다. 1회·10회 추첨 후 `createOwnedPets()`로 결과를 저장한다. 기존 확률·10연 보장·천장 계산은 뽑기 엔진을 그대로 사용한다.

2026-09-29 업데이트: 뽑기 비용도 공유 SQLite 재화 원장에서 차감한다. 펫 생성과 비용
차감은 한 트랜잭션이며, 신규 저장소는 재화 0으로 시작한다. 테스트 재화는
`npm run token:grant -- <금액>` 명령으로 지급한다.
합성 창도 실제 보유 개체와 같은 잔액을 사용한다.

## 직접 테스트

레포 루트에서 실행한다. 이미 실행 중인 앱은 완전히 종료한 뒤 다시 실행한다.

```bash
GACHA_PROTO_OPEN=1 npm start
```

1. 뽑기 창 오른쪽 위의 **펫 N마리**를 확인한다. 이 숫자는 DB에 저장된 보유 개체 수다.
2. **확률 보기**에서 DB에 등록된 후보 6종이 나오는지 확인한다.
3. **1회 소환** 후 보유 수가 1 증가하는지 확인한다.
4. 결과를 닫고 **10회 소환** 후 보유 수가 10 증가하는지 확인한다.
5. 앱을 완전히 종료하고 같은 명령으로 다시 실행한다. 보유 수가 유지되면 저장된 개체를 다시 읽은 것이다.

기존 펫룸은 아직 새 Client에 연결하지 않았으므로 뽑힌 펫이 기존 펫룸에 자동으로 표시되지는 않는다. 이번 수동 확인은 뽑기 창의 보유 수와 결과로 수행한다. 실제 앱에서 뽑으면 기존 공용 `petto.sqlite`에 개체가 추가된다.

## 연결 구조

```text
뽑기 화면 → 뽑기 전용 preload → main의 뽑기 기능
                                  ↓
                              PetClient
                                  ↓
                       SqlitePetClient → PetRepository
```

조회·뽑기 두 경로만 연결했다. 화면은 뽑기 횟수 1 또는 10을 요청하고, main에 주입된 뽑기 기능이 DB 후보로 추첨하여 저장한다. 화면에서 임의의 결과 종을 지정해 저장하지 않는다.

- [persistent-gacha.ts](../packages/pet-gacha/src/persistent-gacha.ts): 후보 조회, 기존 엔진 호출, 개체 저장. 저장 성공 후에만 메모리 천장 상태를 갱신한다.
- [ui/app.ts](../packages/pet-gacha/src/ui/app.ts): 후보 로딩, 확률표, 저장 성공 후 결과 연출·보유 수 갱신. 요청 중 중복 클릭을 막는다.
- [ipc/gacha.ts](../apps/desktop/src/main/ipc/gacha.ts), [preload/gacha.cjs](../apps/desktop/src/preload/gacha.cjs): 뽑기 창의 조회·뽑기 요청 연결.
- [gacha-persistence.test.cjs](../apps/desktop/test/gacha-persistence.test.cjs): 실제 DB 및 화면 호출 흐름 검증.

## 실패 시 동작과 범위

조회 실패 시 오류를 표시하고 소환 버튼으로 재시도할 수 있다. 저장 실패 시 일부 펫만 남기지 않으며, 성공 연출·토큰 차감·천장 증가를 반영하지 않는다. 저장이 끝난 뒤 결과 연출 중 창을 닫아도 이미 저장한 개체는 유지된다.

펫 개체와 재화는 공유 SQLite에 영속화한다. 천장은 앱 실행 중 메모리 상태로 유지되어
앱을 재시작하면 초기화된다. UI만 새로 열면 main의 천장 상태를 다시 조회한다.

## 검증 및 작업 기록

- Track: standard. Seed는 승인된 [공통 펫 최소 설계](pet-data-design.md)와 사용자의 뽑기 기능 연결 요청이다.
- 성공 기준: DB 후보 조회, 1/10회 결과 저장, 재연결 후 유지, 실패 시 부분 지급·상태 전진 없음, 화면에서 직접 테스트 가능.
- Explorer: 뽑기 UI의 고정 목록과 renderer 내 엔진, preload 없는 독립 창, 기존 공유 DB 초기화 경로를 확인했다.
- Planner: 기존 엔진을 감싸 Client를 주입하는 뽑기 함수를 만들고, 조회·뽑기 연결과 화면 로딩·실패·보유 수를 추가한다. 합성·펫룸·성장·재화 연결은 범위 밖이다.
- Implementer: 구현 전 새 테스트 4개의 실패를 확인했다. 이후 실제 저장, bridge/화면 흐름, 기본 난수 검증까지 신규 8개 테스트로 확장했다.
- Mechanical: `npm run test:storage --workspace @pet/desktop`, `bash .harness/scripts/verify-electron.sh`, `npm run build`, `git diff --check`를 실행한다.
- Semantic: DB 변경이 후보에 반영됨, 1+10회 후 11개 UUID 개체 보존, INSERT 실패 rollback 및 재시도, 잘못된 횟수·빈 후보 거부, 연속 클릭 차단, 실패 시 토큰 유지와 오류 표시를 검사한다. 실제 Electron GUI를 자동 실행하지 않고 컴파일된 화면 코드를 최소 DOM 대역에서 preload/main/임시 DB와 연결했다.
- Reviewer: 구현 단계와 분리한 동일 에이전트 검토에서 저장 전후 상태 갱신 순서, 브라우저 모듈의 Node 의존성 부재, 뽑기 창의 preload 연결, main 등록·송신 창 확인, 기존 호출부 보존을 점검했다. 별도 에이전트 리뷰는 수행하지 않았다.
- Evolve: none. 공통 harness 변경 없음.

실제 창의 시각적 확인은 위 수동 절차로 수행한다. 자동 검증을 실제 GUI를 열어 확인한 것으로 간주하지 않는다.
