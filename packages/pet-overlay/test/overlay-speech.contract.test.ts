import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MENU_HINT_TEXT,
  currentSpeech,
  enqueueNotices,
  type Notice,
} from '../src/overlay/speech.ts';
import { MENU_ITEMS, menuBadges, infoScreenFor } from '../src/overlay/menu-model.ts';

const achievement: Notice = { kind: 'achievement', text: '첫 만남 달성! 보상을 받아 가!' };
const gacha: Notice = { kind: 'gacha-ready', text: '뽑기를 할 수 있어!' };

test('업적과 뽑기가 함께 오면 업적 말풍선이 먼저다', () => {
  const queue = enqueueNotices([], [gacha, achievement]);
  assert.deepEqual(queue, [achievement, gacha]);
});

test('같은 종류의 알림은 마지막 것 하나만 기다린다', () => {
  const later: Notice = { kind: 'achievement', text: '2개 업적을 달성했어! 보상을 받아 가!' };
  assert.deepEqual(enqueueNotices([achievement, gacha], [later]), [later, gacha]);
});

test('말풍선 우선순위 — 메뉴가 열리면 비키고, 첫 안내 > 진화 > 알림', () => {
  const base = { menuOpen: false, menuHintPending: false, evolutionAvailable: false, notices: [] };
  assert.equal(currentSpeech(base), null);
  assert.deepEqual(currentSpeech({ ...base, notices: [gacha] }), { kind: 'notice', notice: gacha });
  assert.deepEqual(
    currentSpeech({ ...base, evolutionAvailable: true, notices: [gacha] }),
    { kind: 'evolve' },
    '진화 말풍선이 떠 있으면 알림은 기다린다',
  );
  assert.deepEqual(
    currentSpeech({ ...base, menuHintPending: true, evolutionAvailable: true, notices: [gacha] }),
    { kind: 'menu-hint' },
  );
  assert.equal(
    currentSpeech({ ...base, menuOpen: true, menuHintPending: true, notices: [gacha] }),
    null,
  );
});

test('첫 펫 안내는 우클릭 메뉴로 무엇을 할 수 있는지 말한다', () => {
  assert.match(MENU_HINT_TEXT, /우클릭/);
  assert.match(MENU_HINT_TEXT, /펫룸/);
  assert.match(MENU_HINT_TEXT, /뽑기/);
});

test('펫 우클릭 메뉴는 펫룸 · 뽑기 · 전투 · 정보 순이다', () => {
  assert.deepEqual(
    MENU_ITEMS.map((item) => item.label),
    ['펫룸', '뽑기', '전투', '정보'],
  );
});

test('배지는 할 일이 있을 때만, 모르면 그리지 않는다', () => {
  assert.deepEqual(menuBadges({ gachaAffordable: true, claimableRewardCount: 2 }), {
    gacha: '가능',
    info: '보상 2',
  });
  assert.deepEqual(menuBadges({ gachaAffordable: false, claimableRewardCount: 0 }), {
    gacha: null,
    info: null,
  });
  assert.deepEqual(menuBadges({ gachaAffordable: null, claimableRewardCount: null }), {
    gacha: null,
    info: null,
  });
  assert.deepEqual(menuBadges(null), { gacha: null, info: null });
});

test('받을 보상이 있으면 정보 팻말은 업적 화면을 연다', () => {
  assert.equal(infoScreenFor({ gachaAffordable: null, claimableRewardCount: 1 }), 'achievements');
  assert.equal(infoScreenFor({ gachaAffordable: null, claimableRewardCount: 0 }), 'info');
  assert.equal(infoScreenFor(null), 'info');
});
