# AI 도구 토큰 모듈 — 작업 내용 및 사용 안내

공유일: 2026-09-21

## 무엇이 준비됐나요?

AI 도구(Claude Code·Codex·Gemini CLI)의 **토큰 사용량을 SQLite에 저장하고 조회하는 공통 `TokenClient` 모듈을 구현했습니다.** 각 기능에서 `TokenClient`를 주입받아 사용하면 됩니다.

- 도구별 사용량 적재 (중복 인입 자동 차단)
- 도구별 누적 조회, 전체 누적 조회
- 최근 적재 내역 조회
- 최초 실행 시 테이블 생성

공통 모듈 구현과 테스트를 완료했습니다. **인입 경로 연결과 화면 연결은 각 담당자의 작업으로 남아 있습니다.** 기존 `meta-state.json`의 사용량 데이터를 새 테이블로 자동 이관하지 않습니다.

## 사용량은 누적만 합니다

차감 메서드가 없는 것이 의도입니다. 어제 Claude Code로 50만 토큰을 쓴 것은 일어난 사실이고, 무언가를 소비했다고 40만이 되지 않습니다. 줄여 버리면 사용량 화면과 누적 기반 업적이 함께 틀어집니다.

**소비할 수 있는 잔액은 재화 도메인의 것입니다.** 재화 담당은 이 모듈의 `reward` 값을 환산해서 쓰면 됩니다(아래 "재화 담당에게" 참조).

## 구조와 DB

```text
각 기능 → TokenClient 인터페이스 → SqliteTokenClient 구현체 → TokenRepository → petto.sqlite
```

외부 계약은 `TokenClient`입니다. `TokenRepository`는 별도 인터페이스 없이 구현한 구체 클래스입니다.

| 구성                          | 위치                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| 공개 인터페이스와 데이터 타입 | [packages/pet-client/src/token.ts](../packages/pet-client/src/token.ts)                      |
| Client 구현체                 | [sqlite-token-client.ts](../apps/desktop/src/main/clients/sqlite-token-client.ts)            |
| Repository                    | [token-repository.ts](../apps/desktop/src/main/persistence/repositories/token-repository.ts) |
| 테이블 생성                   | [migrations/token.ts](../apps/desktop/src/main/persistence/migrations/token.ts)              |
| 통합 테스트                   | [token-client.test.cjs](../apps/desktop/test/token-client.test.cjs)                          |

기존 공용 `petto.sqlite`에 다음 두 테이블을 추가했습니다.

| 테이블          | 저장 내용                                                 |
| --------------- | --------------------------------------------------------- |
| `token_stats`   | 도구별 누적 — 관측 토큰, 보상 대상 토큰, 마지막 기록 시각 |
| `token_history` | 적재 한 건 — 도구, 관측/보상 토큰, 멱등 키, 발생 시각     |

기존 migration 등록부에 `token / 1`을 추가했으므로 앱의 기존 DB 초기화 경로에서 자동 적용됩니다. 재실행 시 중복 적용하지 않습니다.

### 왜 테이블이 둘인가

`token_stats`는 도구마다 한 행이라 영원히 세 행이고, 조회가 적재 건수와 무관하게 O(1)입니다. `token_history`는 추가만 하는 원장이라 "언제 얼마가 들어왔나"를 잃지 않습니다.

둘은 **항상 한 트랜잭션에서 함께** 바뀝니다. 그래서 `token_stats.observed`는 같은 도구의 `token_history.observed` 합과 언제나 같습니다. 통계가 틀어져도 내역에서 재계산할 수 있습니다.

## 연결 방법

### 1. 기능 패키지에 타입 의존성 추가

사용할 `packages/<기능>/package.json`의 기존 dependencies에 추가합니다.

```json
{
  "dependencies": {
    "@pet/client": "*"
  }
}
```

같은 패키지의 `tsconfig.json`에서는 기존 references에 다음 항목을 추가합니다.

```json
{
  "references": [{ "path": "../pet-client" }]
}
```

기존 설정을 대체하지 말고 항목만 추가합니다. 의존성을 변경한 후 레포 루트에서 `npm install`을 실행합니다.

