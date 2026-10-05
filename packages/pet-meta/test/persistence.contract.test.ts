/**
 * 로컬 저장 계약. 기획서가 "재실행 후에도 유지"를 요구하는 항목들의 실행 증거다.
 *
 * 각 테스트는 **앱을 껐다 켜는 것**을 흉내낸다 — 상태를 저장하고, 완전히 새로운
 * `MetaState`를 저장된 것에서 만들어 내고, 그 위에서 규칙이 여전히 성립하는지 본다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, PROVIDERS, petId } from '@pet/core';
import {
  AchievementCatalog,
  beginSession,
  createMetaState,
  evaluate,
  factSnapshot,
  FixtureCollector,
  grantTitle,
  InMemoryCollection,
  InMemoryTokenClient,
  InMemoryMetaStore,
  InMemoryPetClient,
  isUnlocked,
  loadState,
  type MetaState,
  needsFirstRunCollectTab,
  observedTotal,
  runAggregation,
  saveState,
  setSourceEnabled,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotOf,
  type SourceRunResult,
  stateOf,
  tokenCounts,
  STUB_GROWTH_RULES,
} from '@pet/meta';

const NOW = '2026-08-26T14:37:12+09:00';

class Session {
  state: MetaState = createMetaState();
  collector = FixtureCollector.withEmptySnapshots();
  tokens = new InMemoryTokenClient();
  clock = new FixedClock(NOW);

  constructor() {
    this.tokens.setNow(this.clock.now());
  }

  run(): SourceRunResult[] {
    return runAggregation(this.state, this.collector, this.tokens, this.clock).outcomes.map(
      (outcome) => outcome.result,
    );
  }

  /**
   * 앱을 껐다 켠다. 저장한 뒤 **완전히 새 상태**를 저장된 것에서 되살리고, 앱이 켜질 때 하는
   * 것처럼 새 실행을 시작한다.
   */
  restart(store: InMemoryMetaStore): void {
    saveState(store, this.state);
    const restored = loadState(store);
    assert.ok(restored, '저장된 상태가 있어야 한다');
    this.state = restored;
    beginSession(this.state);
  }
}

const resultFor = (results: SourceRunResult[], provider: string): SourceRunResult => {
  const result = results[PROVIDERS.indexOf(provider as never)];
  assert.ok(result);
  return result;
};

test('앱을 켤 때마다 기준점을 새로 잡는다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();

  // 앱을 처음 켜기 전의 기록이 잔뜩 있는 상태에서 첫 스캔 → 기준점만 잡는다.
  session.collector.accumulate(
    'claude_code',
    '2026-05-01',
    'claude-opus-5',
    tokenCounts(9_000_000),
  );
  session.run();
  assert.equal(observedTotal(session.state), 0);

  session.restart(store);

  const results = session.run();
  assert.deepEqual(
    resultFor(results, 'claude_code'),
    { kind: 'baseline_captured' },
    '이번 실행의 첫 스캔이 새 기준점이다',
  );
  assert.equal(observedTotal(session.state), 0, '재실행이 예전 기록을 적립하면 안 된다');

  session.collector.accumulate('claude_code', '2026-08-26', 'claude-opus-5', tokenCounts(5_000));
  session.run();
  assert.equal(observedTotal(session.state), 5_000, '앱이 켜진 동안의 증가분만 잡힌다');
});

test('앱이 꺼져 있던 동안의 사용은 통계에도 재화에도 토큰 표에도 쌓이지 않는다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  session.run();
  session.collector.accumulate('claude_code', '2026-08-26', 'claude-opus-5', tokenCounts(5_000));
  session.run();
  assert.equal(session.tokens.balance(), 5_000);

  // 앱을 끈 사이에 80,000 을 썼다. 그 뒤에 앱을 다시 켠다.
  saveState(store, session.state);
  session.collector.accumulate('claude_code', '2026-08-27', 'claude-opus-5', tokenCounts(80_000));
  session.restart(store);
  session.run();

  assert.equal(observedTotal(session.state), 5_000, '꺼져 있던 동안의 사용은 통계에 없다');
  assert.equal(session.tokens.balance(), 5_000, '재화로도 지급하지 않는다');
  assert.equal(session.tokens.entries.length, 1, '공용 토큰 표에도 적재하지 않는다');
  assert.equal(session.state.activityMinutes.size, 1, '함께한 시간도 늘지 않는다');

  // 다시 켠 뒤에 쓴 것은 쌓인다.
  session.collector.accumulate('claude_code', '2026-08-27', 'claude-opus-5', tokenCounts(2_000));
  session.run();

  assert.equal(observedTotal(session.state), 7_000);
  assert.equal(session.tokens.balance(), 7_000);
  assert.equal(session.tokens.entries.length, 2);
});

