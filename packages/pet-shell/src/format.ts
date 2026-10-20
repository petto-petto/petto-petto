/**
 * 토큰 금액 표기. 모든 화면의 토큰 금액이 이 함수 하나를 지난다(동선 3단계, 요청자 결정 2026-10-17).
 *
 * 규칙은 정보 패널이 쓰던 것을 그대로 옮겼다. 표준 단위(K · M · B)를 쓴다 — 토큰 수치는 AI 도구가
 * 보고하는 값이고, 그 도구들이 쓰는 단위가 K · M · B라 한글 단위로 바꾸면 사용자가 환산해야 한다.
 *
 * - 1,000 미만은 그대로 쓴다.
 * - 그 이상은 100 미만이면 소수 한 자리(`.0` 생략), 100 이상이면 정수로 쓴다.
 * - 반올림해 1,000 에 닿으면 다음 단위로 올린다(999,949 → `1M`, `1000K`가 아니라).
 *
 * 축약은 표시에만 쓴다. 버튼을 누를 수 있는지와 부족분은 정확한 값으로 계산한다.
 */
const UNITS: readonly (readonly [number, string])[] = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
];

const exact = new Intl.NumberFormat('ko-KR');

export function compactAmount(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const format = (scaled: number, unit: string): string => {
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
    return `${sign}${text.replace(/\.0$/, '')}${unit}`;
  };
  for (let index = 0; index < UNITS.length; index += 1) {
    const [divisor, unit] = UNITS[index]!;
    if (abs < divisor) continue;
    const scaled = abs / divisor;
    const rounded = Number(scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1));
    const larger = UNITS[index - 1];
    if (rounded >= 1_000 && larger) return format(abs / larger[0], larger[1]);
    return format(scaled, unit);
  }
  return exact.format(value);
}

/** 정확한 값. 축약한 값에 마우스를 올렸을 때 보인다. */
export function exactAmount(value: number): string {
  return exact.format(value);
}
