import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GrowthController,
  OverlayGrowthState,
  TOKENS_PER_XP,
  createGrowthPet,
  spritePath,
  stageForEvolution,
} from '../src/index.ts';
import type { GrowthSnapshot, PetKey } from '../src/index.ts';

test('tokens carry across usage reports and award XP only at the boundary', () => {
  const controller = new GrowthController(createGrowthPet('mole_digger', '두더지'));

  const first = controller.applyUsage({ tokens: 3_000, eventId: 'usage:1' });
  assert.equal(first.gainedXp, 0);
  assert.equal(first.view.tokensUntilNextXp, 2_000);
  assert.equal(first.view.levelProgress, 3_000 / TOKENS_PER_XP / 10);

  const second = controller.applyUsage({ tokens: 3_000, eventId: 'usage:2' });
  assert.equal(second.gainedXp, 1);
  assert.equal(second.view.pet.totalXp, 1);
  assert.equal(second.view.tokensUntilNextXp, 4_000);
});

test('a usage event is idempotent and evolution remains an explicit action', () => {
  const controller = new GrowthController(createGrowthPet('mole_digger', '두더지'));
  const usage = { tokens: 1_000_000, eventId: 'usage:once' };

  controller.applyUsage(usage);
  const repeated = controller.applyUsage(usage);
  assert.equal(repeated.gainedXp, 0);
  assert.equal(repeated.events.length, 0);
  assert.equal(controller.view().pet.totalXp, 200);
  assert.equal(controller.view().pet.evolutionAvailable, true);

  const evolved = controller.evolve();
  assert.equal(evolved.evolved, true);
  assert.equal(evolved.view.pet.evolutionStage, 1);
});

test('sprite paths follow the asset contract and never infer a stage from level', () => {
  assert.equal(stageForEvolution(0), 1);
  assert.equal(stageForEvolution(2), 3);
  assert.equal(
    spritePath('acorn_squirrel', 3, 'idle'),
    'assets/pets/epic/acorn_squirrel/stage3/pet_001_s3_idle.png',
  );
});

test('each pet keeps an independent persisted growth record', () => {
  let saved: Partial<Record<PetKey, GrowthSnapshot>> = {};
  const state = new OverlayGrowthState({
    load: () => saved,
    save: (snapshots) => {
      saved = snapshots;
    },
  });

  state.applyUsage('mole_digger', { tokens: 1_000_000, eventId: 'mole:1' });
  const evolution = state.evolve('mole_digger');

  assert.equal(evolution.evolved, true);
  assert.equal(state.growthFor('mole_digger').view().pet.evolutionStage, 1);
  assert.equal(state.growthFor('star_wizard').view().pet.totalXp, 0);
  assert.equal(saved.mole_digger?.pet.evolutionStage, 1);
  assert.equal(saved.star_wizard?.pet.totalXp, 0);
});
