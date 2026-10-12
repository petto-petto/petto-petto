import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';

import {
  deriveBattleScene,
  defeatedEnemyColors,
  enemyColorForStage,
  enemyColorStageForColor,
  enemySizeStageForSize,
  visibleEnemyStage,
  battleStageLabel,
  selectRandomPetSpectators,
  shouldStartEnemyHitReaction,
  type BattleState,
} from '../src/index.ts';

const state = (overrides: Partial<BattleState> = {}): BattleState => ({
  activePet: {
    petId: 'mio',
    displayName: '미오',
    rarity: 'COMMON',
    level: 1,
    sprite: 'mole_digger',
    evolutionStage: 0,
    stage: 1,
    intervalXp: 0,
    battleMode: 'FIGHTING',
  },
  roster: [],
  spectatorPetIds: [],
  enemyHpRatio: 1,
  enemyColor: 'RED',
  background: 'MUSHROOM_FOREST',
  overlay: null,
  preview: {
    displayOpacity: 1,
    menu: 'CLOSED',
    petAction: null,
    enemyAction: null,
    enemyPhase: 'VISIBLE',
    enemySize: null,
    enemyColor: null,
    enemyHpRatio: null,
    petAssetRarity: null,
    attackEffectRarity: null,
    reducedMotion: false,
  },
  ...overrides,
});

test('두더지 전용 동작은 실제 표시되는 공통 두더지 에셋에만 적용한다', () => {
  const current = state();
  assert.equal(deriveBattleScene(current).petCombatSpecies, undefined, 'fallback is not the mole');
  current.petSprites = {
    mio: {
      idle: { asset: 'shared/mole_digger/stage1/idle.png', frameCount: 4 },
      attack: { asset: 'shared/mole_digger/stage1/attack.png', frameCount: 6 },
    },
  };
  assert.equal(deriveBattleScene(current).petCombatSpecies, 'mole_digger');
  current.preview.petAssetRarity = 'RARE';
  assert.equal(
    deriveBattleScene(current).petCombatSpecies,
    undefined,
    'rarity preview uses default',
  );
  current.preview.petAssetRarity = null;
  current.activePet = { ...current.activePet!, sprite: 'new_species' };
  assert.equal(deriveBattleScene(current).petCombatSpecies, 'new_species');
});

test('지면 연출의 공격 여부가 기존 고정 주기 대신 펫 스프라이트를 결정한다', () => {
  const current = state();
  const attack = deriveBattleScene(current, true);
  assert.match(attack.petAsset, /-attack\.png$/);
  assert.equal(attack.petSprite.animated, true);
  const idle = deriveBattleScene(
    { ...current, preview: { ...current.preview, petAction: 'ATTACK' } },
    false,
  );
  assert.match(idle.petAsset, /-idle\.png$/);
  assert.equal(idle.petSprite.animated, false);
  const defeat = deriveBattleScene(
    { ...current, overlay: { phase: 'DEFEAT_MOTION', elapsed: 0, defeatedStage: 1, nextStage: 2 } },
    true,
  );
  assert.equal(defeat.petSprite.animated, false);
});

test('현재 보유 펫에서 활성 펫을 제외하고 중복 없이 무작위 최대 3마리를 고른다', () => {
  const pets = [
    state().activePet!,
    { ...state().activePet!, petId: 'pet-2', sprite: 'cat' },
    { ...state().activePet!, petId: 'pet-3', sprite: 'dog' },
    { ...state().activePet!, petId: 'pet-4', sprite: 'fox' },
    { ...state().activePet!, petId: 'pet-5', sprite: 'rabbit' },
  ];

  const selected = selectRandomPetSpectators(pets, 'mio', () => 0);

  assert.deepEqual(
    selected.map((pet) => pet.petId),
    ['pet-3', 'pet-4', 'pet-5'],
  );
  assert.equal(new Set(selected.map((pet) => pet.petId)).size, 3);
});

test('종류와 진화 단계가 같은 응원 펫은 하나만 고르고 활성 펫의 모습은 제외한다', () => {
  const active = { ...state().activePet!, evolutionStage: 1 as const };
  const pets = [
    active,
    { ...active, petId: 'active-copy' },
    { ...active, petId: 'baby', evolutionStage: 0 as const },
    { ...active, petId: 'baby-copy', evolutionStage: 0 as const },
    { ...active, petId: 'adult', evolutionStage: 2 as const },
    { ...active, petId: 'cat', sprite: 'cat' },
    { ...active, petId: 'cat-copy', sprite: 'cat' },
  ];
  const selected = selectRandomPetSpectators(pets, active.petId, () => 0);
  assert.equal(selected.length, 3);
  assert.deepEqual(
    selected.map((pet) => [pet.sprite, pet.evolutionStage]).sort(),
    [
      ['cat', 1],
      ['mole_digger', 0],
      ['mole_digger', 2],
    ].sort(),
  );
});