test('새 실행을 시작해도 꺼 둔 소스와 지난 기록은 그대로다', () => {
  const session = new Session();
  session.run();
  session.collector.accumulate('codex', '2026-08-26', 'gpt-5.4-codex', tokenCounts(3_000));
  session.run();
  setSourceEnabled(session.state, session.clock, 'gemini_cli', false);

  beginSession(session.state);

  const codex = session.state.sources.get('codex');
  assert.equal(codex?.baseline, undefined);
  assert.equal(codex?.status, 'scanning', '첫 스캔 전까지는 확인 중이다');
  assert.equal(codex?.everConnected, true, '최초 실행으로 되돌아가지 않는다');
  const gemini = session.state.sources.get('gemini_cli');
  assert.equal(gemini?.enabled, false);
  assert.equal(gemini?.status, 'paused');
  assert.equal(observedTotal(session.state), 3_000, '이미 쌓은 통계는 건드리지 않는다');
});

test('기획서 4.3: 재실행은 최초 실행이 아니다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  assert.equal(needsFirstRunCollectTab(session.state), true);

  session.run();
  assert.equal(needsFirstRunCollectTab(session.state), false);

  session.restart(store);
  assert.equal(
    needsFirstRunCollectTab(session.state),
    false,
    '재실행에서 수집 탭이 다시 자동으로 열리면 안 된다',
  );
});

test('기획서 5.1: 칭호가 재실행 후에도 그대로다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  grantTitle(session.state.profile, '초보 조련사');

  session.restart(store);

  assert.equal(session.state.profile.equippedTitle, '초보 조련사');
  assert.equal(session.state.profile.ownedTitles.length, 1);
});

test('SET-007: 오버레이 숨김 상태가 재실행 후 유지된다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  session.state.settings.overlayVisible = false;
  session.state.settings.petSize = 'large';
  session.state.settings.notifyGachaReady = true;

  session.restart(store);

  assert.equal(session.state.settings.overlayVisible, false);
  assert.equal(session.state.settings.petSize, 'large');
  assert.equal(session.state.settings.notifyGachaReady, true);
});

test('기획서 8.3: 멱등 키가 재실행 후에도 살아 있다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  session.run();

  session.collector.accumulate('claude_code', '2026-08-26', 'claude-opus-5', tokenCounts(1_000));
  session.run();
  const observed = observedTotal(session.state);
  const grants = session.tokens.grantedKeyCount;

  session.restart(store);
  for (let index = 0; index < 3; index += 1) session.run();

  assert.equal(observedTotal(session.state), observed);
  assert.equal(session.tokens.grantedKeyCount, grants);
});

test('기획서 9.4 / ACH-004: 업적 사실·진행률·보상이 재실행 후에도 유지된다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  const catalog = AchievementCatalog.embedded();
  const collection = new InMemoryCollection();
  const pets = new InMemoryPetClient();
  const judge = () =>
    evaluate(
      session.state,
      catalog,
      session.tokens,
      collection,
      pets,
      STUB_GROWTH_RULES,
      session.clock,
    );

  session.state.eventFacts.battleWins = 37;
  const outcome = judge();
  assert.ok(outcome.newlyUnlocked.includes('battle.first_win'));

  session.restart(store);

  assert.equal(factSnapshot(session.state).battle_wins, 37);
  const firstWin = session.state.progress.get('battle.first_win');
  assert.ok(firstWin && isUnlocked(firstWin), '해제 상태가 유지되어야 한다');
  assert.equal(
    session.state.progress.get('battle.win_50')?.progress,
    37,
    '진행률도 유지되어야 한다',
  );

  const grants = session.tokens.grantedKeyCount;
  judge();
  assert.equal(session.tokens.grantedKeyCount, grants, '보상이 두 번 지급되지 않는다');
});

test('기획서 8.4: 껐던 소스가 재실행으로 저절로 켜지지 않는다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  session.run();
  setSourceEnabled(session.state, session.clock, 'codex', false);

  session.restart(store);

  const codex = session.state.sources.get('codex');
  assert.equal(codex?.enabled, false);
  assert.ok(codex?.disabledAt);
  assert.deepEqual(resultFor(session.run(), 'codex'), { kind: 'skipped' });
});

test('스냅샷이 JSON을 왕복해도 내용이 같다', () => {
  // 런타임 자료구조는 Map과 Set이라 JSON.stringify가 `{}`를 준다.
  // 스냅샷 형식이 그 문제를 없앴는지 실제 JSON을 거쳐 확인한다.
  const session = new Session();
  session.run();
  session.collector.accumulate('gemini_cli', '2026-08-26', 'gemini-3-pro', tokenCounts(2_500));
  session.run();

  const snapshot = snapshotOf(session.state);
  const parsed = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

  assert.deepEqual(parsed, snapshot, 'JSON을 거쳐도 내용이 같아야 한다');
  assert.equal(parsed.schemaVersion, SNAPSHOT_SCHEMA_VERSION);

  const restored = stateOf(parsed);
  assert.equal(observedTotal(restored), observedTotal(session.state));
  assert.deepEqual([...restored.usageDaily], [...session.state.usageDaily]);
  assert.deepEqual([...restored.processedDeltas], [...session.state.processedDeltas]);
  assert.deepEqual([...restored.activityMinutes], [...session.state.activityMinutes]);
});

