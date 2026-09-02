const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { effectiveTokens, createCursor, createBaselineCursor, sumNewTokens } = require('./ingest.cjs');

// 캐시 토큰은 제외 (input + output 만)
assert.strictEqual(
  effectiveTokens({ input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 500, cache_read_input_tokens: 999 }),
  3000,
);

const f = path.join(os.tmpdir(), `proto-transcript-${process.pid}.jsonl`);
const lines = [
  JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user' } }),
  JSON.stringify({ type: 'assistant', uuid: 'a1', message: { usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 } } }),
  JSON.stringify({ type: 'assistant', uuid: 'a2', message: { usage: { input_tokens: 500, output_tokens: 500, cache_creation_input_tokens: 0 } } }),
];
fs.writeFileSync(f, lines.join('\n') + '\n');

// 처음부터 합산(createCursor): a1=3000, a2=1000 -> 4000
let r = sumNewTokens(createCursor(f), f);
assert.strictEqual(r.tokens, 4000);

// 다시 호출 -> 새 줄 없음
let r2 = sumNewTokens(r.cursor, f);
assert.strictEqual(r2.tokens, 0);

// 증분: a3 추가 -> 200
fs.appendFileSync(f, JSON.stringify({ type: 'assistant', uuid: 'a3', message: { usage: { input_tokens: 100, output_tokens: 100 } } }) + '\n');
let r3 = sumNewTokens(r2.cursor, f);
assert.strictEqual(r3.tokens, 200);

// baseline: 기존 히스토리는 건너뛰고 이후 추가분만 계상 (레벨 폭등 방지)
let rb = sumNewTokens(createBaselineCursor(f), f);
assert.strictEqual(rb.tokens, 0);
fs.appendFileSync(f, JSON.stringify({ type: 'assistant', uuid: 'a4', message: { usage: { input_tokens: 250, output_tokens: 250 } } }) + '\n');
let rb2 = sumNewTokens(rb.cursor, f);
assert.strictEqual(rb2.tokens, 500);

fs.unlinkSync(f);
console.log('ingest.test.cjs OK');
