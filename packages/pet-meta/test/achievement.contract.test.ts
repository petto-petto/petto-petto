/** 기획서 12장 `업적과 알림` 인수 조건(ACH-001 ~ ACH-009)의 실행 증거. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, domainEvent, eventId, petId, type EventPayload, type Rarity } from '@pet/core';
import {
  AchievementCatalog,
  FixtureCollector,
  MASK,
  achievementScreen,
  bubbleMessage,
  createMetaState,
  evaluate,
  factSnapshot,
  isUnlocked,
  observedTotal,
  recordEvent,
  runAggregation,
  settleRewards,
  tokenCounts,
  type AchievementDefinition,
  type EvaluationOutcome,
  type MetaState,
} from '@pet/meta';
import { InMemoryCollection, InMemoryCurrency } from '@pet/stubs';

const NOW = '2026-08-24T14:37:12+09:00';

class Harness {
  state: MetaState = createMetaState(1);
  catalog = AchievementCatalog.embedded();
  currency = new InMemoryCurrency();
  collection = new InMemoryCollection();
  clock = new FixedClock(NOW);

  constructor() {
    this.currency.setNow(this.clock.now());
  }

  send(id: string, payload: EventPayload): void {
    recordEvent(this.state, domainEvent(eventId(id), this.clock.now(), payload));
  }

  evaluate(): EvaluationOutcome {
    return evaluate(this.state, this.catalog, this.currency, this.collection, this.clock);
  }

  isUnlocked(id: string): boolean {
    const entry = this.state.progress.get(id);
    return entry !== undefined && isUnlocked(entry);
  }
}

const acquired = (pet: string, rarity: Rarity): EventPayload => ({
  eventType: 'pet.acquired',
  petId: petId(pet),
  rarity,
  source: 'gacha',
});

const wonBattle = (streak: number): EventPayload => ({
  eventType: 'battle.finished',
  battleId: `battle-${streak}`,
  result: 'win',
  enemyTier: 1,
  streak,
});

test('ACH-001: 22개 ID와 보상이 기획서 7.2와 일치한다', () => {
  const catalog = AchievementCatalog.embedded();
  assert.equal(catalog.size, 22);

  const expected = [
    'collection.first_pet',
    'collection.dex_5',
    'collection.dex_15',
    'collection.dex_complete',
    'collection.first_epic',
    'collection.fusion_5',
    'collection.fusion_50',
    'growth.level_5',
    'growth.level_10',
    'growth.level_20',
    'growth.max_level',
    'growth.first_evolution',
    'battle.first_win',
    'battle.win_50',
    'battle.win_500',
    'battle.streak_10',
    'usage.tokens_1m',
    'usage.tokens_10m',
    'usage.tokens_100m',
    'usage.active_24h',
    'hidden.three_tools_day',
    'hidden.common_fusion_epic',
  ];
  for (const id of expected) assert.ok(catalog.get(id), `${id} 정의가 없다`);

  const firstPet = catalog.get('collection.first_pet');
  assert.equal(firstPet?.coin, 10);
  assert.equal(firstPet?.title, '초보 조련사');
  assert.equal(firstPet?.trophy, true);

  const win500 = catalog.get('battle.win_500');
  assert.equal(win500?.coin, 300);
  assert.equal(win500?.tier, 'gold');

  const tokens100m = catalog.get('usage.tokens_100m');
  assert.equal(tokens100m?.target, 100_000_000);
  assert.notEqual(tokens100m?.trophy, true, '토큰 마일스톤 Ⅲ에는 트로피가 없다');

  const hidden = catalog.definitions.filter((d) => d.hidden === true).map((d) => d.id);
  assert.deepEqual(hidden, ['hidden.three_tools_day', 'hidden.common_fusion_epic']);
});

test('ACH-001: 알 수 없는 사실 키를 참조하는 정의는 거부된다', () => {
  assert.throws(
    () =>
      AchievementCatalog.fromDefinitions([
        {
          id: 'test.bogus',
          category: 'usage',
          name: '테스트',
          condition: '테스트',
          fact: '존재하지_않는_사실',
          target: 1,
          coin: 0,
        } as AchievementDefinition,
      ]),
    /알 수 없는 사실 키/,
  );
});

test('ACH-002: 잠긴 히든 업적이 아무것도 노출하지 않는다', () => {
  const harness = new Harness();
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const hidden = screen.rows.find((row) => row.id === 'hidden.three_tools_day');
  assert.ok(hidden);
  assert.equal(hidden.name, MASK);
  assert.equal(hidden.condition, MASK);
  assert.equal(hidden.progressLabel, MASK);
  assert.deepEqual(hidden.rewards, [MASK]);
  assert.equal(hidden.target, 0, '목표값도 노출하지 않는다');
  assert.equal(hidden.tier, undefined);
  assert.equal(hidden.masked, true);

  // 실제 이름과 보상 문자열이 응답 어디에도 실려 나가지 않아야 한다.
  const json = JSON.stringify(screen);
  assert.ok(!json.includes('세 도구의 조련사'));
  assert.ok(!json.includes('기적의 연금술사'));

  const normal = screen.rows.find((row) => row.id === 'battle.win_50');
  assert.equal(normal?.name, '백전노장 Ⅰ');
  assert.equal(normal?.progressLabel, '0 / 50');
  assert.equal(normal?.masked, false);
});

test('ACH-002: 달성한 히든 업적은 실제 값을 공개한다', () => {
  const harness = new Harness();
  harness.send('fusion-1', {
    eventType: 'fusion.completed',
    fusionId: 'f-1',
    parentRarities: ['COMMON', 'COMMON'],
    resultPetId: petId('pet-epic'),
    resultRarity: 'EPIC',
  });
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const hidden = screen.rows.find((row) => row.id === 'hidden.common_fusion_epic');
  assert.equal(hidden?.name, '연금술의 기적');
  assert.equal(hidden?.unlocked, true);
  assert.equal(hidden?.masked, false);
  assert.ok(hidden?.rewards.some((reward) => reward.includes('기적의 연금술사')));
});

test('ACH-003: 같은 이벤트와 같은 업적을 반복해도 해제와 보상이 한 번뿐이다', () => {
  const harness = new Harness();

  for (let index = 0; index < 5; index += 1) {
    harness.send('pet-acquired-1', acquired('pet-001', 'COMMON'));
  }
  assert.equal(harness.state.processedEvents.size, 1, '같은 eventId는 한 번만 반영된다');

  const first = harness.evaluate();
  assert.ok(first.newlyUnlocked.includes('collection.first_pet'));

  for (let index = 0; index < 4; index += 1) {
    assert.deepEqual(
      harness.evaluate().newlyUnlocked,
      [],
      '이미 해제된 업적이 다시 해제되면 안 된다',
    );
  }

  assert.equal(harness.currency.grantedAmount('achievement:collection.first_pet'), 10);
  assert.equal(harness.currency.grantedKeyCount, 1);
  assert.equal(harness.collection.trophies.length, 1, '트로피도 한 번만 지급된다');
  assert.deepEqual(harness.state.profile.ownedTitles, ['초보 조련사']);
});

test('ACH-004: 새로 추가한 정의가 기존 사실로 소급 판정된다', () => {
  const harness = new Harness();

  for (let index = 1; index <= 37; index += 1) {
    harness.send(`battle-${index}`, wonBattle(index));
  }
  harness.evaluate();
  assert.ok(harness.isUnlocked('battle.first_win'));
  assert.ok(!harness.isUnlocked('battle.win_50'));

  // 앱 업데이트로 "전투 30승" 업적이 새로 추가됐다고 하자.
  harness.catalog = AchievementCatalog.fromDefinitions([
    ...AchievementCatalog.embedded().definitions,
    {
      id: 'battle.win_30',
      category: 'battle',
      name: '삼십 고개',
      condition: '전투 30승',
      fact: 'battle_wins',
      target: 30,
      tier: 'bronze',
      coin: 55,
    },
  ]);

  // 과거 이벤트를 다시 재생하지 않고, 같은 판정 함수를 한 번 부르면 끝이다.
  const outcome = harness.evaluate();

  assert.deepEqual(outcome.newlyUnlocked, ['battle.win_30']);
  assert.equal(
    harness.currency.grantedAmount('achievement:battle.win_30'),
    55,
    '소급 판정도 일반 달성과 동일하게 보상을 한 번 지급한다',
  );

  // 완료율의 분모가 늘어난 정의 수를 따라간다(기획서 7.1).
  assert.equal(achievementScreen(harness.state, harness.catalog, undefined).total, 23);
});

test('ACH-005: 첫 칭호만 자동 장착된다', () => {
  const harness = new Harness();

  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  harness.evaluate();
  assert.equal(harness.state.profile.equippedTitle, '초보 조련사');

  harness.send('pet-2', acquired('pet-002', 'EPIC'));
  harness.evaluate();
  assert.ok(harness.isUnlocked('collection.first_epic'));
  assert.equal(
    harness.state.profile.equippedTitle,
    '초보 조련사',
    '두 번째 칭호가 장착값을 덮어쓰면 안 된다',
  );
  assert.equal(harness.state.profile.ownedTitles.length, 2);
});

test('ACH-006: 첫 만남 트로피만 자동 배치된다', () => {
  const harness = new Harness();
  harness.collection.setRoomSlots(5);

  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  harness.send('dex-1', { eventType: 'dex.updated', ownedSpecies: 24, totalSpecies: 24 });
  harness.evaluate();

  const trophies = harness.collection.trophies;
  assert.equal(trophies.find((t) => t.achievementId === 'collection.first_pet')?.placement, 'room');
  assert.equal(
    trophies.find((t) => t.achievementId === 'collection.dex_complete')?.placement,
    'storage',
    '나머지 트로피는 보관함으로 간다',
  );
});

test('ACH-006: 자동 배치 실패가 트로피 지급 실패로 이어지지 않는다', () => {
  const harness = new Harness();
  harness.collection.setRoomSlots(0);

  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  harness.evaluate();

  assert.equal(harness.collection.trophies.length, 1);
  assert.equal(harness.collection.trophies[0]?.placement, 'storage');
  assert.ok(harness.isUnlocked('collection.first_pet'));
});

test('ACH-007: 한 개는 상세 말풍선, 여러 개는 집계 말풍선', () => {
  const harness = new Harness();

  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  const single = harness.evaluate();
  const message = bubbleMessage(single, harness.catalog);
  assert.ok(message?.includes('첫 만남'));
  assert.ok(message?.includes('코인 10'));

  for (let index = 1; index <= 50; index += 1) {
    harness.send(`battle-${index}`, wonBattle(index));
  }
  const many = harness.evaluate();
  assert.ok(many.newlyUnlocked.length >= 2);
  assert.equal(
    bubbleMessage(many, harness.catalog),
    `${many.newlyUnlocked.length}개 업적을 달성했어!`,
  );
});

test('ACH-009: 보상 실패가 미완료로 남고 같은 멱등 키로 재시도된다', () => {
  const harness = new Harness();
  harness.currency.failNextGrant();

  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  const outcome = harness.evaluate();

  assert.ok(harness.isUnlocked('collection.first_pet'), '해제는 됐다');
  assert.deepEqual(outcome.pendingRewards, ['collection.first_pet']);
  assert.equal(harness.currency.grantedKeyCount, 0);

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const row = screen.rows.find((r) => r.id === 'collection.first_pet');
  assert.equal(row?.unlocked, true);
  assert.equal(row?.rewardPending, true);

  const pending = settleRewards(
    harness.state,
    harness.catalog,
    harness.currency,
    harness.collection,
  );
  assert.deepEqual(pending, []);
  assert.equal(harness.currency.grantedAmount('achievement:collection.first_pet'), 10);

  settleRewards(harness.state, harness.catalog, harness.currency, harness.collection);
  assert.equal(harness.currency.grantedKeyCount, 1, '다시 정산해도 중복 지급되지 않는다');
});

test('사용량 업적이 수집 파이프라인 결과로 판정된다', () => {
  const harness = new Harness();
  const collector = FixtureCollector.withEmptySnapshots();
  runAggregation(harness.state, collector, harness.currency, harness.clock);

  for (const [provider, model] of [
    ['claude_code', 'claude-opus-5'],
    ['codex', 'gpt-5.4-codex'],
    ['gemini_cli', 'gemini-3-pro'],
  ] as const) {
    collector.accumulate(
      provider,
      '2026-08-24',
      model,
      tokenCounts(200_000, 100_000, 50_000, 50_000),
    );
  }
  runAggregation(harness.state, collector, harness.currency, harness.clock);

  assert.equal(observedTotal(harness.state), 1_200_000);

  const outcome = harness.evaluate();
  assert.ok(outcome.newlyUnlocked.includes('usage.tokens_1m'));
  assert.ok(
    outcome.newlyUnlocked.includes('hidden.three_tools_day'),
    '세 도구의 조련사가 달성되어야 한다',
  );
});

test('진행률은 소스가 rebase돼도 감소하지 않는다', () => {
  const harness = new Harness();
  const collector = FixtureCollector.withEmptySnapshots();
  runAggregation(harness.state, collector, harness.currency, harness.clock);

  collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokenCounts(300_000, 200_000));
  runAggregation(harness.state, collector, harness.currency, harness.clock);
  harness.evaluate();
  const before = harness.state.progress.get('usage.tokens_1m')?.progress;
  assert.equal(before, 500_000);

  collector.setSnapshot({ provider: 'claude_code', rows: new Map() });
  runAggregation(harness.state, collector, harness.currency, harness.clock);
  harness.evaluate();

  assert.equal(harness.state.progress.get('usage.tokens_1m')?.progress, before);
});

test('카테고리 필터는 그 카테고리만 고르고 완료율 분모는 전체다', () => {
  const harness = new Harness();
  harness.evaluate();
  const screen = achievementScreen(harness.state, harness.catalog, 'battle');
  assert.equal(screen.rows.length, 4);
  assert.ok(screen.rows.every((row) => row.category === 'battle'));
  assert.equal(screen.total, 22, '완료율 분모는 필터와 무관하게 전체다');
});

test('완료율 분모에 히든 업적이 포함된다', () => {
  const harness = new Harness();
  harness.send('pet-1', acquired('pet-001', 'COMMON'));
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  assert.equal(screen.total, 22);
  assert.equal(screen.unlocked, 1);
  assert.equal(screen.completionPercent, 5); // 1/22 = 4.5% → 5%
});

test('사실이 감소하지 않는다', () => {
  const harness = new Harness();
  harness.send('level-1', {
    eventType: 'pet.levelup',
    petId: petId('pet-1'),
    previousLevel: 19,
    level: 20,
    maxLevel: 50,
  });
  harness.send('level-2', {
    eventType: 'pet.levelup',
    petId: petId('pet-2'),
    previousLevel: 2,
    level: 3,
    maxLevel: 50,
  });
  assert.equal(
    factSnapshot(harness.state).max_pet_level,
    20,
    '다른 펫의 낮은 레벨이 최고값을 낮추면 안 된다',
  );
  assert.equal(factSnapshot(harness.state).max_level_reached, 0);
});
