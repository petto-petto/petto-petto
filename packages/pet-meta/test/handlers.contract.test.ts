/**
 * 앱에 끼우는 채널 맵의 계약.
 *
 * 채널 핸들러는 렌더러에서만 불려서 타입 검사가 호출부를 보지 못한다. 갈래 하나가 사라져도
 * 컴파일은 통과한다 — 실제로 `settings:notification` 의 `levelup` 갈래가 리팩터링 중에 지워졌는데
 * 어떤 테스트도 잡지 못했다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, type Provider } from '@pet/core';
import {
  CollectError,
  emptySnapshot,
  FixtureCollector,
  InMemoryCollection,
  InMemoryTokenClient,
  InMemoryMetaStore,
  InMemoryPetClient,
  MetaAppState,
  metaHandlers,
  type MetaHost,
  STUB_GROWTH_RULES,
  tokenCounts,
  type TickReport,
} from '@pet/meta';

/** 어떤 소스에 `refresh` 를 요청했는지 기록한다. 실제 수집기가 ccusage 를 돌리는 자리다. */
class RecordingCollector extends FixtureCollector {
  readonly refreshed: Provider[][] = [];

  override refresh(providers: readonly Provider[]): Promise<void> {
    this.refreshed.push([...providers]);
    return Promise.resolve();
  }
}

const noopHost: MetaHost = {
  showPanel: () => {},
  hidePanel: () => {},
  applyOverlayVisibility: () => {},
  applyPetSize: () => {},
  broadcast: () => {},
  openExternal: async () => {},
  revealPath: () => {},
  petPortrait: () => undefined,
};

function handlers() {
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryTokenClient(),
    new InMemoryPetClient(),
    STUB_GROWTH_RULES,
    FixtureCollector.withEmptySnapshots(),
  );
  return { state, map: metaHandlers(state, noopHost) };
}

test('SET: 알림 세 가지를 모두 끄고 켤 수 있다', () => {
  const { state, map } = handlers();
  const toggle = map['settings:notification'];
  assert.ok(toggle, 'settings:notification 채널이 있어야 한다');

  const cases = [
    ['levelup', () => state.meta.settings.notifyLevelup],
    ['achievement', () => state.meta.settings.notifyAchievement],
    ['gacha_ready', () => state.meta.settings.notifyGachaReady],
  ] as const;

  for (const [key, read] of cases) {
    toggle(key, false);
    assert.equal(read(), false, `${key} 를 끌 수 있어야 한다`);
    toggle(key, true);
    assert.equal(read(), true, `${key} 를 켤 수 있어야 한다`);
  }
});

test('INFO: 고른 펫이 없으면 초상화 채널은 오류 없이 비어 있다', () => {
  const { map } = handlers();
  const portrait = map['info:pet-portrait'];
  assert.ok(portrait);
  assert.equal(portrait(), undefined);
});

test('INFO: 활성 펫이 있으면 초상화 채널이 진화 단계를 넘긴다', () => {
  const pets = new InMemoryPetClient();
  const wizard = pets.give('006', { level: 21, evolutionStage: 1 });
  pets.setActivePet(wizard.ownedPetId);
  let received: unknown;
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryTokenClient(),
    pets,
    STUB_GROWTH_RULES,
    FixtureCollector.withEmptySnapshots(),
  );
  const map = metaHandlers(state, {
    ...noopHost,
    petPortrait: (pet) => {
      received = pet;
      return 'file:///portrait.png';
    },
  });

  assert.equal(map['info:pet-portrait']?.(), 'file:///portrait.png');
  // 레벨(21)로 단계를 추측하지 않고 저장된 진화 단계(1)를 그대로 넘긴다.
  assert.equal((received as { evolutionStage: number }).evolutionStage, 1);
  assert.equal((received as { speciesId: string }).speciesId, '006');
});

function collectHandlers() {
  const collector = new RecordingCollector();
  for (const provider of PROVIDERS) collector.setSnapshot(emptySnapshot(provider));
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryTokenClient(),
    new InMemoryPetClient(),
    STUB_GROWTH_RULES,
    collector,
  );
  return { state, collector, map: metaHandlers(state, noopHost) };
}

test('COLLECT-003: 갱신(collect:now)은 켜진 소스만 새로 읽은 뒤 집계한다', async () => {
  const { collector, map } = collectHandlers();
  const toggle = map['collect:toggle'];
  const now = map['collect:now'];
  assert.ok(toggle && now);

  await toggle('codex', false);
  collector.refreshed.length = 0;

  const report = (await now()) as TickReport;

  assert.deepEqual(collector.refreshed, [['claude_code', 'gemini_cli']]);
  assert.ok(report.sourceNotes.some((note) => note.startsWith('codex:')));
});

