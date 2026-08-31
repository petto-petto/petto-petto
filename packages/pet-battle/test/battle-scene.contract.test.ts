import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveBattleScene,
  enemyColorForStage,
  type BattleState,
} from '../src/index.ts';

const state = (overrides: Partial<BattleState> = {}): BattleState => ({
  activePet: {
    petId: 'mio',
    displayName: '미오',
    rarity: 'COMMON',
    stage: 1,
    intervalXp: 0,
    battleMode: 'FIGHTING',
  },
  roster: [],
  enemyHpRatio: 1,
  enemyColor: 'RED',
  background: 'MUSHROOM_FOREST',
  overlay: null,
  preview: {
    assetVersion: 'V1',
    displayOpacity: 1,
    menu: 'CLOSED',
    petAction: null,
    enemyAction: null,
    enemyPhase: 'VISIBLE',
    enemySize: null,
    enemyColor: null,
    enemyHpRatio: null,
    attackEffectRarity: null,
    reducedMotion: false,
  },
  ...overrides,
});

test('적 단계는 일곱 색을 순환하고 색상에 맞는 배경을 함께 선택한다', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(enemyColorForStage),
    ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW', 'RED'],
  );

  const rainbow = deriveBattleScene(
    state({ enemyColor: 'RAINBOW', background: 'STARLIGHT_SHRINE' }),
  );
  assert.equal(rainbow.backgroundAsset, 'assets/backgrounds/v1/starlight-shrine.png');
  assert.match(rainbow.enemyAsset, /v1\/rainbow-steady\.png$/);
});

test('HP 미리보기는 표정과 HP 바를 함께 바꾸고 실제 진행도는 수정하지 않는다', () => {
  const canonical = state({ enemyHpRatio: 0.92 });
  const preview = deriveBattleScene({
    ...canonical,
    preview: { ...canonical.preview, enemyHpRatio: 0.25 },
  });

  assert.equal(preview.enemyHpRatio, 0.25);
  assert.equal(preview.enemyFace, 'EXHAUSTED');
  assert.match(preview.enemyAsset, /exhausted\.png$/);
  assert.equal(canonical.enemyHpRatio, 0.92);
});

test('v2와 등급별 타격 이펙트는 진행 상태와 독립적인 표현 모델이다', () => {
  const scene = deriveBattleScene({
    ...state(),
    preview: {
      ...state().preview,
      assetVersion: 'V2',
      attackEffectRarity: 'EPIC',
    },
  });

  assert.match(scene.petAsset, /assets\/pets\/v2\/common-idle\.png$/);
  assert.equal(scene.attackEffect.slashCount, 3);
  assert.equal(scene.attackEffect.shockwaveCount, 3);
  assert.equal(scene.attackEffect.particleCount, 12);
});
