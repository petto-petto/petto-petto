# 뽑기·합성 Client 연결 작업 결과

## 결정과 범위

- Track: standard. Seed: 승인된 [기능 사양](../.harness/specs/features/2026-09-28-gacha-combine-clients.md).
- 성공 기준: 실제 보유 개체로 합성, 공유 재화로 뽑기·합성 비용 차감, 둘의 원자적 저장,
  중복 요청의 추가 차감 방지, 새 저장소에 자동 지급 없음.
- Token과 기존 재화 원장의 Coin은 1:1이다. `TokenClient`가 사용량 누적 기록과 소비 가능한
  재화 잔액을 함께 제공한다. 사용량 기록은 재화 소비로 차감하지 않는다. 펫룸·성장 전환과
  천장 영속화는 이번 범위 밖이다.
- 새 DB와 기존 DB 모두 자동 재화 지급을 하지 않는다. 테스트 중 필요한 재화는
  `npm run token:grant -- 10000000`으로 앱의 기존 DB에 원하는 금액만큼 지급한다.
  명령은 DB가 없으면 생성하지 않으며, 실행할 때마다 별도 지급 기록을 남긴다.

## 작업 절차

- Interview/Seed: 요청자가 1:1 단위와 기능 사양을 승인했고, 이후 자동 초기 지급을
  제거하고 관리자 명령으로 필요할 때 지급하도록 변경했다.
- Explorer: `PetClient`의 개체 조회·교체, `CurrencyRepository`의 원장, 공통
  `SqliteFileDatabase.transaction`, 기존 뽑기 IPC와 합성의 고정 목록을 확인했다.
- Planner: 기존 `TokenClient`에 재화 메서드를 추가하고, 두 feature 서비스에 Client와 트랜잭션 함수를 주입한다.
  합성 화면은 개체 ID를 선택해 IPC로 전달하며 성공 후 저장 상태를 다시 표시한다.
- Implementer: 집중 통합 테스트를 먼저 실패시킨 뒤 TokenClient 재화 메서드, 원자적 소비, 합성
  서비스·IPC·화면을 연결했다. 검토에서 중복 IPC 요청이 두 번 차감될 수 있음을 발견해
  별도 실패 테스트를 추가하고 요청 ID를 원장의 멱등 키로 기록하도록 수정했다. 사용자
  피드백에 따라 별도 `CurrencyClient`를 제거하고 뽑기·합성에 기존 `TokenClient`를 연결했다.
  `meta`의 기존 재화 포트와 보상 정책은 변경하지 않았다.
- Evolve: none. 공유 harness 규칙·Skill·역할은 바꾸지 않았다.

## 검증과 검토

- Mechanical: `bash .harness/scripts/verify-electron.sh` 통과(format/typecheck/패키지 테스트
  199개), `npm run build` 통과, 집중 Electron 저장소 테스트 19개 통과,
  `git diff --check` 통과. 전체 `npm run test:storage --workspace @pet/desktop`은
  62개 중 60개 통과했다. 나머지 두 실패는 작업 전에도 재현된 `ccusage` 바이너리 미설치와
  token-client 테스트의 기존 `meta` migration 누락 기대값이다.
- Semantic: 1회·10회 뽑기, COMMON·RARE 합성, 개체별 재료 선택, 부족액·활성 펫 거부,
  재시작 후 결과 유지, 펫·재화 저장 양방향 실패 롤백, 두 창의 다음 조회에 공유 상태 반영,
  같은 요청 ID 재전송 시 추가 차감 방지를 임시 SQLite와 preload/IPC/화면 대역에서 검사했다.
  관리자 명령의 금액 검증·기존 잔액 가산·중복 키 거부·재시작 후 보존도 검사했다.
- Independent Review: Client 경계, 중첩 SQLite 트랜잭션, IPC 발신 창 검사, 화면의
  중복 클릭과 재시도, 요청 ID의 원장 멱등 키, 새 DB의 자동 지급 제거를 검토했다.
  중복 IPC 요청의 추가 차감 가능성을 발견해 수정·회귀 테스트를 추가했다. 현재 변경
  범위에서 남은 코드 지적은 없다. 별도 에이전트 리뷰는 수행하지 않았다.

## 남은 검증 범위

실제 Electron 창을 눈으로 확인하는 단계는 자동화된 DOM·IPC 테스트와 별개다.
전체 저장소 테스트의 두 기존 실패는 이번 범위에서 수정하지 않았다.
