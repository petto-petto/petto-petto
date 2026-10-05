/**
 * 뽑기 가능 알림과 뽑은 횟수 표시의 계약.
 *
 * 알림 규칙은 기획서 6.3 이다 — 잔액이 뽑기 비용 미만에서 이상으로 **바뀌는 순간** 한 번만
 * 표시하고, 억제된 알림은 나중에 재생하지 않는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FixtureCollector,
  gachaReadyTransition,
  InMemoryCollection,
  InMemoryMetaStore,
  InMemoryPetClient,
  InMemoryTokenClient,
  MetaAppState,
  metaHandlers,
  type MetaHost,
  STUB_GROWTH_RULES,
  type SummaryScreen,
  tokenCounts,
  type TickReport,
} from '@pet/meta';

const DRAW_COST = 100_000;
const READY = '뽑기를 할 수 있어!';

function app() {
  const broadcasts: { channel: string; payload: unknown }[] = [];
  const host: MetaHost = {
    showPanel: () => {},
    hidePanel: () => {},
    applyOverlayVisibility: () => {},
    applyPetSize: () => {},
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    openExternal: async () => {},
    revealPath: () => {},
    petPortrait: () => undefined,
  };
  const tokens = new InMemoryTokenClient();
  const pets = new InMemoryPetClient();
  const collector = FixtureCollector.withEmptySnapshots();
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    tokens,
    pets,
    STUB_GROWTH_RULES,
    collector,
  );
  const map = metaHandlers(state, host);
  const collectNow = map['collect:now'];
  assert.ok(collectNow);
  /** 보상 대상 토큰을 그만큼 더 쓴 것으로 만들고 한 번 집계한다. */
  const earn = async (rewardTokens: number): Promise<TickReport> => {
    if (rewardTokens > 0) {
      collector.accumulate('claude_code', '2026-10-05', 'claude-opus-5', tokenCounts(rewardTokens));
    }
    return (await collectNow()) as TickReport;
  };
  return { state, tokens, pets, map, earn, broadcasts };
}

test('6.3: 미만에서 이상으로 넘어간 순간에만 알린다', () => {
  // 처음 본 상태는 "바뀐 순간"이 아니다. 앱을 켰을 때 이미 뽑을 수 있어도 알리지 않는다.
  assert.deepEqual(gachaReadyTransition(undefined, 150_000, DRAW_COST), {
    affordable: true,
    notify: false,
  });
  assert.deepEqual(gachaReadyTransition(undefined, 0, DRAW_COST), {
    affordable: false,
    notify: false,
  });
  // 정확히 비용만큼이면 뽑을 수 있다.
  assert.deepEqual(gachaReadyTransition(false, 100_000, DRAW_COST), {
    affordable: true,
    notify: true,
  });
  assert.deepEqual(gachaReadyTransition(false, 99_999, DRAW_COST), {
    affordable: false,
    notify: false,
  });
  // 이미 가능한 상태에서 더 쌓여도 다시 알리지 않는다.
  assert.deepEqual(gachaReadyTransition(true, 900_000, DRAW_COST), {
    affordable: true,
    notify: false,
  });
  assert.deepEqual(gachaReadyTransition(true, 10, DRAW_COST), { affordable: false, notify: false });
});

test('6.3: 사용량 보상으로 뽑기 비용을 넘기면 말풍선이 한 번 나온다', async () => {
  const { state, earn, broadcasts } = app();
  state.meta.settings.notifyGachaReady = true;

  await earn(0); // 첫 집계는 기준점만 잡는다. 잔액 0.
  const below = await earn(60_000);
  assert.equal(below.bubble, undefined, '아직 비용 미만이다');

  const crossed = await earn(60_000);
  assert.equal(crossed.bubble, READY);
  assert.deepEqual(
    broadcasts.at(-1),
    {
      channel: 'usage:aggregated',
      payload: { activityMinuteAdded: crossed.activityMinuteAdded, bubble: READY },
    },
    '말풍선은 펫 창이 받는 채널로도 나간다',
  );

  const still = await earn(60_000);
  assert.equal(still.bubble, undefined, '계속 가능한 동안은 다시 알리지 않는다');
});

test('6.3: 비용 미만으로 내려갔다가 다시 넘겨야 다시 알린다', async () => {
  const { state, tokens, earn } = app();
  state.meta.settings.notifyGachaReady = true;
  await earn(0);
  assert.equal((await earn(120_000)).bubble, READY);

  tokens.spend(100_000); // 뽑기 한 번. 잔액 20,000.
  assert.equal((await earn(30_000)).bubble, undefined, '50,000 — 아직 미만');
  assert.equal((await earn(50_000)).bubble, READY, '100,000 — 다시 넘겼다');
});

test('6.3: 알림이 꺼져 있거나 오버레이가 숨겨져 있으면 표시하지 않고 나중에 재생하지도 않는다', async () => {
  const off = app();
  await off.earn(0);
  assert.equal(off.state.meta.settings.notifyGachaReady, false, '초기값은 꺼짐이다');
  assert.equal((await off.earn(120_000)).bubble, undefined);
  off.state.meta.settings.notifyGachaReady = true;
  assert.equal((await off.earn(10_000)).bubble, undefined, '억제된 알림은 재생하지 않는다');

  const hidden = app();
  hidden.state.meta.settings.notifyGachaReady = true;
  hidden.state.meta.settings.overlayVisible = false;
  await hidden.earn(0);
  assert.equal((await hidden.earn(120_000)).bubble, undefined);
  hidden.state.meta.settings.overlayVisible = true;
  assert.equal((await hidden.earn(10_000)).bubble, undefined);
});

test('6.3: 업적 보상으로 비용을 넘기면 업적 말풍선에 뽑기 가능을 덧붙인다', async () => {
  const { state, pets, earn } = app();
  state.meta.settings.notifyGachaReady = true;
  await earn(0);

  pets.give('003'); // `첫 만남` — 보상 100,000 이 곧 뽑기 1회 값이다.
  const report = await earn(0);

  assert.deepEqual(report.newlyUnlocked, ['collection.first_pet']);
  assert.equal(report.bubble, `첫 만남 달성! 토큰 100,000 · ${READY}`);
});

test('6.3: 잔액을 읽지 못한 집계는 알리지 않고, 다음 집계가 이어서 판단한다', async () => {
  const { state, tokens, earn } = app();
  state.meta.settings.notifyGachaReady = true;
  await earn(0);

  tokens.setQueryFailure(true);
  assert.equal((await earn(120_000)).bubble, undefined);

  tokens.setQueryFailure(false);
  assert.equal((await earn(0)).bubble, READY, '읽지 못한 동안의 변화를 놓치지 않는다');
});

test('뽑은 횟수를 저장하는 곳이 아직 없어서 앱은 숫자를 지어내지 않는다', () => {
  const { map } = app();
  const summary = map['info:summary']?.() as SummaryScreen;

  // 0 은 "한 번도 뽑지 않았다"는 실제 값이다. 모르는 것은 null 이고 화면은 `—` 로 그린다.
  assert.equal(summary.drawCount.value, null);
  assert.equal(summary.drawCount.error, undefined, '조회 실패와도 다르다');
});
