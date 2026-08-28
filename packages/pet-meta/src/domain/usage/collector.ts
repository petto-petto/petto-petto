/**
 * 수집기 경계와 픽스처 구현. 기획서 8.1의 "번들 경계"가 이 파일이다.
 *
 * ## 왜 인터페이스를 두는가
 *
 * 기획서 8.1은 "세 CLI의 원본 세션 스키마를 앱 코드에서 각각 파싱하지 않는다"고 못박는다.
 * 실제 제품은 고정 버전 `ccusage`를 번들해 그 JSON만 읽는다. 즉 앱 안쪽에서 보면 수집기는
 * **"소스의 누적 스냅샷을 돌려주는 무언가"** 하나로 축약된다.
 *
 * 그 축약을 타입으로 적어 둔 것이 `UsageCollector`다. 프로토타입은 픽스처를 꽂고,
 * 제품은 `ccusage` 어댑터를 꽂는다. 8장의 규칙은 어느 쪽을 꽂아도 똑같이 성립해야 하므로
 * 규칙 테스트는 픽스처로 전부 작성한다.
 */

import { PROVIDERS, parseLocalDate, shiftDays, type LocalDate, type Provider } from '@pet/core';
import { Rng } from '../rng.ts';
import { addTokens, observed, tokenCounts, type TokenCounts } from './tokens.ts';

/**
 * 스냅샷의 행 키: `<로컬 날짜>|<원본 모델명>`.
 *
 * 기획서 5.2는 모델 행의 식별 기준이 `(도구, 원본 모델명)`이라고 정한다. 스냅샷은 이미
 * 도구 단위이므로 여기서는 날짜와 모델명만 갖는다. 모델명을 정규화하지 않고 원본 그대로
 * 두는 것도 의도적이다 — "알 수 없는 새 모델도 별도 매핑 없이 원본 이름으로 표시한다".
 */
export type RowKey = string;

export const rowKey = (date: LocalDate, rawModel: string): RowKey => `${date}|${rawModel}`;

export function splitRowKey(key: RowKey): { date: LocalDate; rawModel: string } {
  const separator = key.indexOf('|');
  return {
    date: key.slice(0, separator) as LocalDate,
    // 모델명에 `|`가 들어 있어도 잘리지 않도록 첫 구분자만 쓴다.
    rawModel: key.slice(separator + 1),
  };
}

export type SnapshotRows = Map<RowKey, TokenCounts>;

/**
 * 한 소스의 **누적** 스냅샷. 증가분이 아니라 누적값이라는 점이 중요하다.
 * `ccusage`가 언제 실행돼도 전체 기록을 돌려주기 때문이고, 기준점 방식(8.2)이
 * 이 성질에 기대고 있다.
 */
export interface SourceSnapshot {
  provider: Provider;
  rows: SnapshotRows;
}

export function emptySnapshot(provider: Provider): SourceSnapshot {
  return { provider, rows: new Map() };
}

export function snapshotTotal(snapshot: SourceSnapshot): number {
  let total = 0;
  for (const counts of snapshot.rows.values()) total += observed(counts);
  return total;
}

/**
 * 수집 실패 종류. 기획서 11.1의 사용자 표시 문구와 1:1로 대응시킨다.
 *
 * 사용자에게 원본 로그 내용이나 내부 명령 출력을 보여주지 않기 위해, 오류는 자유 문자열이
 * 아니라 **분류된 값**이다.
 */
export type CollectErrorKind = 'not_found' | 'unsupported_schema' | 'execution_failed';

const COLLECT_MESSAGES: Record<CollectErrorKind, string> = {
  not_found: '기록을 찾을 수 없음',
  unsupported_schema: '앱 업데이트가 필요합니다',
  execution_failed: '집계 오류',
};

export class CollectError extends Error {
  override readonly name = 'CollectError';
  readonly kind: CollectErrorKind;

  constructor(kind: CollectErrorKind) {
    super(COLLECT_MESSAGES[kind]);
    this.kind = kind;
  }

  /** 사용자에게 보이는 짧은 원인. */
  userMessage(): string {
    return COLLECT_MESSAGES[this.kind];
  }
}

/** 수집기 경계. 실제 제품에서는 고정 버전 `ccusage`의 JSON 어댑터가 이 자리를 채운다. */
export interface UsageCollector {
  /** 실패하면 `CollectError`를 던진다. */
  collect(provider: Provider): SourceSnapshot;
}

/**
 * 세 CLI의 기본 로그 위치. 기획서 2.2는 사용자 지정 경로를 제공하지 않으므로
 * 이 값은 표시 전용 상수다.
 */
const LOG_LOCATIONS: Record<Provider, string> = {
  claude_code: '~/.claude/projects',
  codex: '~/.codex/sessions',
  gemini_cli: '~/.gemini/tmp',
};