test('COLLECT-003: 갱신은 refresh 가 끝난 뒤의 스냅샷으로 증가분을 반영한다', async () => {
  const { state, collector, map } = collectHandlers();
  const now = map['collect:now'];
  assert.ok(now);

  await now(); // 첫 집계는 기준점만 잡는다(8.2).
  collector.accumulate('claude_code', '2026-09-27', 'claude-opus-5', tokenCounts(1_000));
  const report = (await now()) as TickReport;

  assert.ok(report.sourceNotes.includes('claude_code: 토큰 +1000'));
  assert.equal(state.meta.sources.get('claude_code')?.status, 'connected');
});

test('COLLECT-003: 카드 재스캔은 그 소스 하나만 새로 읽는다', async () => {
  const { collector, map } = collectHandlers();
  const rescan = map['collect:rescan'];
  assert.ok(rescan);

  await rescan('gemini_cli');

  assert.deepEqual(collector.refreshed, [['gemini_cli']]);
});

test('8.4: 꺼진 소스는 재스캔해도 새로 읽지 않는다', async () => {
  const { collector, map } = collectHandlers();
  const toggle = map['collect:toggle'];
  const rescan = map['collect:rescan'];
  assert.ok(toggle && rescan);

  await toggle('codex', false);
  collector.refreshed.length = 0;
  await rescan('codex');

  assert.deepEqual(collector.refreshed, [[]]);
});

test('데모 사용량 채널은 실제 수집기에서 오류로 거절한다', async () => {
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryTokenClient(),
    new InMemoryPetClient(),
    STUB_GROWTH_RULES,
    {
      collect: () => {
        throw new Error('쓰이면 안 된다');
      },
      refresh: () => Promise.resolve(),
    },
  );
  const demo = metaHandlers(state, noopHost)['demo:usage'];
  assert.ok(demo);

  await assert.rejects(async () => demo('claude_code'), /데모 수집기/);
});

/**
 * `refresh`가 게이트에서 멈추는 수집기. 새로 읽지 않은 소스를 `collect`하면 위반으로 적는다 —
 * 실제 수집기에서는 그것이 오래된 캐시를 기준점으로 삼는 일이다.
 */
class GatedCollector extends FixtureCollector {
  readonly refreshed: Provider[][] = [];
  readonly staleReads: Provider[] = [];
  readonly #fresh = new Set<Provider>();
  #gates: (() => void)[] = [];

