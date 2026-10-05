// Actual renderer regression, run via arena.browser.cjs --continuity-only.
// Clock, selection and progression live only in an isolated HTTP page; no user DB.
const assert = require('node:assert/strict');

function readPosition() {
  const root = document.querySelector('#battle-overlay');
  const rect = (selector) => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  };
  return {
    pet: { x: Number(root.dataset.petWorldX), y: Number(root.dataset.petWorldY) },
    enemy: { x: Number(root.dataset.enemyWorldX), y: Number(root.dataset.enemyWorldY) },
    petBox: rect('#pet'),
    enemyBox: rect('#enemy'),
    camera: document.querySelector('#battle-world').style.transform,
    phase: root.dataset.arenaPhase,
    turn: root.dataset.attackTurn,
    petImpact: root.dataset.beat === 'IMPACT',
    enemyImpact: root.dataset.enemyImpact === 'true',
    source: document.querySelector('#pet-sheet').src,
    background: document.querySelector('#battle-background').src,
    hp: document.querySelector('#enemy-hp-label').textContent,
    stage: document.querySelector('#stage-label').textContent,
  };
}

function assertUnmoved(before, after, label, axes = ['x', 'y']) {
  for (const actor of ['pet', 'enemy'])
    for (const axis of axes)
      assert.ok(
        Math.abs(before[actor][axis] - after[actor][axis]) <= 0.1,
        `${label}: ${actor}.${axis} recentered from ${before[actor][axis]} to ${after[actor][axis]}`,
      );
}

function assertContained(frame, width, height) {
  for (const actor of ['pet', 'enemy']) {
    const box = frame[`${actor}Box`];
    assert.ok(
      box.x >= -0.1 && box.y >= -0.1 && box.right <= width + 0.1 && box.bottom <= height + 0.1,
      `${width}x${height}: ${actor} escaped after reflow: ${JSON.stringify(box)}`,
    );
  }
}

