import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compactAmount, exactAmount } from '@pet/shell';

/** 정보 패널이 쓰던 사례 표 그대로다. 모든 화면이 이 규칙 하나를 따른다(동선 3단계). */
test('토큰 금액은 K · M · B 로 줄이고 정보 패널의 기존 규칙을 그대로 따른다', () => {
  const cases: (readonly [number, string])[] = [
    [0, '0'],
    [999, '999'],
    [1_000, '1K'],
    [1_250, '1.3K'],
    [12_480, '12.5K'],
    [30_000, '30K'],
    [100_000, '100K'],
    [123_456, '123K'],
    [717_331, '717K'],
    [999_949, '1M'],
    [1_000_000, '1M'],
    [1_250_000, '1.3M'],
    [3_400_000_000, '3.4B'],
    [-1_500, '-1.5K'],
  ];
  for (const [value, expected] of cases)
    assert.equal(compactAmount(value), expected, String(value));
});

test('정확한 값은 천 단위 구분으로 쓴다 — 축약한 값의 툴팁이 쓴다', () => {
  assert.equal(exactAmount(255_309), '255,309');
});
