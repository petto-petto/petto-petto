import assert from 'node:assert';
import { GrowthController } from './controller.js';

const c = new GrowthController();
assert.strictEqual(c.ingest({ tokens: 100000, timestamp: 0, eventId: 's:1' }), true);
assert.strictEqual(c.ingest({ tokens: 100000, timestamp: 10, eventId: 's:1' }), false); // 중복 무시

const r = c.flush(5000); // 세션 5초 -> 계수 1.0, tokenXp 20
assert.strictEqual(r.tokens, 100000);
assert.strictEqual(r.gained, 20);
assert.strictEqual(c.pet.level, 2);

assert.strictEqual(c.flush(6000), null); // 대기 토큰 없음

// 전투 외부 XP
const before = c.pet.totalXp;
const e = c.addExternalXp(5, 'battle');
assert.strictEqual(e.pet.totalXp, before + 5);

// 실시간(applyNow): 5,000 미만은 누적만, 경계 넘으면 즉시 지급 (잔여 토큰 손실 없음)
const rt = new GrowthController();
let a = rt.applyNow({ tokens: 3000, timestamp: 0 });
assert.strictEqual(a.gained, 0);            // 3000 < 5000 -> 누적만
assert.strictEqual(a.toNext, 2000);
a = rt.applyNow({ tokens: 3000, timestamp: 50 }); // 누적 6000 -> 1 XP 즉시
assert.strictEqual(a.gained, 1);
assert.strictEqual(rt.pet.totalXp, 1);
a = rt.applyNow({ tokens: 100000, timestamp: 100 }); // 누적 106000 -> base 21, delta 20
assert.strictEqual(a.gained, 20);
assert.strictEqual(rt.pet.totalXp, 21);

console.log('controller.test.mjs OK');
