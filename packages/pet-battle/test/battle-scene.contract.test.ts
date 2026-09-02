import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';

import { deriveBattleScene, enemyColorForStage, type BattleState } from '../src/index.ts';

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
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(enemyColorForStage), [
    'RED',
    'ORANGE',
    'YELLOW',
    'GREEN',
    'BLUE',
    'PURPLE',
    'RAINBOW',
    'RED',
  ]);

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

test('자동 전투의 실제 공격 구간에는 걷기 대신 공격 시트를 사용한다', () => {
  const scene = deriveBattleScene({
    ...state(),
    motion: {
      beat: 'DASH',
      petOffset: { x: 24, y: 0 },
      enemyOffset: { x: 0, y: 0 },
      petScale: { x: 1, y: 1 },
      enemyScale: { x: 1, y: 1 },
      speedLineOpacity: 1,
      slashOpacity: 0,
      impactFlashOpacity: 0,
      afterimageOpacity: 0.3,
    },
    preview: { ...state().preview, assetVersion: 'V2' },
  });

  assert.match(scene.petAsset, /common-attack\.png$/);
  assert.equal(scene.petSprite.frameCount, 6);
  assert.equal(scene.petSprite.animated, true);
});

test('일시 정지 상태의 v2 펫은 idle 첫 프레임에서 멈춘다', () => {
  const paused = state({
    activePet: { ...state().activePet!, battleMode: 'PAUSED' },
    preview: { ...state().preview, assetVersion: 'V2' },
  });
  const scene = deriveBattleScene(paused);

  assert.match(scene.petAsset, /common-idle\.png$/);
  assert.equal(scene.petSprite.frameCount, 4);
  assert.equal(scene.petSprite.animated, false);
});

test('scene이 선택할 수 있는 v1/v2 에셋이 패키지 안에 모두 존재한다', async () => {
  const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'rainbow'];
  const faces = ['steady', 'worried', 'exhausted'];
  const versions = ['v1', 'v2'];
  const backgrounds = ['mushroom-forest', 'crystal-ruins', 'starlight-shrine'];
  const assetRoot = new URL('../assets/', import.meta.url);
  const paths = versions.flatMap((version) => [
    ...colors.flatMap((color) => faces.map((face) => `enemies/${version}/${color}-${face}.png`)),
    ...backgrounds.map((background) => `backgrounds/${version}/${background}.png`),
  ]);

  paths.push(
    'pets/v1/cream-fox-idle.png',
    'pets/v1/cream-fox-attack.png',
    ...['common', 'rare', 'epic'].flatMap((rarity) => [
      `pets/v2/${rarity}-idle.png`,
      `pets/v2/${rarity}-attack.png`,
    ]),
  );

  await Promise.all(paths.map((path) => access(new URL(path, assetRoot))));
});