test('Map을 그대로 직렬화하면 내용이 사라진다는 것을 고정한다', () => {
  // 스냅샷 계층이 왜 필요한지에 대한 증거. 이 성질이 바뀌면 계층을 다시 검토해야 한다.
  const naive = JSON.parse(JSON.stringify({ rows: new Map([['a', 1]]), seen: new Set(['b']) }));
  assert.deepEqual(naive, { rows: {}, seen: {} }, 'Map과 Set은 JSON에 실리지 않는다');
});

test('INFO-002: 프로필은 사용자 이름을 만들지도 저장하지도 않는다', () => {
  const session = new Session();
  session.run();

  assert.deepEqual(Object.keys(session.state.profile).sort(), ['equippedTitle', 'ownedTitles']);
  assert.equal('displayName' in snapshotOf(session.state).profile, false);
});

test('조련사 이름을 담고 있던 v1 저장 파일도 그대로 열린다', () => {
  const session = new Session();
  session.run();
  grantTitle(session.state.profile, '초보 조련사');
  session.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokenCounts(9_000));
  session.run();

  // 이름을 쓰던 시절의 파일을 그대로 재현한다.
  const legacy = JSON.parse(JSON.stringify(snapshotOf(session.state)));
  legacy.schemaVersion = 1;
  legacy.profile.displayName = '졸린 수달';

  const restored = loadState(InMemoryMetaStore.withSnapshot(legacy));

  assert.ok(restored, '옛 파일을 버리지 않는다');
  assert.equal(restored.profile.equippedTitle, '초보 조련사');
  assert.equal(observedTotal(restored), 9_000);
  // 읽지 않는 키라 상태에 살아남지 않는다.
  assert.equal('displayName' in restored.profile, false);
});

test('코인 보상을 담고 있던 v2 저장 파일은 토큰 보상으로 열린다', () => {
  const session = new Session();
  session.run();
  session.state.rewards.set('collection.first_pet', [
    {
      achievementId: 'collection.first_pet',
      rewardKey: 'achievement:collection.first_pet',
      kind: 'token',
      status: 'done',
      attempts: 1,
      lastError: undefined,
      detail: '토큰 10',
    },
  ]);

  // 재화를 코인이라 부르고 도감 칸 수·옛 합성 사실을 저장하던 시절의 파일을 재현한다.
  const legacy = JSON.parse(JSON.stringify(snapshotOf(session.state)));
  legacy.schemaVersion = 2;
  legacy.rewards[0].kind = 'coin';
  legacy.rewards[0].detail = '코인 10';
  legacy.eventFacts.dexTotal = 20;
  legacy.eventFacts.commonFusionEpic = 1;
  legacy.eventFacts.fusionCount = 3;
  delete legacy.eventFacts.fusionEpic;

  const restored = loadState(InMemoryMetaStore.withSnapshot(legacy));

  assert.ok(restored);
  const reward = restored.rewards.get('collection.first_pet')?.[0];
  assert.equal(reward?.kind, 'token');
  assert.equal(reward?.detail, '토큰 10');
  assert.equal(restored.eventFacts.fusionCount, 3, '아는 사실은 그대로 가져온다');
  assert.equal(restored.eventFacts.fusionEpic, 0, '새 사실은 0에서 시작한다');
  assert.deepEqual(
    Object.keys(restored.eventFacts).sort(),
    Object.keys(createMetaState().eventFacts).sort(),
    '지금 코드가 모르는 사실은 상태에 남지 않는다',
  );
});

test('알 수 없는 스키마 버전은 추측하지 않고 거절한다', () => {
  const session = new Session();
  session.run();
  const snapshot = snapshotOf(session.state);
  snapshot.schemaVersion = SNAPSHOT_SCHEMA_VERSION + 99;

  const store = InMemoryMetaStore.withSnapshot(snapshot);
  assert.throws(() => loadState(store), /지원하지 않는 저장 형식/);
});

test('저장 실패가 메모리 상태를 망가뜨리지 않는다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  session.run();
  session.collector.accumulate('claude_code', '2026-08-26', 'claude-opus-5', tokenCounts(700));
  session.run();

  store.setSaveFailure(true);
  assert.throws(() => saveState(store, session.state));
  assert.equal(observedTotal(session.state), 700, '메모리 상태는 그대로다');
  assert.equal(store.saved, undefined, '실패한 저장이 파일을 건드리면 안 된다');

  store.setSaveFailure(false);
  saveState(store, session.state);
  assert.ok(store.saved);
});

test('저장 파일이 없는 것은 오류가 아니라 새 설치다', () => {
  assert.equal(loadState(new InMemoryMetaStore()), undefined);
});

test('오버레이 펫은 meta가 저장하지 않는다', () => {
  // 오버레이 펫은 collection 도메인이 소유한다. meta가 저장하면 두 곳이 어긋난다.
  const session = new Session();
  session.run();
  const json = JSON.stringify(snapshotOf(session.state));

  const collection = new InMemoryCollection();
  collection.setOverlayPet({
    petId: petId('006'),
    name: '별빛마법사',
    level: 21,
    rarity: 'EPIC',
    sprite: 'star_wizard',
    stage: 3,
  });

  assert.ok(!json.includes('star_wizard'));
  assert.ok(!json.includes('별빛마법사'));
});
