import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AmbientLogFeed, AMBIENT_MESSAGES, ambientLogLayout } from '../src/view/ambient-logs.ts';
import { battleLayout } from '../src/view/layout.ts';

test('펫·적 각각 20개 문구는 중복 없는 일인칭 말풍선이다', () => {
  for (const side of ['PET', 'ENEMY'] as const) {
    assert.equal(AMBIENT_MESSAGES[side].length, 20);
    assert.equal(new Set(AMBIENT_MESSAGES[side]).size, 20);
    for (const message of AMBIENT_MESSAGES[side]) {
      assert.ok(
        !/^(펫이|적이|적의)\s/u.test(message),
        'characters speak instead of being narrated',
      );
    }
  }
  const messages = [...AMBIENT_MESSAGES.PET, ...AMBIENT_MESSAGES.ENEMY];
  for (const example of [
    '반짝반짝. 달빛 좋아.',
    '쫑긋(간지러운 귀 긁음)',
    '친구들이 응원해주고 있어.',
  ]) {
    assert.ok(messages.includes(example), example);
  }
});

test('10~20초 무작위 간격으로 한 개씩 추가하며 조회만으로 추가되지 않는다', () => {
  for (const [random, delay] of [
    [0, 10000],
    [0.5, 15000],
    [1, 20000],
  ] as const) {
    const feed = new AmbientLogFeed('PET', () => random);
    assert.equal(feed.tick(100, true), false);
    assert.equal(feed.tick(100 + delay - 1, true), false);
    assert.equal(feed.tick(100 + delay, true), true);
    assert.equal(feed.entries.length, 1);
    assert.equal(feed.tick(100 + delay, true), false);
  }
});

test('화면에 있는 문구를 제외해 추첨하고 여섯 번째부터 가장 오래된 로그만 뺀다', () => {
  const feed = new AmbientLogFeed('PET', () => 0);
  feed.tick(0, true);
  for (let index = 1; index <= 5; index++) feed.tick(index * 10000, true);
  const previous = [...feed.entries];
  assert.equal(previous.length, 5);
  assert.equal(feed.tick(60000, true), true);
  assert.deepEqual(feed.entries.slice(0, 4), previous.slice(1));
  assert.ok(!previous.some((entry) => entry.text === feed.entries[4]!.text));
  for (let index = 7; index <= 100; index++) {
    feed.tick(index * 10000, true);
    assert.equal(feed.entries.length, 5);
    assert.equal(new Set(feed.entries.map((entry) => entry.text)).size, 5);
  }
});

test('작은 창·숨긴 화면에서는 쌓지 않으며 복귀나 긴 지연 뒤에도 한꺼번에 추가하지 않는다', () => {
  const feed = new AmbientLogFeed('ENEMY', () => 0);
  feed.tick(0, true);
  feed.tick(10000, true);
  feed.tick(15000, false);
  assert.equal(feed.tick(900000, false), false);
  assert.equal(feed.tick(1000000, true), false);
  assert.equal(feed.entries.length, 1);
  assert.equal(feed.tick(1010000, true), true);
  assert.equal(feed.tick(2000000, true), true);
  assert.equal(feed.entries.length, 3);
  feed.reset();
  assert.deepEqual(feed.entries, []);
  assert.equal(feed.tick(2000001, true), false);
});

test('펫과 적의 로그와 주기는 독립적이다', () => {
  const pet = new AmbientLogFeed('PET', () => 0);
  const enemy = new AmbientLogFeed('ENEMY', () => 1);
  pet.tick(0, true);
  enemy.tick(0, true);
  pet.tick(10000, true);
  enemy.tick(10000, true);
  assert.equal(pet.entries.length, 1);
  assert.equal(enemy.entries.length, 0);
  enemy.tick(20000, true);
  enemy.reset();
  assert.equal(pet.entries.length, 1);
});

test('말풍선은 전투 개체·바닥·관중 위치와 무관하게 HP바 아래 양쪽 화면 가장자리에 붙는다', () => {
  const battle = battleLayout(636, 416);
  const expected = ambientLogLayout(battle);
  assert.equal(expected.visible, true);
  assert.equal(expected.petX, 16);
  assert.equal(expected.enemyX, battle.width - 16 - expected.width);
  assert.equal(expected.top, 48);
  for (const petLeft of [16, 220, 380]) {
    for (const enemyLeft of [150, 340, 460]) {
      for (const floor of [180, 300, 400]) {
        const moved = { ...battle, petLeft, enemyLeft, floor };
        assert.deepEqual(ambientLogLayout(moved), expected, 'do not chase the moving actors');
        assert.deepEqual(
          ambientLogLayout(moved, true),
          expected,
          'spectators never displace the bubbles',
        );
      }
    }
  }
});

test('가로 540px·세로 416px 미만에서는 숨겨 다섯 말풍선이 전투를 덮지 않게 한다', () => {
  for (const [width, height] of [
    [360, 180],
    [900, 240],
    [360, 640],
    [539, 900],
    [900, 319],
    [540, 320],
    [900, 415],
    [700, 288],
  ] as const) {
    assert.equal(ambientLogLayout(battleLayout(width, height)).visible, false);
  }
  for (const [width, height] of [
    [540, 416],
    [636, 416],
    [640, 420],
    [800, 420],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    const battle = battleLayout(width, height);
    const logs = ambientLogLayout(battle);
    assert.equal(logs.visible, true);
    assert.equal(logs.petX, 16);
    assert.equal(logs.enemyX + logs.width, width - 16);
    assert.equal(logs.top, 48);
    assert.ok(logs.petX + logs.width + 40 <= logs.enemyX, 'the panels leave a central gap');
    assert.ok(logs.height >= 5 * 36 + 4 * 4, 'five portrait bubbles fit without clipping');
    assert.ok(logs.top + logs.height <= height - 12);
  }
});

test('크기 조절 시 양쪽 말풍선 폭은 같고 최대 240px이며 오른쪽만 새 가장자리를 따른다', () => {
  for (const [width, expectedWidth] of [
    [540, 234],
    [546, 237],
    [552, 240],
    [636, 240],
    [1200, 240],
  ] as const) {
    const logs = ambientLogLayout(battleLayout(width, 416));
    assert.equal(logs.width, expectedWidth);
    assert.equal(logs.height, 260);
    assert.equal(logs.petX, 16);
    assert.equal(logs.enemyX, width - 16 - expectedWidth);
    assert.equal(logs.top, 48);
  }
});

test('640×420 기본 데모창은 테두리 4px과 관중 유무에 상관없이 말풍선을 보여준다', () => {
  const battle = battleLayout(636, 416);
  for (const hasSpectators of [false, true]) {
    const logs = ambientLogLayout(battle, hasSpectators);
    assert.equal(logs.visible, true);
    assert.equal(logs.width, 240);
    assert.equal(logs.top, 48);
    assert.equal(logs.petX, 16);
    assert.equal(logs.enemyX, 380);
  }
});