test('응원 후보가 부족하면 중복으로 채우지 않고 활성 펫이 없으면 비운다', () => {
  const active = state().activePet!;
  const cat = { ...active, petId: 'cat', sprite: 'cat' };
  const pets = [active, { ...active, petId: 'copy' }, cat, { ...cat, petId: 'cat-copy' }];
  assert.equal(selectRandomPetSpectators(pets, active.petId).length, 1);
  assert.deepEqual(selectRandomPetSpectators([active], active.petId), []);
  assert.deepEqual(selectRandomPetSpectators(pets, null), []);
});

test('처치한 적이 없으면 비우고, 있으면 최근 처치 적 최대 3마리를 역순으로 보여준다', () => {
  assert.deepEqual(defeatedEnemyColors(1), []);
  assert.deepEqual(defeatedEnemyColors(3), ['RED', 'RED']);
  assert.deepEqual(defeatedEnemyColors(6), ['ORANGE', 'ORANGE', 'RED']);
});

test('색마다 소·중·대를 거친 뒤 다음 색으로 넘어가고 24단계 뒤 반복한다', () => {
  const colors = [
    'RED',
    'ORANGE',
    'YELLOW',
    'GREEN',
    'BLUE',
    'INDIGO',
    'PURPLE',
    'RAINBOW',
  ] as const;
  for (let stage = 1; stage <= 49; stage += 1) {
    const color = colors[Math.floor((stage - 1) / 3) % 8]!;
    assert.equal(enemyColorForStage(stage), color);
    const scene = deriveBattleScene(
      state({ activePet: { ...state().activePet!, stage }, enemyColor: color }),
    );
    assert.equal(scene.enemyHeight, [56, 64, 80][(stage - 1) % 3]);
    assert.equal(scene.enemyColorStage, (Math.floor((stage - 1) / 3) % 8) + 1);
    assert.equal(scene.enemySizeStage, ((stage - 1) % 3) + 1);
  }

  assert.equal(enemyColorStageForColor('RAINBOW'), 8);
  assert.equal(enemySizeStageForSize('LARGE'), 3);
  const indigo = deriveBattleScene(
    state({ activePet: { ...state().activePet!, stage: 16 }, enemyColor: 'INDIGO' }),
  );
  assert.match(indigo.enemyAsset, /v2\/purple-steady\.png$/);
  assert.equal(indigo.enemyHueShiftDegrees, -30);

  const rainbow = deriveBattleScene(
    state({ enemyColor: 'RAINBOW', background: 'STARLIGHT_SHRINE' }),
  );
  assert.equal(rainbow.backgroundAsset, 'assets/backgrounds/v2/starlight-shrine.png');
  assert.match(rainbow.enemyAsset, /v2\/rainbow-steady\.png$/);
});

test('스테이지 번호는 색 순환 뒤에도 누적 구간으로 이어진다', () => {
  const cases = [
    [1, 'STAGE 1-1'],
    [3, 'STAGE 1-3'],
    [4, 'STAGE 2-1'],
    [24, 'STAGE 8-3'],
    [25, 'STAGE 9-1'],
    [48, 'STAGE 16-3'],
    [49, 'STAGE 17-1'],
    [300, 'STAGE 100-3'],
    [3000, 'STAGE 1,000-3'],
    [0xffff_ffff, 'STAGE 1,431,655,765-3'],
  ] as const;
  for (const [stage, expected] of cases) {
    assert.equal(
      battleStageLabel(state({ activePet: { ...state().activePet!, stage } })),
      expected,
    );
  }
  for (let stage = 1; stage <= 24; stage++) {
    const current = state({
      activePet: { ...state().activePet!, stage },
      enemyColor: enemyColorForStage(stage),
    });
    const scene = deriveBattleScene(current);
    assert.equal(
      battleStageLabel(current),
      `STAGE ${scene.enemyColorStage}-${scene.enemySizeStage}`,
    );
  }
});

test('24단계 처치와 대기에는 8-3, 다음 적 등장부터 9-1을 표시한다', () => {
  for (const phase of ['DEFEAT_MOTION', 'AWAITING_ADVANCE', 'SPAWNING', 'FIGHTING'] as const) {
    const current = state({
      activePet: { ...state().activePet!, stage: 25 },
      overlay: { phase, elapsed: 0, defeatedStage: 24, nextStage: 25 },
    });
    assert.equal(
      battleStageLabel(current),
      phase === 'DEFEAT_MOTION' || phase === 'AWAITING_ADVANCE' ? 'STAGE 8-3' : 'STAGE 9-1',
    );
  }
});

