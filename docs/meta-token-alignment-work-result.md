# meta 재화 단위·토큰 적재·합성 업적·도감 칸 수 정렬 — 작업 결과

## 결정과 범위

- Track: standard. Seed: 승인된
  [기능 사양](../.harness/specs/features/2026-10-05-meta-reward-and-achievement-alignment.md).
- 성공 기준: 사양의 Acceptance criteria 열 항목.
- Non-goals: 합성·뽑기·전투·성장·활성 펫·트로피의 실제 데이터 연결(표가 없어 Mock 유지),
  과거 원장 소급, 연결 이전 사용량의 토큰 표 이관(요청자가 불필요하다고 확인).

## 작업 절차

- Interview/Seed: 요청자가 2026-10-05 에 네 가지를 결정했다 — 코인 개념 제거(재화 = 토큰량),
  합성 업적은 현재 합성 규칙으로 달성 가능하게, 전투 업적 유지, 도감 칸 수는 현재 종 수.
  업적 보상 금액과 지급 기준 토큰은 구현자에게 맡겼다.
- Explorer: `ccusage` 수집 → `meta` 집계 파이프라인 → `meta_usage_daily` · `currency_ledger`
  경로를 확인했다. `TokenClient.recordUsage` 는 호출처가 없었고, 요청자 DB 의 `token_stats` ·
  `token_history` 는 0행이었다. 재화를 "코인"으로 다루는 곳은 `meta` 와 `@pet/core` 의 `Coin`
  타입뿐이고 뽑기·합성은 `TokenClient` 로 토큰량을 그대로 쓴다.
- Planner: (1) 집계가 상태를 바꾸기 전에 토큰 표에 적재, (2) 환산 메서드와 비율 제거,
  (3) 업적 보상 `coin` → `token` 과 저장 형식·DB migration, (4) 합성 사실을 결과 등급 기준으로,
  (5) 도감 칸 수를 `PetClient.countSpecies()` 로.
- Implementer: 테스트를 먼저 고쳐 6개 테스트 파일의 실패를 확인한 뒤 구현했다.
- Evolve: 하네스 규칙 `rules/feature-contracts.md` 를 `$harness-improve` 로 바꿨다 — 작업하는
  쪽이 Port 를 선언하고, 있으면 재사용하고, 표가 없는 데이터는 Mock. 기록은
  `.harness/friction/2026-09-03-feature-contract-rules.md` 의 2026-10-05 항목.

## 2차 작업 — 재화 포트를 TokenClient 로 통합

- Seed: 같은 사양(요청자 지시 “네 TokenClient로 합쳐주세요”를 Scope 에 반영).
- Explorer: `meta` 가 재화에서 쓰는 것은 지급 · 잔액 · 오늘 획득 합계 셋이었다. 앞의 둘은
  `TokenClient` 에 이미 있었고, 오늘 획득은 `recentLedger(500)` 를 훑어 계산하고 있었다.
  `CurrencyPort.totals()` 는 `meta` 안에 호출처가 없었다.
- Planner: `TokenClient` 에 `earnedSince(since)` 하나를 더하고, `meta` 는
  `TokenPort = Pick<TokenClient, …>` 로 좁혀 받는다. `CurrencyPort` · `SqliteCurrencyPort` ·
  두 대역(`InMemoryCurrency` · `InMemoryUsageLedger`)은 지우고 대역 하나(`InMemoryTokenClient`)로
  합친다.
- Implementer: 테스트를 먼저 새 모양으로 바꿔 6개 테스트 파일의 실패를 확인한 뒤 구현했다.
- 따라온 변화: 오늘 획득이 원장 최근 500건이 아니라 날짜 범위 합계가 되어, 하루에 500건을
  넘겨도 합계가 줄지 않는다. 재화 조회 실패 문구는 어댑터가 붙이던 한국어 문구 대신
  `TokenClient` 가 던진 원문이 된다(화면 표시는 그대로 `⚠ 조회 실패`, 툴팁만 달라진다).
- Evolve: 규칙 문장은 그대로 두고 규칙·가이드의 토큰 예시만 실제 코드에 맞췄다.

## 3차 작업 — 뽑은 횟수 표시와 뽑기 가능 알림

- Track: standard. Seed: 제품 기획서 6.3(알림 규칙)과
  [기능 사양](../.harness/specs/features/2026-10-05-meta-gacha-ready-notification.md).
- Explorer: `뽑은 횟수`는 `MetaAppState` 가 직접 만든 `StubGacha(12, 4)` 에서 왔다.
  `뽑기 가능` 알림은 설정값만 저장되고 읽는 곳이 없었다. 주기 집계는 `usage:aggregated` 를
  `bubble: undefined` 로 방송하고 있었고, 오버레이는 이 채널의 말풍선을 그리지 않는다.
- Planner: 횟수는 `null`("저장하는 곳이 없음")로, 비용은 `GachaPort.drawCost()` 대역 100,000 으로.
  전환 판단은 순수 함수 `gachaReadyTransition`, 직전 상태는 `MetaAppState` 의 메모리에 둔다.
