import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AmbientLogFeed, AMBIENT_MESSAGES, ambientLogLayout } from '../src/view/ambient-logs.ts';
import { battleLayout } from '../src/view/layout.ts';

test('펫·적 각각 20개 문구는 중복 없는 분위기 연출이다', () => {
  for (const side of ['PET', 'ENEMY'] as const) {
    assert.equal(AMBIENT_MESSAGES[side].length, 20);
    assert.equal(new Set(AMBIENT_MESSAGES[side]).size, 20);
  }
  assert.ok(AMBIENT_MESSAGES.PET.includes('펫이 피곤해합니다.'));
  assert.ok(AMBIENT_MESSAGES.ENEMY.includes('적의 점막이 부풀어오릅니다.'));
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

test('처치 적 관중이 있으면 로그를 위로 옮기고 세로 공간이 부족하면 숨긴다', () => {
  const battle = battleLayout(800, 420);
  const logs = ambientLogLayout(battle, true);
  assert.equal(logs.visible, true);
  assert.ok(logs.top + logs.height <= battle.floor - battle.spectatorSize - 20);
  assert.equal(ambientLogLayout(battleLayout(700, 288), true).visible, false);
});

test('양쪽 읽기 공간과 세로 높이가 충분한 창에서만 캐릭터 바깥에 로그를 배치한다', () => {
  for (const [width, height] of [
    [360, 180],
    [640, 420],
    [900, 240],
    [360, 640],
  ]) {
    assert.equal(ambientLogLayout(battleLayout(width!, height!)).visible, false);
  }
  for (const [width, height] of [
    [700, 288],
    [800, 420],
    [1440, 900],
    [1920, 1080],
  ]) {
    const battle = battleLayout(width!, height!);
    const logs = ambientLogLayout(battle);
    assert.equal(logs.visible, true);
    assert.ok(logs.petX >= 16);
    assert.ok(logs.petX + logs.width <= battle.petLeft - 20);
    assert.ok(logs.enemyX >= battle.enemyLeft + battle.petSize + 20);
    assert.ok(logs.enemyX + logs.width <= width! - 16);
    assert.ok(logs.top >= 48 && logs.top + logs.height <= height! - 12);
  }
});
