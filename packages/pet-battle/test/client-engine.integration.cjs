const assert = require('node:assert/strict');
const { test } = require('node:test');

// Contract fixture only: no owner implementation, SQLite, or user data is accessed.
const rules = {
  levelXpCosts: Array.from({ length: 50 }, (_, i) => 10 + Math.floor((i + 1) / 2)),
  intervalLevels: { COMMON: 12, RARE: 10, EPIC: 8 },
};
const initialPet = {
  ownedPetId: 'owned-001',
  speciesId: '003',
  name: '두더지',
  nickname: '토리',
  rarity: 'COMMON',
  sprite: 'mole_digger',
  level: 2,
  totalXp: 20,
  xpIntoLevel: 10,
  evolutionStage: 0,
  isActive: true,
};

test('PetClient 저장값 → Electron 엔진 HP·정복·다음 적, 중복 알림·재연결·활성 해제', async (t) => {
  const { PetBattleIntegration, ElectronBattleEngine, deriveBattleScene } =
    await import('../dist/index.js');
  let active = { ...initialPet };
  const client = new Proxy(
    {
      getActivePet: () => active,
      listOwnedPets: () => (active ? [active] : []),
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        throw new Error(`전투에서 허용하지 않은 공통 API: ${String(key)}`);
      },
    },
  );
  const connect = () => {
    const engine = new ElectronBattleEngine();
    return new PetBattleIntegration(client, engine, rules);
  };
  const battle = connect();
  let result = await battle.syncActivePet();
  assert.equal(result.state.activePet.petId, 'owned-001');
  assert.equal(result.state.activePet.displayName, '토리');
  assert.equal(result.state.activePet.stage, 1);
  assert.ok(Math.abs(result.state.enemyHpRatio - 1 / 21) < 0.00001);
  assert.equal(deriveBattleScene(result.state).enemyHeight, 56);

  active = { ...active, level: 3, totalXp: 21, xpIntoLevel: 0 };
  const notification = { ownedPetId: active.ownedPetId, amount: 99999, nowMs: 0 };
  result = await battle.applyGrowthXp(notification);
  assert.equal(result.state.activePet.stage, 2);
  assert.equal(result.state.enemyHpRatio, 0);
  assert.equal(result.events.filter((e) => e.type === 'ENEMY_DEFEATED').length, 1);
  result = await battle.applyGrowthXp(notification);
  assert.equal(result.events.filter((e) => e.type === 'ENEMY_DEFEATED').length, 0);
  assert.equal(result.state.activePet.stage, 2);

  result = await battle.execute({ type: 'OVERLAY_CLICK', nowMs: 0 });
  assert.equal(result.state.overlay.phase, 'SPAWNING');
  assert.equal(result.events.at(-1).result, 'DEFEAT_MOTION_SKIPPED');
  assert.equal(result.state.enemyColor, 'RED');
  assert.equal(result.state.background, 'MUSHROOM_FOREST');
  assert.equal(deriveBattleScene(result.state).enemyHeight, 64);
  result = await battle.execute({ type: 'OVERLAY_CLICK', nowMs: 0 });
  assert.equal(result.state.overlay.phase, 'SPAWNING');
  assert.deepEqual(result.events, [], 'an extra optional click must not restart the transition');

  active = { ...active, level: 22, totalXp: 320, xpIntoLevel: 0 };
  const reconnected = connect();
  result = await reconnected.syncActivePet();
  assert.equal(result.state.activePet.stage, 10);
  assert.equal(result.state.enemyColor, 'GREEN');
  assert.equal(result.state.background, 'CRYSTAL_RUINS');
  assert.equal(
    result.events.some((e) => e.type === 'ENEMY_DEFEATED'),
    false,
  );

  active = null;
  result = await reconnected.syncActivePet();
  assert.equal(result.state.activePet, null);
  assert.deepEqual(result.state.roster, []);
});

test('실제 XP 정복은 클릭 없이 다음 적으로 전환하며 투명도·STOP·누적 XP를 보존한다', async (t) => {
  const { PetBattleIntegration, ElectronBattleEngine, deriveBattleScene } =
    await import('../dist/index.js');
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);

  for (const paused of [false, true]) {
    let active = { ...initialPet, level: 7, totalXp: 81, xpIntoLevel: 12 };
    const client = new Proxy(
      {
        getActivePet: () => active,
        listOwnedPets: () => [active],
      },
      {
        get(target, key) {
          if (key in target) return target[key];
          throw new Error(`전투에서 허용하지 않은 공통 API: ${String(key)}`);
        },
      },
    );
    const engine = new ElectronBattleEngine();
    const battle = new PetBattleIntegration(client, engine, rules);
    let result = await battle.syncActivePet();
    assert.equal(result.state.activePet.stage, 3);
    assert.equal(result.state.enemyColor, 'RED');
    assert.equal(deriveBattleScene(result.state).enemyHeight, 80);
    await battle.execute({ type: 'SET_DISPLAY_OPACITY', percent: 35 });
    await battle.execute({ type: 'SET_BATTLE_RUNNING', running: !paused });

    now += 1000;
    const conqueredAt = now;
    active = { ...active, level: 8, totalXp: 82, xpIntoLevel: 0 };
    result = await battle.applyGrowthXp({
      ownedPetId: active.ownedPetId,
      amount: 99999,
      nowMs: 0,
    });
    assert.equal(result.state.overlay.phase, 'DEFEAT_MOTION');
    assert.equal(result.state.activePet.stage, 4);
    assert.equal(result.state.enemyColor, 'RED');
    assert.equal(result.state.enemyHpRatio, 0);
    assert.equal(deriveBattleScene(result.state).enemyHeight, 80);
    assert.equal(result.events.filter((event) => event.type === 'ENEMY_DEFEATED').length, 1);

    now = conqueredAt + 1400;
    result = await battle.syncActivePet();
    assert.equal(result.state.overlay.phase, 'DEFEAT_MOTION');
    assert.deepEqual(result.events, []);

    now = conqueredAt + 1490;
    result = await battle.syncActivePet();
    assert.equal(result.state.overlay.phase, 'SPAWNING');
    assert.equal(result.state.enemyColor, 'ORANGE');
    assert.equal(result.state.enemyHpRatio, 1);
    assert.equal(deriveBattleScene(result.state).enemyHeight, 56);

    now = conqueredAt + 2210;
    result = await battle.syncActivePet();
    assert.equal(result.state.overlay, null);
    assert.equal(result.state.activePet.stage, 4);
    assert.equal(result.state.activePet.syncedTotalXp, 82);
    assert.equal(result.state.activePet.battleMode, paused ? 'PAUSED' : 'FIGHTING');
    assert.ok(Math.abs(result.state.preview.displayOpacity - 0.35) < 0.000001);
    if (paused) assert.equal(result.state.motion.beat, 'IDLE');
    assert.deepEqual(result.events, [], 'time-based advance must not replay XP or conquest events');
    assert.equal(active.totalXp, 82, 'presentation must not write common pet XP');
  }
});