export const defaultLogLocation = (provider: Provider): string => LOG_LOCATIONS[provider];

/** 테스트와 데모가 쓰는 수집기. */
export class FixtureCollector implements UsageCollector {
  #responses = new Map<Provider, SourceSnapshot | CollectError>();

  /** 세 소스 모두 빈 스냅샷. 첫 집계가 "빈 기준점"을 잡게 한다. */
  static withEmptySnapshots(): FixtureCollector {
    const collector = new FixtureCollector();
    for (const provider of PROVIDERS) collector.setSnapshot(emptySnapshot(provider));
    return collector;
  }

  /** 세 소스 모두 `not_found`. 기획서 4.3·SET-001의 "소스가 0개인 최초 실행"을 만든다. */
  static withNoSources(): FixtureCollector {
    const collector = new FixtureCollector();
    for (const provider of PROVIDERS) {
      collector.setError(provider, new CollectError('not_found'));
    }
    return collector;
  }

  setSnapshot(snapshot: SourceSnapshot): void {
    this.#responses.set(snapshot.provider, snapshot);
  }

  setError(provider: Provider, error: CollectError): void {
    this.#responses.set(provider, error);
  }

  /** 현재 스냅샷에 증가분을 더한다. "사용자가 CLI를 더 썼다"를 흉내낸다. */
  accumulate(provider: Provider, date: string, rawModel: string, counts: TokenCounts): void {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new TypeError(`픽스처 날짜가 YYYY-MM-DD가 아님: ${date}`);

    const existing = this.#responses.get(provider);
    const snapshot =
      existing instanceof CollectError || existing === undefined
        ? emptySnapshot(provider)
        : existing;

    const key = rowKey(parsed, rawModel);
    snapshot.rows.set(key, addTokens(snapshot.rows.get(key) ?? tokenCounts(0), counts));
    this.#responses.set(provider, snapshot);
  }

  collect(provider: Provider): SourceSnapshot {
    const response = this.#responses.get(provider);
    if (response === undefined) throw new CollectError('not_found');
    if (response instanceof CollectError) throw response;
    // 파이프라인이 스냅샷을 보관하므로 복사해서 넘긴다. 그렇지 않으면 나중의
    // `accumulate`가 이미 저장된 기준점까지 바꿔 버린다.
    return { provider, rows: new Map(response.rows) };
  }
}

/**
 * 데모용 사용 기록을 픽스처에 **더한다**. `today`를 기준으로 최근 12주 분량이다.
 *
 * 픽스처를 새로 만들지 않고 기존 것에 더하는 이유가 중요하다. 기획서 8.2에 따라 첫 정상
 * 스캔은 기준점만 만들고 아무것도 적립하지 않는다. 그래서 데이터를 처음부터 넣어 두면
 * 12주치가 통째로 기준점에 흡수돼 화면이 텅 빈다. 빈 기준점을 먼저 잡은 뒤 이 함수로
 * "설치 이후 사용"을 만들어야 통계에 잡힌다.
 *
 * 시드를 받으므로 같은 시드는 항상 같은 데이터를 만든다. 화면을 눈으로 비교할 때
 * 실행마다 숫자가 달라지면 곤란하기 때문이다.
 */
export function seedDemoUsage(collector: FixtureCollector, today: LocalDate, seed: number): void {
  const rng = new Rng(seed);

  const catalog: readonly (readonly [Provider, readonly string[]])[] = [
    ['claude_code', ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']],
    ['codex', ['gpt-5.4-codex', 'gpt-5.4-mini']],
    ['gemini_cli', ['gemini-3-pro', 'gemini-3-flash']],
  ];

  for (const [provider, models] of catalog) {
    // 84일 = 12주. 잔디가 채워지도록 과거부터 심는다.
    for (let daysAgo = 0; daysAgo < 84; daysAgo += 1) {
      // 날짜의 약 35%는 사용 기록이 없게 둔다. 잔디에서 0과 비어 있지 않은 값이
      // 구분되는지(INFO-004) 눈으로 확인할 수 있어야 한다.
      if (rng.below(100) < 35) continue;

      const date = shiftDays(today, -daysAgo);
      // 하루에 모델을 두 번 뽑아 모델별 분해가 5개를 넘게 만든다. 그래야
      // `전체 N개 모델 보기`(INFO-006)가 실제로 동작하는 화면이 나온다.
      for (let pick = 0; pick < 2; pick += 1) {
        const model = models[rng.below(models.length)] ?? models[0];
        if (model === undefined) continue;
        const scale = 1 + rng.below(40);
        collector.accumulate(
          provider,
          date,
          model,
          tokenCounts(scale * 1_800, scale * 900, scale * 4_000, scale * 12_000),
        );
      }
    }
  }
}
