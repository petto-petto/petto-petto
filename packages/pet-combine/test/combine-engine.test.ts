import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCombineAnimationLock, createCombineEngine, type CombinePet } from '@pet/combine';

const pets = {
  common: [
    { id: 'c1', name: '두더지', grade: 'common' },
    { id: 'c2', name: '나무', grade: 'common' },
  ],
  rare: [
    { id: 'r1', name: '얼룩말', grade: 'rare' },
    { id: 'r2', name: '햄스터', grade: 'rare' },
  ],
  epic: [
    { id: 'e1', name: '다람쥐', grade: 'epic' },
    { id: 'e2', name: '마법사', grade: 'epic' },
  ],
} as const satisfies Record<'common' | 'rare' | 'epic', readonly CombinePet[]>;

test('탭 진입 시 표시 순서대로 같은 등급 카드 10장을 자동 선택한다', () => {
  const engine = createCombineEngine<CombinePet>(pets, () => 0);
  assert.deepEqual(engine.getState().selection, Array(10).fill('c1'));
  assert.deepEqual(engine.selectGrade('rare').selection, Array(10).fill('r1'));
});

test('자동 선택을 제거하고 같은 등급의 다른 종으로 교체할 수 있다', () => {
  const engine = createCombineEngine<CombinePet>(pets, () => 0);
  engine.removePet(0);
  engine.addPet('c2');
  assert.equal(engine.getState().selection.filter((id) => id === 'c2').length, 1);
  engine.addPet('r1');
  assert.equal(engine.getState().selection.length, 10);
});

test('common 10장은 3만 Token을 차감하고 rare 결과를 균등 후보에서 선택한다', () => {
  const engine = createCombineEngine<CombinePet>(pets, () => 1);
  const result = engine.combine();
  assert.deepEqual(result, { kind: 'success', grade: 'rare', pet: pets.rare[1], stage: 1 });
  assert.equal(engine.getState().tokenBalance, 170_000);
  assert.equal(engine.getState().inventory.c1, 20);
});

test('재료 부족과 Token 부족은 상태를 차감하지 않는다', () => {
  const engine = createCombineEngine<CombinePet>(pets, () => 0, 0);
  engine.removePet(0);
  const before = engine.getState();
  assert.deepEqual(engine.combine(), { kind: 'error', code: 'selection' });
  assert.deepEqual(engine.getState(), before);
  engine.selectGrade('rare');
  const tokenBefore = engine.getState();
  assert.deepEqual(engine.combine(), { kind: 'error', code: 'tokens' });
  assert.deepEqual(engine.getState(), tokenBefore);
});

test('20만 Token으로 rare 합성은 두 번 성공하고 세 번째에는 Token 부족을 보인다', () => {
  const engine = createCombineEngine<CombinePet>(pets, () => 0);
  engine.selectGrade('rare');

  assert.equal(engine.combine().kind, 'success');
  assert.equal(engine.combine().kind, 'success');
  const before = engine.getState();

  assert.deepEqual(engine.combine(), { kind: 'error', code: 'tokens' });
  assert.deepEqual(engine.getState(), before);
});

test('합성 연출 중에는 중복 실행을 막고 완료 뒤에 다시 시작할 수 있다', () => {
  const lock = createCombineAnimationLock();
  assert.equal(lock.tryStart(), true);
  assert.equal(lock.tryStart(), false);
  lock.finish();
  assert.equal(lock.tryStart(), true);
});
