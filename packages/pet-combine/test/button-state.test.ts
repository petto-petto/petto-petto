import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineCost, COMBINE_MATERIAL_COUNT } from '@pet/combine';
import { combineButtonState } from '../ui/button-state.mjs';

test('토큰 부족을 재료 수보다 먼저 표시하고 버튼을 비활성화한다', () => {
  for (const grade of ['common', 'rare'] as const) {
    assert.deepEqual(combineButtonState(grade, combineCost(grade) - 1, 9), {
      disabled: true,
      label: '토큰 부족',
    });
    assert.deepEqual(combineButtonState(grade, combineCost(grade) - 1, 10), {
      disabled: true,
      label: '토큰 부족',
    });
  }
});

test('토큰이 충분하면 선택 장수를 표시하고 10장일 때만 활성화한다', () => {
  for (const grade of ['common', 'rare'] as const) {
    for (const count of [0, 5, 9, 11]) {
      assert.deepEqual(combineButtonState(grade, combineCost(grade), count), {
        disabled: true,
        label: `${count}/${COMBINE_MATERIAL_COUNT}`,
      });
    }
    assert.deepEqual(combineButtonState(grade, combineCost(grade), COMBINE_MATERIAL_COUNT), {
      disabled: false,
      label: '합성하기',
    });
  }
});
