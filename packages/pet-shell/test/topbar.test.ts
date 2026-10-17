import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHELL_TABS, topBarView, type ShellState } from '@pet/shell';

const known: ShellState = {
  balance: 255_309,
  gachaAffordable: true,
  claimableRewardCount: 2,
  dexHasNew: true,
};

test('상단 바 탭은 펫룸 · 뽑기 · 합성 · 도감 · 정보 · 업적 · 전투 ↗ 순이고 설정이 그 오른쪽에 있다', () => {
  // 정보·업적·설정도 640 창의 한 화면이다(동선 4단계). 따로 뜨는 것은 전투뿐이다.
  assert.deepEqual(
    SHELL_TABS.map((tab) => `${tab.label}${tab.external ? ' ↗' : ''}`),
    ['펫룸', '뽑기', '합성', '도감', '정보', '업적', '전투 ↗', '설정'],
  );
  // 설정은 화면이 아니라 도구라 탭 줄 끝에 떨어뜨려 두고, 아이콘만으로는 모르니 글자를 함께 쓴다.
  const settings = SHELL_TABS.find((tab) => tab.key === 'settings');
  assert.deepEqual(
    { icon: settings?.icon, trailing: settings?.trailing },
    { icon: '⚙', trailing: true },
  );
});

test('설정 화면에서는 설정이 지금 탭이다', () => {
  assert.deepEqual(
    topBarView('settings', known)
      .tabs.filter((tab) => tab.current)
      .map((tab) => tab.key),
    ['settings'],
  );
});

test('업적 화면에서는 업적 탭이 현재 탭이다', () => {
  assert.deepEqual(
    topBarView('achievements', known)
      .tabs.filter((tab) => tab.current)
      .map((tab) => tab.key),
    ['achievements'],
  );
});

test('정보 화면에서는 정보 탭이 현재 탭이다', () => {
  const view = topBarView('info', known);
  assert.deepEqual(
    view.tabs.filter((tab) => tab.current).map((tab) => tab.key),
    ['info'],
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
  // 받을 보상은 업적 탭이 알린다.
  assert.deepEqual(badges['achievements'], { kind: 'dot', label: '받을 보상 있음' });
  assert.equal(badges['info'], null);
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