async function checkPositionContinuity(cdp, evaluate, waitFor, screenshot) {
  const fixture = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      window.__positionNow = 100000;
      Date.now = () => window.__positionNow;
      Math.random = () => 0.25;
      window.__positionVersion = 0;
      const ready = import('/packages/pet-battle/dist/testing/demo-gateway.js').then(async ({ DemoBattleGateway }) => {
        const result = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        result.state.spectatorPetIds = [];
        result.state.preview.enemySize = 'SMALL';
        window.__positionFixture = result.state;
      });
      window.petBattle = { execute: async () => {
        await ready;
        window.__positionDelivered = window.__positionVersion;
        return { state: structuredClone(window.__positionFixture), events: [] };
      } };
    })();`,
  });
  const settle = () =>
    evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const read = () => evaluate(`(${readPosition})()`);
  const step = async (milliseconds) => {
    await evaluate(`window.__positionNow += ${milliseconds}`);
    await settle();
    return read();
  };
  const update = async (expression) => {
    const version = await evaluate(`(() => {
      const state = window.__positionFixture;
      ${expression}
      return ++window.__positionVersion;
    })()`);
    await waitFor(`window.__positionDelivered === ${version}`, 'isolated selection delivered');
    await settle();
    return read();
  };
  const resize = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `innerWidth === ${width} && innerHeight === ${height} && document.querySelector('#battle-world').clientWidth === ${width + 60}`,
      `${width}x${height} continuity viewport`,
    );
    await settle();
    return read();
  };
  try {
    await cdp.send('Page.reload');
    await waitFor(
      "Boolean(window.__positionFixture && document.querySelector('#battle-overlay')?.dataset.arenaPhase && document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth > 0)",
      'isolated position fixture loaded',
    );
    const initial = await read();
    for (let index = 0; index < 9; index++) await step(100);
    await update("state.activePet.battleMode = 'PAUSED';");
    // Catch up the 500ms camera history while keeping actors motionless. With
    // Date.now fixed after this, selection/resize cannot be confused with walking.
    for (let index = 0; index < 10; index++) await step(100);
    const before = await read();
    assert.ok(before.pet.x < initial.pet.x - 15, 'fixture actually left the initial center');
    assert.notEqual(before.camera, initial.camera, 'fixture has a nonzero tracked camera');

    const checks = [];
    const failures = [];
    const check = (label, assertion, result) => {
      try {
        assertion();
        checks.push({ label, result });
      } catch (error) {
        failures.push(`${label}: ${error.message}`);
      }
    };
    const switched = await update("state.activePet.petId = 'continuity-selected';");
    check(
      'active pet selection',
      () => {
        assertUnmoved(before, switched, 'pet selection');
        assert.equal(switched.camera, before.camera, 'selection preserves delayed camera state');
      },
      switched,
    );

    const spriteBefore = await read();
    await update("state.preview.petAssetRarity = 'EPIC';");
    await waitFor(
      "document.querySelector('#pet-sheet').complete && document.querySelector('#pet-sheet').src.endsWith('/epic-idle.png')",
      'new pet sprite decoded',
    );
    await settle();
    const spriteAfter = await read();
    check(
      'sprite replacement',
      () => {
        assertUnmoved(spriteBefore, spriteAfter, 'sprite replacement');
        assert.equal(spriteAfter.camera, spriteBefore.camera, 'sprite loading preserves camera');
        assert.notEqual(spriteBefore.source, spriteAfter.source, 'sprite truly changed');
      },
      spriteAfter,
    );

    const wider = await resize(840, 420);
    check(
      'width grows',
      () => {
        assertUnmoved(spriteAfter, wider, 'width grows');
        assert.equal(wider.camera, spriteAfter.camera, 'wider viewport preserves camera');
        assertContained(wider, 840, 420);
      },
      wider,
    );
    const restored = await resize(640, 420);
    check(
      'width restores',
      () => {
        assertUnmoved(wider, restored, 'width restores');
        assertContained(restored, 640, 420);
      },
      restored,
    );

    const stageAfter = await update("state.activePet.stage = 10; state.enemyColor = 'GREEN';");
    check(
      'stage and background replacement',
      () => {
        assertUnmoved(restored, stageAfter, 'stage/background', ['x']);
        assert.notEqual(restored.background, stageAfter.background, 'background truly changed');
        assert.equal(stageAfter.stage, 'COLOR 4/8 · SIZE 1/3');
        assertContained(stageAfter, 640, 420);
      },
      stageAfter,
    );

    const resized = [];
    for (const [width, height] of [
      [360, 180],
      [360, 640],
      [960, 540],
    ]) {
      const frame = await resize(width, height);
      check(
        `${width}x${height} stays contained`,
        () => assertContained(frame, width, height),
        frame,
      );
      resized.push({ width, height, frame });
    }
    const resumeBefore = await read();
    await update("state.activePet.battleMode = 'FIGHTING';");
    const resumed = [];
    for (let index = 0; index < 50; index++) resumed.push(await step(200));
    check(
      'attacks resume after reflow',
      () => {
        assert.ok(
          resumed.some((frame) => frame.petImpact),
          'pet still reaches a visible attack',
        );
        assert.ok(
          resumed.some((frame) => frame.enemyImpact),
          'enemy still reaches a visible slam',
        );
        for (const frame of resumed) {
          assertContained(frame, 960, 540);
          assert.equal(frame.hp, resumeBefore.hp, 'reflow never changes real HP');
          assert.equal(frame.stage, resumeBefore.stage, 'reflow never advances progression');
          assert.ok(!(frame.petImpact && frame.enemyImpact), 'attacks keep exclusive ownership');
        }
      },
      { frames: resumed.length },
    );
    const preview = screenshot ? await screenshot('position-continuity') : undefined;
    assert.deepEqual(failures, [], 'position changes must not restart from the center');
    return { checks, resized, preview, noUserData: true };
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  }
}

module.exports = { checkPositionContinuity };