test('적 색과 크기 미리보기는 누적 스테이지 번호를 바꾸지 않는다', () => {
  const current = state({
    activePet: { ...state().activePet!, stage: 49 },
    preview: { ...state().preview, enemyColor: 'RAINBOW', enemySize: 'LARGE' },
  });
  assert.equal(battleStageLabel(current), 'STAGE 17-1');
});

test('정복 중에는 처치한 적 크기를 유지하고 다음 적 등장부터 크기를 바꾼다', () => {
  for (const phase of ['DEFEAT_MOTION', 'AWAITING_ADVANCE', 'SPAWNING'] as const) {
    const scene = deriveBattleScene(
      state({
        activePet: { ...state().activePet!, stage: 4 },
        overlay: { phase, elapsed: 0, defeatedStage: 3, nextStage: 4 },
        preview: { ...state().preview, enemySize: 'MEDIUM' },
      }),
    );
    assert.equal(scene.enemyHeight, phase === 'SPAWNING' ? 56 : 80);
  }
});

test('자동 크기와 수동 색·크기 미리보기는 서로 간섭하지 않는다', () => {
  const current = state({ activePet: { ...state().activePet!, stage: 2 } });
  assert.equal(deriveBattleScene(current).enemyHeight, 64);
  const color = deriveBattleScene({
    ...current,
    preview: { ...current.preview, enemyColor: 'RAINBOW' },
  });
  assert.equal(color.enemyHeight, 64);
  assert.match(color.enemyAsset, /rainbow-/);
  const size = deriveBattleScene({
    ...current,
    preview: { ...current.preview, enemySize: 'LARGE' },
  });
  assert.equal(size.enemyHeight, 80);
  assert.match(size.enemyAsset, /red-/);
  assert.equal(current.activePet!.stage, 2);
});

test('전환이 전투 상태로 끝났으면 과거 nextStage 대신 현재 활성 단계로 표현한다', () => {
  assert.equal(
    visibleEnemyStage(
      state({
        activePet: { ...state().activePet!, stage: 7 },
        overlay: { phase: 'FIGHTING', elapsed: 0, defeatedStage: 3, nextStage: 4 },
      }),
    ),
    7,
  );
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

test('실제 정복도 처치·대기·등장 표현을 사용하며 전환 중에는 미리보기를 무시한다', () => {
  const phases = [
    ['DEFEAT_MOTION', 'DEFEATING'],
    ['AWAITING_ADVANCE', 'HIDDEN'],
    ['SPAWNING', 'SPAWNING'],
  ] as const;
  for (const [phase, expected] of phases) {
    const scene = deriveBattleScene(
      state({
        overlay: { phase, elapsed: 0, defeatedStage: 1, nextStage: 2 },
        enemyHpRatio: phase === 'SPAWNING' ? 1 : 0,
        preview: { ...state().preview, enemyColor: 'RAINBOW', enemyHpRatio: 0.5 },
      }),
    );
    assert.equal(scene.enemyPhase, expected);
    assert.equal(scene.enemyVisible, phase !== 'AWAITING_ADVANCE');
    assert.equal(scene.enemyHpRatio, phase === 'SPAWNING' ? 1 : 0);
    assert.match(scene.enemyAsset, /red-/);
  }
  assert.equal(deriveBattleScene(state({ activePet: null })).enemyVisible, false);
});

test('v2와 등급별 타격 이펙트는 진행 상태와 독립적인 표현 모델이다', () => {
  const scene = deriveBattleScene({
    ...state(),
    preview: {
      ...state().preview,
      attackEffectRarity: 'EPIC',
    },
  });

  assert.match(scene.petAsset, /assets\/pets\/v2\/common-idle\.png$/);
  assert.equal(scene.attackEffect.slashCount, 3);
  assert.equal(scene.attackEffect.shockwaveCount, 3);
  assert.equal(scene.attackEffect.particleCount, 12);
});

test('호스트가 준 실제 종·단계 에셋을 등급별 대표 이미지 대신 사용한다', () => {
  const current = state();
  const shared = {
    ...current,
    activePet: {
      ...current.activePet!,
      sprite: 'star_wizard',
      rarity: 'EPIC' as const,
      evolutionStage: 1 as const,
    },
    petSprites: {
      mio: {
        idle: { asset: 'file:///pets/star_wizard/stage2/idle.png', frameCount: 4 },
        attack: { asset: 'file:///pets/star_wizard/stage2/attack.png', frameCount: 7 },
      },
    },
  };
  assert.equal(deriveBattleScene(shared).petAsset, shared.petSprites.mio.idle.asset);
  assert.equal(deriveBattleScene(shared).petIdleAsset, shared.petSprites.mio.idle.asset);
  assert.equal(deriveBattleScene(shared).petAttackAsset, shared.petSprites.mio.attack.asset);
  const attack = deriveBattleScene({
    ...shared,
    preview: { ...shared.preview, petAction: 'ATTACK' },
  });
  assert.equal(attack.petAsset, shared.petSprites.mio.attack.asset);
  assert.equal(attack.petIdleAsset, shared.petSprites.mio.idle.asset);
  assert.equal(attack.petAttackAsset, shared.petSprites.mio.attack.asset);
  assert.equal(attack.petSprite.frameCount, 7);
  assert.equal(attack.petSprite.frameSteps, 6);
});

test('펫 에셋 미리보기는 activePet 교체 없이 v2 펫 이미지만 순환한다', () => {
  const scene = deriveBattleScene({
    ...state(),
    preview: {
      ...state().preview,
      petAssetRarity: 'EPIC',
    },
  });

  assert.match(scene.petAsset, /assets\/pets\/v2\/epic-idle\.png$/);
  assert.equal(scene.petIdleAsset, scene.petAsset);
  assert.equal(scene.petAttackAsset, 'assets/pets/v2/epic-attack.png');
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
    preview: { ...state().preview },
  });

  assert.match(scene.petAsset, /common-attack\.png$/);
  assert.equal(scene.petIdleAsset, 'assets/pets/v2/common-idle.png');
  assert.equal(scene.petSprite.frameCount, 6);
  assert.equal(scene.petSprite.frameSteps, 5);
  assert.equal(scene.petSprite.animated, true);
});

