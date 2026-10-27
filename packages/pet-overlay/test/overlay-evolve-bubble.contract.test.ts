import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EVOLVE_LINES, pickEvolveLine } from '../src/overlay/evolve-lines.js';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const src = (...segments: string[]): string => join(packageRoot, '..', 'src', ...segments);
const read = (...segments: string[]): string => readFileSync(src(...segments), 'utf8');

const bubble = read('overlay', 'EvolveBubble.jsx');
const overlay = read('overlay', 'Overlay.jsx');
const engine = read('growth', 'engine.js');
const styles = read('styles.css');
const lines = EVOLVE_LINES;

/** 진화는 자동이 아니다 — 사용자가 눌러야 모습이 바뀐다. 그래야 연출을 본다. */
test('레벨이 올라도 저절로 진화하지 않는다', () => {
  const applyXpBody = engine.slice(
    engine.indexOf('export function applyXp'),
    engine.indexOf('export function evolve'),
  );
  assert.ok(applyXpBody.length > 0, 'applyXp 를 찾지 못했다');
  assert.doesNotMatch(applyXpBody, /evolutionStage\s*[:+]/, 'applyXp 가 단계를 올리면 자동 진화다');
});

/**
 * 레벨이 오르는 순간 사용자는 대개 다른 창에서 일하고 있다. 잠깐 뜨고 사라지는 안내는 못
 * 본다. 접힌 말풍선은 진화할 때까지 남아 있어야 한다.
 */
test('진화할 수 있는 동안 접힌 말풍선이 남아 있다', () => {
  // 진화 가능하고 메뉴가 닫혀 있으면 진화 말풍선이다(첫 펫 안내와 알림만 앞선다 — `speech.ts`).
  assert.match(overlay, /evolutionAvailable: pet\.evolutionAvailable/);
  assert.match(overlay, /speech\?\.kind === 'evolve' && \(\s*<EvolveBubble/);
  // 고른 대사가 없으면 접힌 상태다. 처음엔 없다.
  assert.match(bubble, /const \[line, setLine\] = useState\(null\)/, '처음엔 접혀 있다');
  assert.match(bubble, /if \(!line\) \{/);
  assert.doesNotMatch(bubble, /setTimeout/, '시간이 지나면 사라지면 안 된다');
  assert.match(styles, /\.evo-bubble \{/);
});

/**
 * 접힌 말풍선은 친구가 말을 걸려는 모습("입력 중…")이다. 기호(`!`, `✨`)는 처음 쓰는 사람이
 * 무엇인지 몰라 지나친다.
 */
test('접힌 말풍선은 입력 중 모양이다', () => {
  assert.equal((bubble.match(/className="evo-dot"/g) ?? []).length, 3, '점 세 개');
  assert.match(styles, /@keyframes evo-typing/);
  assert.doesNotMatch(bubble, />\s*!\s*</, '느낌표 표시는 쓰지 않는다');
});

/**
 * 펼치면 펫이 1인칭으로 부탁하고 버튼은 사용자의 대답이 된다. 거기서 눌러야 진화한다 —
 * 두 번 눌러야 실수가 없다.
 */
test('펫이 부탁하고, 대답하면 진화한다', () => {
  assert.match(bubble, /<button className="evo-bubble" onClick=\{open\}/);
  assert.match(bubble, /<div className="evo-call-text">\{line\}<\/div>/, '대사는 고른 문구');
  assert.match(bubble, /<button className="evo-call-btn pixel-button" onClick=\{onEvolve\}>/);
  assert.match(bubble, /진화시켜 줄게/, '버튼은 사용자의 대답');
  assert.match(overlay, /onEvolve=\{\(\) => g\.doEvolve\(\)\}/);
  // "나중에"도 제대로 된 버튼이다. 밑줄 친 글자로는 눌러도 되는 건지 안 보였다.
  assert.match(
    bubble,
    /className="evo-call-later pixel-button" onClick=\{\(\) => setLine\(null\)\}/,
  );
  assert.doesNotMatch(styles, /\.evo-call-later \{[^}]*text-decoration: underline/);
});

/** 친구가 하는 말이지 상태 알림이 아니다. 레벨 숫자를 말하게 하지 않는다. */
test('펫의 말에 레벨을 넣지 않는다', () => {
  assert.doesNotMatch(bubble, /Lv\.|level|reached/i);
  for (const line of lines) assert.doesNotMatch(line, /Lv|레벨|\d/, line);
});
/** 펫에는 드래그·놀아주기 핸들러가 걸려 있다. 그 안에 두면 클릭이 펫 반응으로 먹힌다. */
test('말풍선은 펫의 포인터 핸들러 밖에 있다', () => {
  const petStart = overlay.indexOf('className={`pet ');
  const bubbleAt = overlay.indexOf('<EvolveBubble');
  const toastsAt = overlay.indexOf('<Toasts');
  assert.ok(petStart > 0 && bubbleAt > petStart && bubbleAt < toastsAt);
  assert.ok(overlay.lastIndexOf('</div>', bubbleAt) > petStart, '.pet 블록이 닫힌 뒤에 온다');
});

test('메뉴 진화 팻말·펫 옆 버튼 같은 이전 방식은 남지 않는다', () => {
  for (const name of ['EvolveCue.jsx', 'EvolvePill.jsx', 'EvolveCall.jsx']) {
    assert.equal(existsSync(src('overlay', name)), false, `${name} 를 걷어냈다`);
  }
  assert.doesNotMatch(styles, /\.evo-cue|\.evo-pill|\.hmenu-evolve|\.has-evolve/);
});

/** 펫 이름은 정해져 있지 않다. "두더지가"는 맞아도 "볼주머니햄가"는 틀린다. */
test('이름 뒤 조사를 받침에 맞춰 고른다', () => {
  const body = bubble.slice(bubble.indexOf('function subjectParticle'));
  const subjectParticle = new Function(
    'name',
    body.slice(body.indexOf('{') + 1, body.indexOf('\n}')),
  ) as (name: string) => string;
  assert.equal(subjectParticle('두더지'), '가');
  assert.equal(subjectParticle('볼주머니햄'), '이');
  assert.equal(subjectParticle('미드나잇얼룩말'), '이');
  assert.equal(subjectParticle('별빛마법사'), '가');
  assert.equal(subjectParticle('Mochi'), '이(가)');
  assert.doesNotMatch(bubble, /\$\{petName\}가/, '조사를 고정해 붙이지 않는다');
});

test('부탁 대사는 여러 개 중 하나가 랜덤으로 뜨고, 방금 본 말은 반복하지 않는다', () => {
  assert.ok(lines.length >= 6, '대사가 충분히 있어야 랜덤처럼 느껴진다');
  assert.equal(new Set(lines).size, lines.length, '같은 대사가 두 번 들어 있지 않다');

  // random 을 주입해 모든 위치를 훑는다.
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    seen.add(pickEvolveLine(null, () => i / lines.length));
  }
  assert.equal(seen.size, lines.length, '모든 대사가 뽑힐 수 있다');

  for (const previous of lines) {
    for (const r of [0, 0.5, 0.999]) {
      assert.notEqual(
        pickEvolveLine(previous, () => r),
        previous,
        '방금 본 대사를 또 고르지 않는다',
      );
    }
  }
});