- Implementer: 계약 테스트 7개를 먼저 써서 실패를 확인한 뒤 구현했다.
- 보류: 성장 업적의 `pet_profiles` 연결. 시드 명부 때문에 첫 판정에서 업적 4개와 2,200,000
  토큰이 지급되는 것을 확인해 요청자 결정으로 남겼다.
- Evolve: none.

## 4차 작업 — 사용량은 앱이 켜져 있는 동안만 센다

- Track: standard. Seed:
  [기능 사양](../.harness/specs/features/2026-10-05-meta-usage-counts-while-app-runs.md).
- Explorer: 기준점은 처음 한 번만 잡혀 저장됐고, 다시 켠 앱의 첫 집계가 저장된 기준점과의 차이를
  적립했다. 계약 테스트 `기획서 8.2: 기준점이 재실행 후에도 살아 있다` 가 그 동작을 고정하고
  있었다.
- Planner: 도메인 함수 `beginSession` 이 모든 소스의 기준점을 비우고, `MetaAppState` 생성자가
  부른다. 소스를 껐다 켤 때 비활성 기간을 제외하는 기존 방법과 같다.
- Implementer: 앱 상태를 같은 저장소로 두 번 만드는 테스트가 꺼져 있던 동안의 80,000 을 적립하는
  것을 실패로 확인한 뒤 구현했다.
- 해석: 재화뿐 아니라 통계·함께한 시간·사용량 업적·공용 토큰 표에서도 제외했다. 요청자가
  2026-10-05 에 이 해석이 맞다고 확인했다.
- Evolve: none.

## 5차 작업 — 화면과 업적을 누적 토큰 기준으로

- Track: standard. Seed: 첫 기능 사양의 Scope · Domain rules 13~17(요청자 지시 반영).
- Explorer: 요약의 `사용한 토큰`, 사용량 화면 전체, 토큰 마일스톤 업적이 캐시 읽기를 포함한 관측
  토큰을 쓰고 있었다. 요청자 DB 에서 관측 7,223만 대 재화 잔액 47,572 였다.
- Planner: 요약 첫 칸은 원장의 지급 합(`earnedSince` 전체 기간)으로, 사용량 화면은 보상 대상
  토큰으로, 토큰 마일스톤은 판정 때 읽은 누적 토큰의 최고치(`earnedTokens` 사실)로.
- Implementer: 테스트를 먼저 바꿔 실패를 확인한 뒤 구현했다. 기존 소급 판정 테스트 하나가
  `무패` 보상으로 마일스톤이 함께 열려 실패했고, 그 동작은 의도한 것이라 별도 테스트로 고정했다.
- 구현자가 정한 것: 토큰 마일스톤 목표값(100만 · 1천만 · 1억)은 그대로 두었다. 예전 기준에서는
  몇 분 만에 차던 100만이 누적 토큰 기준에서는 뽑기 10회 값이다. 사용량 화면의 제목은
  `쌓인 토큰`으로 했다 — 기간 필터(`오늘` 등)와 함께 읽혀서 `누적`보다 자연스럽다.
- Evolve: none.

## 6차 작업 — 업적 줄: 티어 제거 · 배지 · 달성 시각

- Track: standard. Seed:
  [기능 사양](../.harness/specs/features/2026-10-05-meta-achievement-row-badges.md).
- Interview: 배지의 적용 범위와 형태가 열려 있어 요청자에게 물었다 — 22개 전부, 픽셀 아이콘.
- Explorer: 줄 맨 앞은 이모지(자물쇠 · 메달 · 물음표)였고, 달성 시각은 `unlockedAt` 으로 이미
  저장하고 있었다. 티어는 정의와 화면 모델에만 있고 저장되지 않는다.
- Planner: 배지 그림을 화면 모델(`view/badges.ts`)에 두고 줄마다 실어 보낸다. 가려진 히든 줄은
  물음표 배지를 실어 그림이 조건을 흘리지 않게 한다. 화면은 캔버스에 1:1 로 찍고 CSS 로 2배
  키운다.
- Implementer: 도안 22개와 물음표 · 기본 배지를 그려 미리보기 이미지로 확인했다. 잠김 상태는
  한 톤 실루엣이 동전과 시계를 같은 동그라미로 만들어, 외곽선과 면을 나눈 두 톤으로 바꿨다.
- Semantic: 인메모리 데이터로 실제 패널 UI 를 임시 Electron 창에 띄워 업적 화면을 캡처해
  확인했다. 그 과정에서 `800000 / 1000000` 처럼 끊지 않은 진행률이 보여 자릿수 구분을 넣었다.
- Evolve: none.

## 7차 작업 — 업적 줄: 잠긴 배지의 색 · 보상 위치 · 보상 직접 받기

- Track: standard. Seed: 같은 사양(요청자 지시를 Scope 와 Domain rules 8~16 에 반영).
- Explorer: 보상은 판정(`evaluate`) 끝의 정산 단계에서 자동으로 지급되고 있었다. 보상 기록에는
  이미 "지급 대기" 상태가 있어서, 받지 않은 보상을 표현하는 데 새 저장 형식이 필요 없었다.
