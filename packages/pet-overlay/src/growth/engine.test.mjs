import assert from 'node:assert';
import { computeXpGain, applyXp, createPet, requiredXp, evolve } from './engine.js';

// XP 공식 (성장시스템.md §2 예시)
assert.strictEqual(computeXpGain(100000, 1800), 21);
assert.strictEqual(computeXpGain(0, 10800), 0);
assert.strictEqual(computeXpGain(50000, 7200), 12);
assert.strictEqual(computeXpGain(4999, 3600), 0);

// 레벨업: Lv.1 + 20XP -> Lv.2
let r = applyXp(createPet(), 20);
assert.strictEqual(r.pet.level, 2);
assert.strictEqual(r.leveledUp, true);

// 요구 XP 누적: Lv.1->50 총합 1,090 (레벨 표와 일치)
let sum = 0;
for (let k = 1; k <= 49; k++) sum += requiredXp(k);
assert.strictEqual(sum, 1090);

// 한 번에 큰 XP -> 만렙. 순차 진화라 1차(Lv.15)만 우선 열림
let big = applyXp(createPet(), 2000);
assert.strictEqual(big.pet.level, 50);
assert.strictEqual(big.pet.xpIntoLevel, 0);
assert.ok(big.pet.evolutionAvailable);
const evoEvents = big.events.filter((e) => e.type === 'evolution-available').map((e) => e.level);
assert.deepStrictEqual(evoEvents, [15]);

// 1차 진화 -> stage 1, Lv.50 >= 35 이므로 2차가 곧바로 가능
let e1 = evolve(big.pet);
assert.strictEqual(e1.pet.evolutionStage, 1);
assert.ok(e1.pet.evolutionAvailable);
// 2차 진화 -> stage 2, 더 이상 진화 없음
let e2 = evolve(e1.pet);
assert.strictEqual(e2.pet.evolutionStage, 2);
assert.ok(!e2.pet.evolutionAvailable);

console.log('engine.test.mjs OK');
