/** 펫 도감 화면 모델의 실행 증거. 기획서 `.harness/specs/features/2026-10-05-pet-dex.md`. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DexEntry, PetSpecies, Rarity } from '@pet/client';
import {
  acquisitionHints,
  dexView,
  formatDiscoveredOn,
  initialSelection,
  roomFocusTarget,
  slotState,
  type DexViewOptions,
} from '@pet/dex';

const SPECIES: readonly PetSpecies[] = [
  { speciesId: '001', name: '도토리다람쥐', rarity: 'EPIC', sprite: 'acorn_squirrel' },
  { speciesId: '002', name: '미드나잇얼룩말', rarity: 'RARE', sprite: 'midnight_zebra' },
  { speciesId: '003', name: '두더지', rarity: 'COMMON', sprite: 'mole_digger' },
  { speciesId: '004', name: '새싹나무', rarity: 'COMMON', sprite: 'sprout_treant' },
  { speciesId: '005', name: '볼주머니햄', rarity: 'RARE', sprite: 'cheek_hamster' },
  { speciesId: '006', name: '별빛마법사', rarity: 'EPIC', sprite: 'star_wizard' },
];

const OPTIONS: DexViewOptions = {
  spriteOf: (species, stage) => ({
    card: `pets/${species.sprite}/s${stage}_card.png`,
    idle: `pets/${species.sprite}/s${stage}_idle.png`,
  }),
  gachaWeights: { common: 8_000, rare: 1_700, epic: 300 },
  combineMaterialCount: 10,
};

function entry(speciesId: string, patch: Partial<DexEntry> = {}): DexEntry {
  const species = SPECIES.find((candidate) => candidate.speciesId === speciesId);
  if (!species) throw new Error(speciesId);
  return {
    species,
    discoveredAt: null,
    ownedCount: 0,
    highestLevel: 0,
    highestStage: null,
    isNew: false,
    ...patch,
  };
}

const found = (patch: Partial<DexEntry> = {}): Partial<DexEntry> => ({
  discoveredAt: '2026-09-28T03:00:00.000Z',
  ownedCount: 1,
  highestLevel: 1,
  highestStage: 0,
  ...patch,
});

test('슬롯 상태는 미발견·보유·발견했지만 0마리 셋 중 하나다', () => {
  assert.equal(slotState(entry('003')), 'undiscovered');
  assert.equal(slotState(entry('003', found({ ownedCount: 3 }))), 'owned');
  assert.equal(
    slotState(entry('003', found({ ownedCount: 0, highestLevel: 0, highestStage: null }))),
    'discovered-empty',
  );
});

test('미발견 슬롯은 이름을 감추고 등급과 번호만 보여 준다', () => {
  const view = dexView([entry('006')], OPTIONS);
  const slot = view.sections.find((section) => section.rarity === 'EPIC')?.slots[0];
  assert.ok(slot);
  assert.equal(slot.state, 'undiscovered');
  assert.equal(slot.name, '???');
  assert.equal(slot.number, 'No.006');
  assert.equal(slot.rarity, 'EPIC');
  assert.equal(slot.discoveredOn, null);
  assert.equal(slot.ownedCount, 0);
  // 진화 단계도 전부 실루엣이다.
  assert.deepEqual(
    slot.stages.map((stage) => stage.reached),
    [false, false, false],
  );
});

test('보유 슬롯은 이름·보유 수·도달한 진화 단계까지 보여 준다', () => {
  const view = dexView(
    [entry('003', found({ ownedCount: 3, highestLevel: 7, highestStage: 1, isNew: true }))],
    OPTIONS,
  );
  const slot = view.sections[0]?.slots[0];
  assert.ok(slot);
  assert.equal(slot.state, 'owned');
  assert.equal(slot.name, '두더지');
  assert.equal(slot.ownedCount, 3);
  assert.equal(slot.highestLevel, 7);
  assert.equal(slot.isNew, true);
  assert.deepEqual(
    slot.stages.map((stage) => [stage.stage, stage.reached]),
    [
      [1, true],
      [2, true],
      [3, false],
    ],
  );
  assert.equal(slot.sprite.card, 'pets/mole_digger/s1_card.png');
  // 상세 무대는 도달한 가장 높은 단계를 그린다.
  assert.equal(slot.showcase.stage, 2);
  assert.equal(slot.showcase.sprite.idle, 'pets/mole_digger/s2_idle.png');
});

test('0마리가 된 종은 발견을 유지하고 1단계만 컬러로 남긴다', () => {
  const view = dexView(
    [entry('004', found({ ownedCount: 0, highestLevel: 0, highestStage: null }))],
    OPTIONS,
  );
  const slot = view.sections[0]?.slots[0];
  assert.ok(slot);
  assert.equal(slot.state, 'discovered-empty');
  assert.equal(slot.name, '새싹나무');
  assert.equal(slot.ownedCount, 0);
  assert.deepEqual(
    slot.stages.map((stage) => stage.reached),
    [true, false, false],
  );
  assert.equal(slot.showcase.stage, 1);
});

test('구역은 COMMON·RARE·EPIC 순, 같은 등급은 번호 순이다', () => {
  const view = dexView(SPECIES.map((species) => entry(species.speciesId)).reverse(), OPTIONS);
  assert.deepEqual(
    view.sections.map((section) => [section.rarity, section.slots.map((slot) => slot.speciesId)]),
    [
      ['COMMON', ['003', '004']],
      ['RARE', ['002', '005']],
      ['EPIC', ['001', '006']],
    ],
  );
});

test('진행도와 탭은 마리 수가 아니라 발견한 종 수로 센다', () => {
  const view = dexView(
    [
      entry('003', found({ ownedCount: 5 })),
      entry('004', found({ ownedCount: 0, highestLevel: 0, highestStage: null })),
      entry('002', found()),
      entry('005'),
      entry('001'),
      entry('006', found({ isNew: true })),
    ],
    OPTIONS,
  );
  assert.deepEqual(view.progress, { found: 4, total: 6, percent: 66 });
  assert.deepEqual(
    view.tabs.map((tab) => [tab.key, tab.found, tab.total]),
    [
      ['ALL', 4, 6],
      ['COMMON', 2, 2],
      ['RARE', 1, 2],
      ['EPIC', 1, 2],
    ],
  );
  assert.deepEqual(
    view.sections.map((section) => [section.rarity, section.found, section.total]),
    [
      ['COMMON', 2, 2],
      ['RARE', 1, 2],
      ['EPIC', 1, 2],
    ],
  );
  assert.equal(view.hasNew, true);
});

test('발견 0종이면 0%, 등록 종이 없어도 나누기 오류 없이 0%다', () => {
  const none = dexView(
    SPECIES.map((species) => entry(species.speciesId)),
    OPTIONS,
  );
  assert.deepEqual(none.progress, { found: 0, total: 6, percent: 0 });
  assert.equal(none.hasNew, false);
  const empty = dexView([], OPTIONS);
  assert.deepEqual(empty.progress, { found: 0, total: 0, percent: 0 });
  assert.deepEqual(
    empty.sections.map((section) => section.slots.length),
    [0, 0, 0],
  );
});

test('6종을 모두 발견하면 100%다', () => {
  const view = dexView(
    SPECIES.map((species) => entry(species.speciesId, found())),
    OPTIONS,
  );
  assert.deepEqual(view.progress, { found: 6, total: 6, percent: 100 });
});

test('획득 경로는 뽑기 가중치에서 확률을 계산하고 합성 경로를 덧붙인다', () => {
  const weights = OPTIONS.gachaWeights;
  const hints = (rarity: Rarity) => acquisitionHints(rarity, weights, 10);
  assert.deepEqual(hints('COMMON'), ['✨ 펫 뽑기에서 만날 수 있어요 · COMMON 80%']);
  assert.deepEqual(hints('RARE'), [
    '✨ 펫 뽑기에서 만날 수 있어요 · RARE 17%',
    '🔮 COMMON 펫 10마리를 합성해도 만날 수 있어요',
  ]);
  assert.deepEqual(hints('EPIC'), [
    '✨ 펫 뽑기에서 만날 수 있어요 · EPIC 3%',
    '🔮 RARE 펫 10마리를 합성해도 만날 수 있어요',
  ]);
  // 나누어떨어지지 않으면 소수 첫째 자리까지 쓴다.
  assert.deepEqual(acquisitionHints('EPIC', { common: 2, rare: 0, epic: 1 }, 5), [
    '✨ 펫 뽑기에서 만날 수 있어요 · EPIC 33.3%',
    '🔮 RARE 펫 5마리를 합성해도 만날 수 있어요',
  ]);
});

test('첫 만남 날짜는 YYYY.MM.DD 로 쓴다', () => {
  assert.equal(formatDiscoveredOn('2026-09-28T03:00:00.000Z', 'UTC'), '2026.09.28');
  assert.equal(formatDiscoveredOn('2026-09-28T23:30:00.000Z', 'Asia/Seoul'), '2026.09.29');
  assert.throws(() => formatDiscoveredOn('not a date', 'UTC'));
});

test('펫룸에서 보기는 활성 개체, 없으면 최고 레벨 개체를 연다', () => {
  assert.equal(roomFocusTarget([]), null);
  assert.equal(
    roomFocusTarget([
      { ownedPetId: 'a', isActive: false, level: 3 },
      { ownedPetId: 'b', isActive: true, level: 1 },
    ]),
    'b',
  );
  assert.equal(
    roomFocusTarget([
      { ownedPetId: 'a', isActive: false, level: 3 },
      { ownedPetId: 'c', isActive: false, level: 9 },
      { ownedPetId: 'd', isActive: false, level: 9 },
    ]),
    'c',
  );
});

test('처음 열 때는 NEW, 없으면 발견한 칸, 없으면 아무것도 고르지 않는다', () => {
  const all = (patches: Record<string, Partial<DexEntry>>) =>
    dexView(
      SPECIES.map((species) => entry(species.speciesId, patches[species.speciesId] ?? {})),
      OPTIONS,
    );
  // 방금 뽑은 EPIC 이 NEW 면 앞선 발견 칸보다 먼저 고른다.
  assert.equal(initialSelection(all({ '004': found(), '006': found({ isNew: true }) })), '006');
  // NEW 가 없으면 첫 미발견 칸(003)이 아니라 첫 발견 칸을 고른다.
  assert.equal(initialSelection(all({ '005': found() })), '005');
  assert.equal(initialSelection(all({})), null);
});
