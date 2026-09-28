/**
 * 공통 `PetClient` 로 옮긴 뒤의 계약.
 *
 * 펫 데이터의 유일한 출처는 이제 `PetClient` 다. 이 파일은 그 전환이 기획서의 기존 규칙을
 * 지키는지 확인한다 — 빈 상태는 오류가 아니고(INFO-001), 한 블록의 실패가 다른 블록을
 * 막지 않으며(INFO-007), 진행률은 줄지 않는다(7.1 · 9.4).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, parseLocalDate, type LocalDate } from '@pet/core';
import {
  AchievementCatalog,
  createMetaState,
  DEX_SLOT_COUNT,
  evaluate,
  FixtureCollector,
  InMemoryCollection,
  InMemoryCurrency,
  InMemoryPetClient,
  isUnlocked,
  type MetaState,
  performanceScreen,
  runAggregation,
  STUB_GROWTH_RULES,
  StubBattle,
  StubGacha,
  summaryScreen,
  tokenCounts,
} from '@pet/meta';

const NOW = '2026-08-24T14:37:12+09:00';
const today = (): LocalDate => {
  const parsed = parseLocalDate('2026-08-24');
  assert.ok(parsed);
  return parsed;
};

class Harness {
  state: MetaState = createMetaState();
  catalog = AchievementCatalog.embedded();
  collector = FixtureCollector.withEmptySnapshots();
  currency = new InMemoryCurrency();
  collection = new InMemoryCollection();
  pets = new InMemoryPetClient();
  rules = STUB_GROWTH_RULES;
  clock = new FixedClock(NOW);

  constructor() {
    this.currency.setNow(this.clock.now());
  }

  summary() {
    return summaryScreen(this.state, this.catalog, today(), this.pets, this.currency, this.rules);
  }

  evaluate() {
    return evaluate(
      this.state,
      this.catalog,
      this.currency,
      this.collection,
      this.pets,
      this.rules,
      this.clock,
    );
  }

  unlocked(id: string): boolean {
    const entry = this.state.progress.get(id);
    return entry !== undefined && isUnlocked(entry);
  }

  progress(id: string): number {
    return this.state.progress.get(id)?.progress ?? 0;
  }
}

/* ---------- 요약 프로필 ---------- */

test('INFO-003: 프로필은 PetClient 의 활성 펫을 그린다', () => {
  const harness = new Harness();
  const wizard = harness.pets.give('006', { level: 21, xpIntoLevel: 7, evolutionStage: 1 });
  harness.pets.setActivePet(wizard.ownedPetId);

  const pet = harness.summary().profile.activePet;

  assert.equal(pet.error, undefined);
  assert.equal(pet.value?.name, '별빛마법사');
  assert.equal(pet.value?.level, 21);
  assert.equal(pet.value?.sprite, 'star_wizard');
  assert.equal(pet.value?.rarity, 'EPIC');
});

test('INFO-003: 별명이 있으면 종 이름 대신 별명을 쓴다', () => {
  const harness = new Harness();
  const mole = harness.pets.give('003');
  harness.pets.setActivePet(mole.ownedPetId);
  harness.pets.updateNickname(mole.ownedPetId, '땅파기왕');

  assert.equal(harness.summary().profile.activePet.value?.name, '땅파기왕');
});

test('INFO-001: 활성 펫이 없으면 오류가 아니라 빈 상태다', () => {
  const harness = new Harness();
  harness.pets.give('003');

  const summary = harness.summary();

  // 오류(`error`)가 아니라 값이 `null` 이다. 화면은 이 둘을 다르게 그린다.
  assert.equal(summary.profile.activePet.error, undefined);
  assert.equal(summary.profile.activePet.value, null);
  // 활성 펫이 없어도 보유 수는 그대로 보인다.
  assert.equal(summary.ownedPets.value, 1);
});

test('INFO-007: 펫 조회가 실패하면 프로필만 오류고 나머지는 산다', () => {
  const harness = new Harness();
  harness.pets.setQueryFailure(true);

  const summary = harness.summary();

  assert.ok(summary.profile.activePet.error);
  assert.ok(summary.ownedPets.error);
  // 재화는 펫과 무관하므로 그대로다.
  assert.equal(summary.availableTokens.error, undefined);
  assert.equal(summary.profile.deviceLabel, '이 기기');
});

/* ---------- 경험치 ---------- */

test('INFO-003: 경험치는 저장된 현재 XP 와 성장 규칙의 필요량이다', () => {
  const harness = new Harness();
  const pet = harness.pets.give('004', { level: 16, xpIntoLevel: 9 });
  harness.pets.setActivePet(pet.ownedPetId);

  const experience = harness.summary().profile.activePet.value?.experience;

  assert.deepEqual(experience, {
    level: 16,
    current: 9,
    // PetClient 는 필요량을 주지 않는다. 성장 규칙이 계산한다.
    required: STUB_GROWTH_RULES.requiredXp(16),
  });
});