  override async refresh(providers: readonly Provider[]): Promise<void> {
    this.refreshed.push([...providers]);
    await new Promise<void>((resolve) => this.#gates.push(resolve));
    for (const provider of providers) this.#fresh.add(provider);
  }

  override collect(provider: Provider) {
    if (!this.#fresh.has(provider)) this.staleReads.push(provider);
    return super.collect(provider);
  }

  release(): void {
    const gates = this.#gates;
    this.#gates = [];
    for (const open of gates) open();
  }

  /** 가장 먼저 기다리기 시작한 `refresh` 하나만 끝낸다. */
  releaseFirst(): void {
    this.#gates.shift()?.();
  }
}

function gatedHandlers() {
  const collector = new GatedCollector();
  for (const provider of PROVIDERS) collector.setSnapshot(emptySnapshot(provider));
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryTokenClient(),
    new InMemoryPetClient(),
    STUB_GROWTH_RULES,
    collector,
  );
  return { state, collector, map: metaHandlers(state, noopHost) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('8.4: 집계가 수집기를 기다리는 동안 켠 소스는 새로 읽기 전의 값을 기준점으로 삼지 않는다', async () => {
  const { state, collector, map } = gatedHandlers();
  const toggle = map['collect:toggle'];
  const now = map['collect:now'];
  assert.ok(toggle && now);

  const off = toggle('codex', false);
  collector.release();
  await off;

  const tick = now(); // claude·gemini 만 새로 읽는 중
  await settle();
  const on = toggle('codex', true); // 그 사이에 codex 를 켠다
  await settle();
  collector.releaseFirst(); // 주기 집계가 먼저 끝난다. codex 는 아직 읽는 중이다.
  await tick;
  collector.release();
  await on;

  assert.deepEqual(collector.staleReads, []);
  assert.equal(state.meta.sources.get('codex')?.status, 'connected');
});

test('8.4: 소스를 끌 때는 수집기를 실행하지 않는다', async () => {
  const { collector, map } = gatedHandlers();
  const toggle = map['collect:toggle'];
  assert.ok(toggle);

  const off = toggle('codex', false);
  await settle();
  collector.release();
  await off;

  assert.deepEqual(collector.refreshed, [[]]);
});

test('갱신: 수집 실패는 보고서의 failures 로 알리고, 기록 없음(not_found)은 실패가 아니다', async () => {
  const { collector, map } = collectHandlers();
  const now = map['collect:now'];
  assert.ok(now);
  collector.setError('codex', new CollectError('execution_failed'));
  collector.setError('gemini_cli', new CollectError('not_found'));

  const report = (await now()) as TickReport;

  assert.deepEqual(report.failures, ['Codex: 집계 오류']);
});

test('종료: idle() 은 진행 중인 집계가 끝나야 풀린다 — 그 전에 저장소를 닫지 않게 한다', async () => {
  const { state, collector } = gatedHandlers();

  const tick = state.aggregate();
  let idle = false;
  const waiting = state.idle().then(() => {
    idle = true;
  });
  await settle();
  assert.equal(idle, false, '집계가 수집기를 기다리는 중에는 idle 이 아니다');

  collector.release();
  await tick;
  await waiting;
  assert.equal(idle, true);
});

test('ACH: 보상 받기 채널이 그 업적의 보상을 지급하고 화면에 알린다', async () => {
  const pets = new InMemoryPetClient();
  const tokens = new InMemoryTokenClient();
  const store = new InMemoryMetaStore();
  const broadcasts: string[] = [];
  const state = new MetaAppState(
    store,
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    tokens,
    pets,
    STUB_GROWTH_RULES,
    FixtureCollector.withEmptySnapshots(),
  );
  const map = metaHandlers(state, {
    ...noopHost,
    broadcast: (channel) => broadcasts.push(channel),
  });
  const claim = map['achievements:claim'];
  assert.ok(claim, 'achievements:claim 채널이 있어야 한다');

  pets.give('003');
  await state.aggregate();
  assert.equal(tokens.balance(), 0, '달성만으로는 지급되지 않는다');

  assert.deepEqual(claim('collection.first_pet'), { claimed: true, error: undefined });
  assert.equal(tokens.balance(), 100_000);
  assert.equal(state.meta.profile.equippedTitle, '초보 조련사');
  assert.ok(broadcasts.includes('usage:aggregated'), '열려 있는 화면이 잔액을 다시 그린다');
  assert.equal(
    store.load()?.rewards.every((record) => record.status === 'done'),
    true,
    '받은 기록이 저장된다',
  );

  // 렌더러가 보낸 값은 믿지 않는다.
  assert.throws(() => claim(undefined), /업적/);
  assert.deepEqual(claim('battle.win_50'), {
    claimed: false,
    error: '아직 달성하지 않은 업적이에요',
  });
});

test('앱을 다시 켜면 꺼져 있던 동안의 사용은 적립하지 않는다', async () => {
  // 같은 저장소와 같은 도구 기록을 두 번의 앱 실행이 이어서 본다.
  const store = new InMemoryMetaStore();
  const tokens = new InMemoryTokenClient();
  const collector = FixtureCollector.withEmptySnapshots();
  const launch = () =>
    new MetaAppState(
      store,
      '~/Library/…',
      '0.1.0',
      new InMemoryCollection(),
      tokens,
      new InMemoryPetClient(),
      STUB_GROWTH_RULES,
      collector,
    );

  const first = launch();
  await first.aggregate();
  collector.accumulate('claude_code', '2026-09-27', 'claude-opus-5', tokenCounts(50_000));
  await first.aggregate();
  first.persist();
  assert.equal(tokens.balance(), 50_000);

  // 앱을 끈 사이에 80,000 을 썼다.
  collector.accumulate('claude_code', '2026-09-28', 'claude-opus-5', tokenCounts(80_000));

  const second = launch();
  assert.equal(second.isFreshInstall, false);
  await second.aggregate();
  assert.equal(tokens.balance(), 50_000, '앱 시작 집계는 기준점만 잡는다');
  assert.equal(tokens.entries.length, 1);

  collector.accumulate('claude_code', '2026-09-28', 'claude-opus-5', tokenCounts(20_000));
  await second.aggregate();
  assert.equal(tokens.balance(), 70_000, '켜진 뒤에 쓴 것만 쌓인다');
});

test('데모 시드는 실제 수집기에서 아무것도 하지 않고 그 사실을 알린다', () => {
  const store = () => new InMemoryMetaStore();
  const make = (collector: ConstructorParameters<typeof MetaAppState>[7]) =>
    new MetaAppState(
      store(),
      '~/Library/…',
      '0.1.0',
      new InMemoryCollection(),
      new InMemoryTokenClient(),
      new InMemoryPetClient(),
      STUB_GROWTH_RULES,
      collector,
    );

  const real = make({
    collect: () => emptySnapshot('claude_code'),
    refresh: () => Promise.resolve(),
  });
  assert.equal(real.seedDemoUsage(), false, '실제 수집기에는 심지 않는다');
  assert.equal(make(FixtureCollector.withEmptySnapshots()).seedDemoUsage(), true, '데모 모드');
});