`PetClient` 때문에 이미 `@pet/client`를 쓰고 있다면 이 단계는 건너뛰어도 됩니다. 두 인터페이스가 같은 패키지에 있습니다.

### 2. 기능 코드는 TokenClient를 전달받기

```ts
import type { TokenClient } from '@pet/client';

export function loadUsage(tokens: TokenClient) {
  return tokens.statsByProvider();
}
```

함수 인자나 기존 클래스 생성자로 전달받으면 됩니다. `@pet/client`는 타입만 제공하므로 import만으로 DB 연결이나 Client 인스턴스가 생기지는 않습니다.

### 3. 앱에서 구현체 조립 후 기능에 전달

아래는 `apps/desktop/src/main/` 기준 예제입니다. `appDatabase`는 기존 앱이 생성하고 `open()`까지 호출한 공유 DB입니다.

```ts
import type { TokenClient } from '@pet/client';
import { SqliteTokenClient } from './clients/sqlite-token-client.ts';
import { TokenRepository } from './persistence/repositories/token-repository.ts';

const tokens: TokenClient = new SqliteTokenClient(new TokenRepository(appDatabase));
// 자신의 기능 초기화 함수나 생성자에 tokens를 전달합니다.
```

같은 인스턴스를 필요한 기능에 전달해 사용합니다. 각 기능에서 DB를 새로 열거나 닫지 않습니다.

## 제공 메서드

모든 메서드는 **동기식**이며 `await` 없이 호출합니다.

| 메서드                 | 반환·동작                                       | 주요 사용자    |
| ---------------------- | ----------------------------------------------- | -------------- |
| `recordUsage(entry)`   | 적재 성공이면 `true`, 이미 본 멱등 키면 `false` | 인입 경로      |
| `statsByProvider()`    | 도구별 누적 목록. provider 오름차순             | 정보 화면      |
| `totals()`             | 전체 누적 `{ observed, reward }`                | 정보 화면·재화 |
| `recentHistory(limit)` | 최근 적재 내역. `entryId` 내림차순              | 진단·내역 화면 |

## 적재하기

```ts
tokens.recordUsage({
  provider: 'claude_code',
  observed: 1_000, // 입력 + 출력 + 캐시 생성 + 캐시 읽기
  reward: 700, // 보상 환산 대상 (캐시 읽기 제외)
  dedupeKey: 'claude_code:0->1000',
  occurredAt: new Date().toISOString(),
});
```

### 인입 경로는 호출자가 정합니다

`TokenClient`는 hook인지 주기 집계인지 모릅니다. 증가분을 계산해서 넘겨주기만 하면 됩니다.

**`dedupeKey`는 호출자가 만듭니다.** 무엇이 유일한지는 인입 경로만 알기 때문입니다.

| 인입 경로 | 키로 쓸 만한 것                       |
| --------- | ------------------------------------- |
| hook      | 세션 ID + 메시지/턴 식별자            |
| 주기 집계 | `<provider>:<이전 누적>-><현재 누적>` |

같은 키로 다시 부르면 **통계도 내역도 바뀌지 않고** `false`를 돌려줍니다. 호출 전에 "이미 넣었나" 조회할 필요가 없습니다 — 조회와 삽입 사이에 끼어든 두 번째 인입은 그 방식으로 막지 못하고, 여기서는 DB의 `UNIQUE` 제약이 판정합니다.

### observed와 reward를 둘 다 받는 이유

두 값이 서로 다르고, 어느 쪽을 쓸지는 읽는 쪽이 정하기 때문입니다.

- `observed` — 캐시 읽기 포함. 사용량 표시용
- `reward` — 캐시 읽기 제외. 재화 환산 대상

여기서 하나로 합쳐 저장하면 나중에 다른 쪽을 복원할 수 없습니다.

## 조회하기

```ts
// 도구별 사용량
for (const row of tokens.statsByProvider()) {
  console.log(row.provider, row.observed, row.reward, row.updatedAt);
}

// 전체 누적
const { observed, reward } = tokens.totals();
```