- Planner: 판정에서 정산을 떼어 내고 `claimRewards(업적 id)` 를 둔다. 화면 모델은 줄마다
  보상 상태를 싣고, 패널은 보상 줄을 맨 아래로 옮겨 받기 버튼을 둔다. 잠긴 배지는 자기 색을
  절반 농도로 그린다.
- Implementer: 테스트를 먼저 새 동작으로 바꿨다. 수령 구현을 되돌린 상태에서는 빌드가
  실패하는 것을 확인했다(화면 모델이 새 함수를 쓰기 때문이다).
- Semantic: 임시 Electron 창에서 실제 `보상 받기` 버튼을 눌러 잔액 0 → 100,000, 줄의
  `✓ 받음`, 받을 보상 3개 → 2개, 칭호 `초보 조련사` 장착을 확인했다. 캡처에서 `받을 보상 N개`
  글자가 양피지 위에 거의 보이지 않아 금색 칩으로 바꿨다.
- 따라온 변화: 뽑기 가능 알림은 업적 보상을 받은 다음 집계에서 나온다. 받지 않은 업적 보상은
  누적 토큰과 토큰 마일스톤에 들어가지 않는다.
- Evolve: none.

## 8차 작업 — 업적 줄: 보상을 오른쪽 위로, 종류별 모양

- Track: standard. Seed: 같은 사양(Domain rules 17~21).
- Planner: 화면 모델의 보상을 `{ 종류, 보이는 글자, 설명 }` 으로 바꾸고 종류 아이콘(8×8)을
  배지와 같은 팔레트로 둔다. 패널은 줄을 배지 | 본문 | 보상 칸으로 나눈다.
- Implementer: 화면 모델 테스트를 먼저 바꿔 실패를 확인한 뒤 구현했다.
- 구현자가 정한 것: 보상 칸의 폭은 112px 고정(줄마다 진행 막대 길이가 달라지지 않게), 달성한
  줄은 막대 대신 달성 시각만 적는다, 분류는 상자 없는 작은 글자로 물린다.
- Semantic: 임시 Electron 창 캡처로 동전 · 리본 · 잔 아이콘과 리본 띠, 오른쪽 위 배치, 버튼
  동작을 확인했다.
- Evolve: none.

## 구현자가 정한 것

- **업적 보상**: 기존 값 × 10,000. 예전 환산(보상 대상 토큰 10,000 = 재화 1)과 같은 배수라
  사용량 보상과 업적 보상의 비율이 그대로다. `첫 만남` 100,000(뽑기 1회) ~ `도감 마스터` ·
  `백전노장 Ⅱ` 3,000,000.
- **지급 기준 토큰**: 보상 대상 토큰(입력 + 출력 + 캐시 생성). 요청자 DB 기준 관측 토큰은
  6,878만, 보상 대상 토큰은 102만으로 캐시 읽기가 대부분이다.
- **`연금술의 기적`**: id(`hidden.common_fusion_epic`)는 유지하고 조건만 "합성으로 에픽 펫
  획득"으로 바꿨다. 업적 id 는 저장된 진행 기록과 지급 멱등 키의 기준이다.
- **토큰 표 적재 실패**: 그 소스의 집계를 실패로 끝내고 기준점을 전진시키지 않는다. 다음
  집계가 같은 증가분을 다시 계산한다.

## 검증과 검토

- Mechanical: `bash .harness/scripts/verify-electron.sh`, `npm run test:storage --workspace
@pet/desktop`, `bash .harness/tests/verify-contract.sh`. 결과는 최종 보고에 적는다.
- Semantic: 사양의 Acceptance criteria 를 계약 테스트와 실제 임시 SQLite 통합 테스트
  (`apps/desktop/test/meta-token-ingest.test.cjs`)로 확인했다. 요청자 DB 의 **복사본**에
  `meta / 2` migration 을 적용해 보상 기록 두 건이 `token` · `토큰 20` · `토큰 60` 으로 옮겨지고
  잔액 172 가 그대로인 것을 확인했다. 원본 DB 는 건드리지 않았다.
- Independent Review: 구현과 분리한 동일 에이전트 검토. 발견 1건 — 등록 종 수만 읽지 못하면
  패널이 `3/undefined` 를 그릴 수 있어 도감 칸을 조회 실패로 표시하도록 고쳤다. 별도 에이전트
  리뷰는 수행하지 않았다.

## 남은 검증 범위와 알려진 차이

- 실제 Electron 창을 띄워 눈으로 확인하지 않았다. 앱을 실행하면 요청자 DB 에 `meta / 2`
  migration 이 적용된다.
- 제품 기획서 `.harness/specs/meta-info-settings-achievements-design.md` 는 코인 용어와 7.2
  보상 표를 그대로 담고 있다. 이 사양이 그 부분을 대체한다.
- 데모 모드(`META_DEMO_USAGE=1`)는 가짜 사용량을 실제 토큰 표에 적재하고 그만큼 재화를
  지급한다. 예전에도 실제 원장에 지급했지만 이제 1:1 이라 양이 크다.
- 연결 이전에 쌓인 사용량은 `token_stats` 에 없다. `meta` 의 누적과 `TokenClient.totals()` 가
  그만큼 다르다.
