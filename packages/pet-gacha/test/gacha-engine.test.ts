import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGachaEngine, individualOdds, type RandomInt } from '@pet/gacha';

interface TestPet {
  readonly id: string;
}

const pets = {
  common: [{ id: 'common-1' }, { id: 'common-2' }],
  rare: [{ id: 'rare-1' }, { id: 'rare-2' }],
  epic: [{ id: 'epic-1' }, { id: 'epic-2' }],
} satisfies Record<'common' | 'rare' | 'epic', readonly TestPet[]>;

test('등급별 종은 해당 등급 안에서 균등한 난수 인덱스로 선택한다', () => {
  const engine = createGachaEngine(pets, sequence([8_001, 1]));

  assert.deepEqual(
    engine.draw(1).results.map((result) => result.pet.id),
    ['rare-2'],
  );
});

test('일반 등급 확률의 경계값은 common 80%, rare 17%, epic 3%를 따른다', () => {
  for (const [roll, expected] of [
    [7_999, 'common'],
    [8_000, 'rare'],
    [9_699, 'rare'],
    [9_700, 'epic'],
  ] as const) {
    const engine = createGachaEngine(pets, sequence([roll, 0]));
    assert.equal(engine.draw(1).results[0]?.grade, expected);
  }
});

test('10회 뽑기에서 첫 9회가 common이면 마지막 결과는 rare 이상이다', () => {
  const engine = createGachaEngine(
    pets,
    sequence([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8_499, 0]),
  );

  const draw = engine.draw(10);

  assert.equal(draw.results[9]?.grade, 'rare');
});

test('10연차 보장의 epic 경계값은 15%이며 앞서 rare가 나오면 보장을 적용하지 않는다', () => {
  const guaranteedEpic = createGachaEngine(
    pets,
    sequence([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8_500, 0]),
  );
  assert.equal(guaranteedEpic.draw(10).results[9]?.grade, 'epic');

  const priorRare = createGachaEngine(
    pets,
    sequence([8_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  );
  assert.deepEqual(
    priorRare.draw(10).results.map((result) => result.grade),
    [
      'rare',
      'common',
      'common',
      'common',
      'common',
      'common',
      'common',
      'common',
      'common',
      'common',
    ],
  );
});

test('천장 99의 다음 뽑기는 epic이고 카운터를 초기화한다', () => {
  const engine = createGachaEngine(pets, sequence([1]), {
    pityCounter: 99,
    totalDrawCount: 99,
  });

  const draw = engine.draw(1);

  assert.equal(draw.results[0]?.grade, 'epic');
  assert.deepEqual(engine.getState(), { pityCounter: 0, totalDrawCount: 100 });
});

test('종별 확률은 등급 확률을 해당 등급의 펫 수로 나누고 소수점 둘째 자리까지 표시한다', () => {
  assert.deepEqual(individualOdds(pets), {
    common: '40.00',
    rare: '8.50',
    epic: '1.50',
  });
});

test('뽑기 횟수는 1회 또는 10회만 허용한다', () => {
  const engine = createGachaEngine(pets, sequence([]));

  assert.throws(() => engine.draw(2 as 1), /1 또는 10/);
  assert.deepEqual(engine.getState(), { pityCounter: 0, totalDrawCount: 0 });
});

function sequence(values: number[]): RandomInt {
  const remaining = [...values];
  return (exclusiveMax) => {
    const value = remaining.shift();
    if (value === undefined) throw new Error('테스트 난수가 부족합니다');
    return value % exclusiveMax;
  };
}
