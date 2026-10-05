/**
 * 토큰 4종과 그 파생값. 기획서 8.5가 이 파일의 명세다.
 *
 * USD 비용 필드가 **없다**는 점이 중요하다. 기획서 INFO-008은 비용이 화면뿐 아니라
 * 저장된 표시용 데이터에도 존재하지 않아야 한다고 정한다. 타입에 자리를 만들지 않는 것이
 * 가장 확실한 이행 방법이다.
 */

export interface TokenCounts {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export const ZERO_TOKENS: TokenCounts = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

export function tokenCounts(
  input: number,
  output = 0,
  cacheCreate = 0,
  cacheRead = 0,
): TokenCounts {
  return { input, output, cacheCreate, cacheRead };
}

/**
 * 기획서 8.5: `관측 토큰 = 입력 + 출력 + 캐시 생성 + 캐시 읽기`.
 * 정보 화면과 사용량 업적이 쓰는 값이다.
 */
export function observed(counts: TokenCounts): number {
  return counts.input + counts.output + counts.cacheCreate + counts.cacheRead;
}

/**
 * 기획서 8.5의 "보상 대상 토큰".
 *
 * 관측 토큰과 **다른 값**이어야 한다는 것이 계약의 핵심이다. 캐시 읽기를 제외한다 — 캐시
 * 읽기는 같은 맥락을 다시 읽을 때마다 쌓여서 관측 토큰의 대부분을 차지하고, 그대로 보상하면
 * 새로 일한 양이 아니라 대화 길이를 보상하게 된다.
 *
 * 이 값이 **그대로** 재화가 된다. 재화의 단위가 토큰이라 환산 비율이 없다.
 */
export function rewardTokens(counts: TokenCounts): number {
  return counts.input + counts.output + counts.cacheCreate;
}

export function isZero(counts: TokenCounts): boolean {
  return observed(counts) === 0;
}

export function addTokens(left: TokenCounts, right: TokenCounts): TokenCounts {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheCreate: left.cacheCreate + right.cacheCreate,
    cacheRead: left.cacheRead + right.cacheRead,
  };
}

/** 행별 증가분 계산에 쓴다. 음수는 0으로 잘라낸다. */
export function subtractTokens(left: TokenCounts, right: TokenCounts): TokenCounts {
  const floor = (value: number): number => (value > 0 ? value : 0);
  return {
    input: floor(left.input - right.input),
    output: floor(left.output - right.output),
    cacheCreate: floor(left.cacheCreate - right.cacheCreate),
    cacheRead: floor(left.cacheRead - right.cacheRead),
  };
}