test('INFO-003: 최고 레벨에서는 남은 경험치가 0 이다', () => {
  const harness = new Harness();
  const max = STUB_GROWTH_RULES.maxLevel;
  const pet = harness.pets.give('004', { level: max, xpIntoLevel: 0 });
  harness.pets.setActivePet(pet.ownedPetId);

  assert.equal(harness.summary().profile.activePet.value?.experience.required, 0);
});

/* ---------- 누적 수치 ---------- */

test('INFO-001: 보유 펫과 도감은 PetClient 의 현재 보유에서 온다', () => {
  const harness = new Harness();
  harness.pets.give('003');
  harness.pets.give('003');
  harness.pets.give('006');

  const summary = harness.summary();

  assert.equal(summary.ownedPets.value, 3, '마리 수');
  assert.equal(summary.dexOwned.value, 2, '종 수 — 같은 종 두 마리는 한 칸');
  assert.equal(summary.dexTotal.value, DEX_SLOT_COUNT);
});

test('INFO-007: 실적의 최고 레벨은 PetClient 에서 오고 소유를 펫으로 표시한다', () => {
  const harness = new Harness();
  harness.pets.give('003', { level: 4 });
  harness.pets.give('006', { level: 18 });

  const tile = performanceScreen(
    new StubGacha(0, 0),
    new StubBattle(0),
    harness.pets,
    harness.currency,
  ).tiles.find((candidate) => candidate.key === 'best_level');

  assert.equal(tile?.value.value, 18);
  assert.equal(tile?.owner, '펫');
});

/* ---------- 업적 ---------- */

test('ACH: 펫 업적이 PetClient 데이터로 판정된다', () => {
  const harness = new Harness();
  harness.pets.give('006', { level: 16, evolutionStage: 1 });

  harness.evaluate();

  assert.ok(harness.unlocked('collection.first_pet'), '첫 만남');
  assert.ok(harness.unlocked('collection.first_epic'), '행운아 — EPIC 보유');
  assert.ok(harness.unlocked('growth.level_5'), '첫 걸음');
  assert.ok(harness.unlocked('growth.level_10'), '오랜 친구 Ⅰ');
  assert.ok(harness.unlocked('growth.first_evolution'), '진화의 순간');
  assert.ok(!harness.unlocked('growth.level_20'), '오랜 친구 Ⅱ 는 아직');
});

test('ACH: 오랜 친구 Ⅲ 은 성장 규칙의 최고 레벨 도달로 열린다', () => {
  const harness = new Harness();
  harness.pets.give('003', { level: STUB_GROWTH_RULES.maxLevel });

  harness.evaluate();

  assert.ok(harness.unlocked('growth.max_level'));
});

test('ACH: 도감 마스터는 도감 칸을 모두 채웠을 때만 열린다', () => {
  const harness = new Harness();
  // 등록된 종은 여섯뿐이라 도감 칸(20)을 채울 수 없다.
  for (const species of ['001', '002', '003', '004', '005', '006']) harness.pets.give(species);

  harness.evaluate();

  assert.ok(harness.unlocked('collection.dex_5'), '수집가 Ⅰ');
  assert.ok(!harness.unlocked('collection.dex_complete'), '6 / 20 은 완성이 아니다');
});

test('7.1 · 9.4: 펫을 잃어도 진행률과 판정 사실은 줄지 않는다', () => {
  const harness = new Harness();
  const species = ['001', '002', '003', '004', '005'];
  const owned = species.map((id) => harness.pets.give(id, { level: 12 }));
  harness.evaluate();
  assert.ok(harness.unlocked('collection.dex_5'));
  const before = harness.progress('collection.dex_15');

  // 합성 재료로 네 마리를 잃었다 — 현재 보유는 1종, 최고 레벨은 여전히 12.
  for (const pet of owned.slice(0, 4)) harness.pets.remove(pet.ownedPetId);
  harness.evaluate();

  assert.ok(harness.unlocked('collection.dex_5'), '해제는 되돌아가지 않는다');
  assert.equal(harness.progress('collection.dex_15'), before, '진행률이 줄지 않는다');
  assert.equal(harness.state.eventFacts.dexOwned, 5, '판정 사실은 최고값을 기억한다');
});

test('INFO-007: 펫 조회가 실패해도 사용량 업적 판정은 계속된다', () => {
  const harness = new Harness();
  runAggregation(harness.state, harness.collector, harness.currency, harness.clock);
  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokenCounts(1_200_000),
  );
  runAggregation(harness.state, harness.collector, harness.currency, harness.clock);
  harness.pets.setQueryFailure(true);

  harness.evaluate();

  assert.ok(harness.unlocked('usage.tokens_1m'), '펫 실패와 무관하게 열린다');
  assert.ok(!harness.unlocked('collection.first_pet'), '읽지 못한 펫 사실은 만들어내지 않는다');
});
