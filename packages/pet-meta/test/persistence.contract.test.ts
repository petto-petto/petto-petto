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
  FixtureCollector,
  SCHEMA_VERSION,
  createMetaState,
  evaluate,
  factSnapshot,
  grantTitle,
  isUnlocked,
  loadState,
  needsFirstRunCollectTab,
  observedTotal,
  renameTrainer,
  runAggregation,
  saveState,
  setSourceEnabled,
  snapshotOf,
  stateOf,
  tokenCounts,
  type MetaState,
  type SourceRunResult,
} from '@pet/meta';
import { InMemoryCollection, InMemoryCurrency, InMemoryMetaStore } from '@pet/stubs';

const NOW = '2026-08-26T14:37:12+09:00';

class Session {
  state: MetaState = createMetaState(1);
  collector = FixtureCollector.withEmptySnapshots();
  currency = new InMemoryCurrency();
  clock = new FixedClock(NOW);

  constructor() {
    this.currency.setNow(this.clock.now());
  }

  run(): SourceRunResult[] {
    return runAggregation(this.state, this.collector, this.currency, this.clock).outcomes.map(
      (outcome) => outcome.result,
    );
  }

  /** 앱을 껐다 켠다. 저장한 뒤 **완전히 새 상태**를 저장된 것에서 되살린다. */
  restart(store: InMemoryMetaStore): void {
    saveState(store, this.state);
    const restored = loadState(store);
    assert.ok(restored, '저장된 상태가 있어야 한다');
    this.state = restored;
  }
}

const resultFor = (results: SourceRunResult[], provider: string): SourceRunResult => {
  const result = results[PROVIDERS.indexOf(provider as never)];
  assert.ok(result);
  return result;
};

test('기획서 8.2: 기준점이 재실행 후에도 살아 있다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();

  // 설치 전 기록이 잔뜩 있는 상태에서 첫 스캔 → 기준점만 잡는다.
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
    { kind: 'no_change' },
    '기준점이 살아 있어야 한다',
  );
  assert.equal(observedTotal(session.state), 0, '재실행이 설치 전 기록을 적립하면 안 된다');

  session.collector.accumulate('claude_code', '2026-08-26', 'claude-opus-5', tokenCounts(5_000));
  session.run();
  assert.equal(observedTotal(session.state), 5_000, '재실행 이후의 증가분만 잡힌다');
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

test('기획서 5.1: 조련사 이름과 칭호가 재실행 후에도 그대로다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  renameTrainer(session.state.profile, '졸린 수달');
  grantTitle(session.state.profile, '초보 조련사');

  session.restart(store);

  assert.equal(session.state.profile.displayName, '졸린 수달');
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
  const grants = session.currency.grantedKeyCount;

  session.restart(store);
  for (let index = 0; index < 3; index += 1) session.run();

  assert.equal(observedTotal(session.state), observed);
  assert.equal(session.currency.grantedKeyCount, grants);
});

test('기획서 9.4 / ACH-004: 업적 사실·진행률·보상이 재실행 후에도 유지된다', () => {
  const store = new InMemoryMetaStore();
  const session = new Session();
  const catalog = AchievementCatalog.embedded();
  const collection = new InMemoryCollection();

  session.state.eventFacts.battleWins = 37;
  const outcome = evaluate(session.state, catalog, session.currency, collection, session.clock);
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

  const grants = session.currency.grantedKeyCount;
  evaluate(session.state, catalog, session.currency, collection, session.clock);
  assert.equal(session.currency.grantedKeyCount, grants, '보상이 두 번 지급되지 않는다');
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
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);

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

test('알 수 없는 스키마 버전은 추측하지 않고 거절한다', () => {
  const session = new Session();
  session.run();
  const snapshot = snapshotOf(session.state);
  snapshot.schemaVersion = SCHEMA_VERSION + 99;

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
  });

  assert.ok(!json.includes('star_wizard'));
  assert.ok(!json.includes('별빛마법사'));
});
