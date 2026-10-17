import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHELL_TABS, topBarView, type ShellState } from '@pet/shell';

const known: ShellState = {
  balance: 255_309,
  gachaAffordable: true,
  claimableRewardCount: 2,
  dexHasNew: true,
};

test('상단 바 탭은 펫룸 · 뽑기 · 합성 · 도감 · 전투 ↗ · 정보 ↗ 순이다', () => {
  assert.deepEqual(
    SHELL_TABS.map((tab) => `${tab.label}${tab.external ? ' ↗' : ''}`),
    ['펫룸', '뽑기', '합성', '도감', '전투 ↗', '정보 ↗'],
  );
});

test('지금 화면의 탭만 현재 탭이다', () => {
  const view = topBarView('combine', known);
  assert.deepEqual(
    view.tabs.filter((tab) => tab.current).map((tab) => tab.key),
    ['combine'],
  );
});

test('배지는 할 일이 있을 때만, 글자로도 읽힌다', () => {
  const badges = Object.fromEntries(
    topBarView('room', known).tabs.map((tab) => [tab.key, tab.badge]),
  );
  assert.deepEqual(badges['gacha'], { kind: 'dot', label: '뽑기 가능' });
  assert.deepEqual(badges['dex'], { kind: 'new', label: 'NEW' });
  assert.deepEqual(badges['info'], { kind: 'dot', label: '받을 보상 있음' });
  assert.equal(badges['room'], null);

  const quiet = topBarView('room', {
    balance: 10,
    gachaAffordable: false,
    claimableRewardCount: 0,
    dexHasNew: false,
  });
  assert.ok(quiet.tabs.every((tab) => tab.badge === null));
});

test('토큰 칩은 축약 표기, 마우스를 올리면 정확한 값이다', () => {
  assert.deepEqual(topBarView('room', known).token, {
    text: '255K',
    title: '보유 토큰 255,309',
  });
});

test('잔액을 읽지 못하면 칩은 — 이고 0 으로 그리지 않는다', () => {
  const view = topBarView('room', {
    balance: null,
    gachaAffordable: null,
    claimableRewardCount: null,
    dexHasNew: null,
  });
  assert.deepEqual(view.token, { text: '—', title: '보유 토큰을 불러오지 못했어요' });
  assert.ok(view.tabs.every((tab) => tab.badge === null));
});