test('같은 레벨의 저장 XP도 Electron 엔진 HP를 줄이고 표시 HP는 중복 알림 없이 연속 감소한다', async (t) => {
  const { PetBattleIntegration, ElectronBattleEngine } = await import('../dist/index.js');
  const { HpBarMotion } = await import('../dist/view/hp-bar-motion.js');
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let active = Object.freeze({ ...initialPet, level: 1, totalXp: 0, xpIntoLevel: 0 });
  const client = new Proxy(
    {
      getActivePet: () => active,
      listOwnedPets: () => [active],
    },
    {
      get(target, key) {
        if (Object.hasOwn(target, key)) return target[key];
        throw new Error(`전투에서 허용하지 않은 공통 API: ${String(key)}`);
      },
    },
  );
  const engine = new ElectronBattleEngine();
  const battle = new PetBattleIntegration(client, engine, rules);
  const motion = new HpBarMotion();
  const frame = (state) =>
    motion.frame({
      key: `${state.activePet.petId}:${state.activePet.stage}`,
      resetKey: 'live-xp',
      ratio: state.enemyHpRatio,
      nowMs: now,
      reducedMotion: false,
      running: true,
    });
  let result = await battle.syncActivePet();
  assert.equal(result.state.preview.enemyHpRatio, null, 'manual HP preview must be inactive');
  assert.equal(result.state.activePet.stage, 1);
  assert.equal(result.state.enemyHpRatio, 1);
  let previous = frame(result.state).fillRatio;
  const interpolations = [];

  for (const totalXp of [1, 2, 9, 10, 11]) {
    now += 100;
    const startedAt = now;
    const level = totalXp < 10 ? 1 : 2;
    active = Object.freeze({
      ...active,
      level,
      totalXp,
      xpIntoLevel: totalXp < 10 ? totalXp : totalXp - 10,
    });
    const notification = { ownedPetId: active.ownedPetId, amount: 99999, nowMs: 0 };
    result = await battle.applyGrowthXp(notification);
    const state = result.state;
    const expectedHp = 1 - totalXp / 21;
    assert.equal(state.activePet.level, level);
    assert.equal(state.activePet.stage, 1, 'Lv.1 → Lv.2 must keep the current enemy');
    assert.equal(state.activePet.syncedTotalXp, totalXp);
    assert.equal(state.preview.enemyHpRatio, null, 'test observes real HP, not an HP preview');
    assert.ok(Math.abs(state.enemyHpRatio - expectedHp) < 0.000001);
    assert.equal(result.events.filter((event) => event.type === 'XP_APPLIED').length, 1);
    assert.equal(
      result.events.some((event) => event.type === 'ENEMY_DEFEATED'),
      false,
    );

    const start = frame(state);
    assert.equal(start.fillRatio, previous, 'new XP must not snap the displayed HP to its target');
    const widths = new Set([start.fillRatio.toFixed(10)]);
    for (let elapsed = 20; elapsed <= 700; elapsed += 20) {
      now = startedAt + elapsed;
      const sample = frame(state);
      assert.ok(sample.fillRatio <= previous + 1e-12, 'displayed HP must never rebound');
      assert.ok(sample.fillRatio >= state.enemyHpRatio - 1e-12, 'display must not invent damage');
      previous = sample.fillRatio;
      widths.add(sample.fillRatio.toFixed(10));

      if (elapsed === 300) {
        const duplicate = await battle.applyGrowthXp(notification);
        assert.deepEqual(
          duplicate.events,
          [],
          'same saved XP notification must not apply XP twice',
        );
        assert.equal(duplicate.state.enemyHpRatio, state.enemyHpRatio);
        assert.equal(duplicate.state.activePet.syncedTotalXp, totalXp);
        assert.deepEqual(frame(duplicate.state), sample, 'duplicate must not restart the HP drop');
      }
    }
    assert.equal(previous, state.enemyHpRatio, 'display reaches actual HP within 700ms');
    assert.equal(active.totalXp, totalXp, 'presentation must not mutate owner XP');
    interpolations.push({ totalXp, uniqueWidths: widths.size });
  }

  // Check after the full XP sequence so RED evidence also exercises level-up and duplicate events.
  for (const { totalXp, uniqueWidths } of interpolations) {
    assert.ok(
      uniqueWidths > 8,
      `XP ${totalXp}: continuous interpolation needs >8 distinct widths, received ${uniqueWidths}`,
    );
  }
});
