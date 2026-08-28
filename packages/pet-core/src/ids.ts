/**
 * 도메인 사이에서 오가는 값 타입.
 *
 * 원시 `string` 대신 **브랜드 타입**을 쓴다. Java의 `record PetId(String value)`와 같은
 * 목적이다 — `PetId`와 `EventId`가 둘 다 `string`이면 서로 바꿔 넣어도 컴파일이 되지만,
 * 브랜드가 다르면 그 자리에서 타입 오류가 난다. 런타임 비용은 0이다.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 펫 식별자. 소유 도메인은 `collection`이다. */
export type PetId = Brand<string, 'PetId'>;
export const petId = (value: string): PetId => value as PetId;

/** 희귀도. 기획서 9.2가 이 세 값만 허용한다. */
export type Rarity = 'COMMON' | 'RARE' | 'EPIC';

/** 펫 획득 경로. 기획서 9.2의 `pet.acquired.source`. */
export type AcquireSource = 'gacha' | 'fusion' | 'hatch';

/** 전투 결과. 기획서 9.2의 `battle.finished.result`. */
export type BattleResult = 'win' | 'lose';

/** 사용량 수집 소스. 기획서는 이 세 개만 공식 소스로 인정한다. */
export type Provider = 'claude_code' | 'codex' | 'gemini_cli';

/** 기획서 6.1: 항상 같은 순서로 표시한다. */
export const PROVIDERS: readonly Provider[] = ['claude_code', 'codex', 'gemini_cli'];

const PROVIDER_NAMES: Record<Provider, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  gemini_cli: 'Gemini CLI',
};

/** 사용자에게 보이는 이름. 저장 키는 `Provider` 값 자체다. */
export const providerName = (provider: Provider): string => PROVIDER_NAMES[provider];

export const isProvider = (value: string): value is Provider =>
  (PROVIDERS as readonly string[]).includes(value);

/** 코인. 소비는 음수로 표현한다. */
export type Coin = number;

/**
 * 로컬 날짜 `YYYY-MM-DD`.
 *
 * 문자열로 두는 것이 의도다. ISO 형식이라 **사전순 비교가 곧 시간순 비교**이고,
 * `Map`/`Set`의 키로 그대로 쓸 수 있으며, JSON에 그대로 실린다. 기획서 8.7이 요구하는
 * "이미 저장한 날짜는 시간대가 바뀌어도 다시 분류하지 않는다"도 시간대 정보를 아예
 * 버림으로써 성립한다.
 */
export type LocalDate = Brand<string, 'LocalDate'>;

/**
 * 로컬 "분" `YYYY-MM-DDTHH:mm`. 함께한 시간의 단위다.
 *
 * 기획서 8.6의 핵심은 활동 시간이 **카운터가 아니라 분 집합의 크기**라는 것이다.
 * 문자열이라 `Set<LocalMinute>`이 값 기준으로 중복을 제거하고, 같은 분을 몇 번 넣어도
 * 크기가 변하지 않는다. 규칙이 자료구조로 보장된다.
 */
export type LocalMinute = Brand<string, 'LocalMinute'>;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `Date`를 실행 환경의 로컬 날짜로 바꾼다. */
export function localDateOf(at: Date): LocalDate {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` as LocalDate;
}

/** `Date`를 실행 환경의 로컬 분으로 바꾼다. 초 이하는 잘라낸다. */
export function localMinuteOf(at: Date): LocalMinute {
  return `${localDateOf(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}` as LocalMinute;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` 문자열을 검증해 받는다. 형식이 아니면 `undefined`. */
export function parseLocalDate(value: string): LocalDate | undefined {
  if (!DATE_PATTERN.test(value)) return undefined;
  const at = new Date(`${value}T00:00:00`);
  return Number.isNaN(at.getTime()) ? undefined : (value as LocalDate);
}

/**
 * `days`일 전 날짜.
 *
 * 정오를 기준으로 계산한다. 자정 기준으로 더하고 빼면 서머타임 전환일에 하루가
 * 밀리거나 겹칠 수 있기 때문이다.
 */
export function shiftDays(date: LocalDate, days: number): LocalDate {
  const at = new Date(`${date}T12:00:00`);
  at.setDate(at.getDate() + days);
  return localDateOf(at);
}

/** 월요일을 주의 시작으로 본 요일 번호(0 = 월요일). 12주 잔디의 열 배치에 쓴다. */
export function weekdayFromMonday(date: LocalDate): number {
  const at = new Date(`${date}T12:00:00`);
  return (at.getDay() + 6) % 7;
}

/** 로컬 분이 속한 날짜. */
export function dateOfMinute(minute: LocalMinute): LocalDate {
  return minute.slice(0, 10) as LocalDate;
}