`statsByProvider()`는 **기록이 있는 도구만** 돌려줍니다. 한 번도 사용 기록이 없는 도구는 행 자체가 없습니다. 세 도구를 항상 표시해야 하는 화면이라면 `PROVIDERS`(`@pet/core`)를 기준으로 순회하면서 없는 도구를 0으로 채우면 됩니다.

## 재화 담당에게

이 모듈은 재화를 만들지도 차감하지도 않습니다. 환산에 필요한 값만 제공합니다.

```ts
const { reward } = tokens.totals(); // 누적 보상 대상 토큰
```

참고로 현재 `SqliteCurrencyPort.grantUsageTokens`는 집계 한 건씩 `Math.floor(reward / 10_000)`로 환산해서, **매번 나머지가 버려집니다.** 1분에 9,999 토큰을 쓰면 0코인이 적립되고 그 9,999개는 다음 집계로 이월되지 않습니다.

`token_stats.reward`에 누적이 남으므로 이제 이월이 가능합니다.

```text
이번에 줄 코인 = floor(누적 reward / 10,000) − 이미 준 코인
```

이 변경은 재화 도메인의 정책이라 이번 작업에 포함하지 않았습니다.

## 실패·빈 결과 처리

- 기록이 없으면 `statsByProvider()`는 `[]`, `totals()`는 `{ observed: 0, reward: 0 }`입니다.
- 알 수 없는 도구, 음수·소수·안전 정수를 넘는 토큰 수, 빈 멱등 키는 예외를 던집니다.
- 멱등 키는 앞뒤 공백을 제거하고 저장합니다. `'  k  '`와 `'k'`는 같은 키입니다.
- 적재 도중 실패하면 통계와 내역이 **함께 rollback**됩니다. 한쪽만 반영된 상태는 존재하지 않습니다.

```ts
try {
  const stats = tokens.statsByProvider();
  // stats로 화면 상태를 갱신합니다.
} catch (error) {
  const message = error instanceof Error ? error.message : '사용량 조회에 실패했습니다.';
  // 해당 기능의 기존 오류 표시 경로에 message를 전달합니다.
}
```

## 이번 모듈에 포함하지 않은 것

- **재화 전부** — 잔액, 차감, 음수 방지 제약, 환산 비율. 재화 담당 몫입니다.
- **인입 경로 연결** — hook이든 주기 집계든 `recordUsage()`를 부르는 코드는 붙이지 않았습니다. `main.ts`는 건드리지 않았습니다.
- **모델별 분해** — `claude-opus-5` 단위 집계는 없습니다. 도구별·시각별까지입니다.
- **기존 `meta-state.json` 사용량 이관** — 자동 이관하지 않습니다.

## 연결 담당자가 할 일

1. 자신의 패키지에 `@pet/client` 타입 의존성을 추가합니다. 이미 쓰고 있다면 추가 작업이 없습니다.
2. 앱 초기화 코드에서 조립한 Client를 자신의 기능에 전달합니다.
3. 인입 경로에서 `recordUsage()`를 호출합니다. 멱등 키 규칙을 먼저 정합니다.
4. 같은 사용량 값을 기존 저장소와 새 테이블 양쪽에 계속 쓰지 않도록 전환합니다.

## 검증

실제 임시 SQLite 파일을 사용하여 신규 테스트 10개를 추가했습니다. 적재 시 통계·내역 동시 갱신, 멱등 키 중복 차단, 도구별 분리, 재연결 후 보존, 잘못된 입력 거부, 실패 시 rollback, 늦게 도착한 과거 인입의 시각 처리, 멱등 키 공백 정규화, migration 재적용 방지, 기존 기능과의 공존을 검증했습니다.

테스트에 효력이 있는지도 확인했습니다. 트랜잭션과 `updated_at` 수정을 각각 되돌린 상태로 실행해 해당 테스트가 실제로 실패하는 것을 보고 나서 복원했습니다.

- `npm run test:storage --workspace @pet/desktop`: 저장소 테스트 27개 통과 (기존 17 + 신규 10).
- `bash .harness/scripts/verify-electron.sh`: 형식·타입 검사 통과, 패키지 테스트 163개 통과.

검증 범위는 공통 데이터 모듈입니다. 인입 경로와 화면에 연결한 뒤에는 해당 기능의 동작도 별도로 확인해야 합니다.