test('일시 정지 상태의 v2 펫은 idle 첫 프레임에서 멈춘다', () => {
  const paused = state({
    activePet: { ...state().activePet!, battleMode: 'PAUSED' },
    preview: { ...state().preview },
  });
  const scene = deriveBattleScene(paused);

  assert.match(scene.petAsset, /common-idle\.png$/);
  assert.equal(scene.petSprite.frameCount, 4);
  assert.equal(scene.petSprite.animated, false);
});

test('실제 공격 충돌과 맞기 미리보기는 같은 피격 반응을 시작한다', () => {
  const idle = state({
    motion: {
      beat: 'DASH',
      petOffset: { x: 30, y: 0 },
      enemyOffset: { x: 0, y: 0 },
      petScale: { x: 1, y: 1 },
      enemyScale: { x: 1, y: 1 },
      speedLineOpacity: 1,
      slashOpacity: 0,
      impactFlashOpacity: 0,
      afterimageOpacity: 0.2,
    },
  });
  const actualHit = {
    ...idle,
    motion: { ...idle.motion!, beat: 'IMPACT' as const },
  };
  const previewHit = {
    ...idle,
    preview: { ...idle.preview, enemyAction: 'HIT' as const, enemyPhase: 'HIT' as const },
  };

  assert.equal(shouldStartEnemyHitReaction(idle, actualHit), true);
  assert.equal(shouldStartEnemyHitReaction(idle, previewHit), true);
  assert.equal(shouldStartEnemyHitReaction(actualHit, actualHit), false);
  assert.equal(shouldStartEnemyHitReaction(previewHit, previewHit), false);
});

test('scene은 v2 에셋만 선택하고 제거된 v1 에셋은 존재하지 않는다', async () => {
  const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'rainbow'];
  const faces = ['steady', 'worried', 'exhausted'];
  const backgrounds = ['mushroom-forest', 'crystal-ruins', 'starlight-shrine'];
  const assetRoot = new URL('../ui/assets/', import.meta.url);
  const paths = [
    ...colors.flatMap((color) => faces.map((face) => `enemies/v2/${color}-${face}.png`)),
    ...backgrounds.map((background) => `backgrounds/v2/${background}.png`),
  ];

  paths.push(
    ...['common', 'rare', 'epic'].flatMap((rarity) => [
      `pets/v2/${rarity}-idle.png`,
      `pets/v2/${rarity}-attack.png`,
    ]),
  );

  await Promise.all(paths.map((path) => access(new URL(path, assetRoot))));
  await Promise.all([
    assert.rejects(access(new URL('pets/v1', assetRoot))),
    assert.rejects(access(new URL('enemies/v1', assetRoot))),
    assert.rejects(access(new URL('backgrounds/v1', assetRoot))),
  ]);
});

test('배경 생성 scene은 런타임 에셋과 분리된 아트 폴더에 보관한다', async () => {
  const assetRoot = new URL('../ui/art/', import.meta.url);
  const generatedSources = [
    'backgrounds/generated/bg_201_mushroom_forest/scene.json',
    'backgrounds/generated/bg_202_crystal_ruins/scene.json',
    'backgrounds/generated/bg_203_starlight_shrine/scene.json',
  ];

  await Promise.all(generatedSources.map((path) => access(new URL(path, assetRoot))));
});
