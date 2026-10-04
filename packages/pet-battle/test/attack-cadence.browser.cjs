// Renderer regression fixture, run through arena.browser.cjs --cadence-only.
// Only the isolated page's Date.now is controlled; user data and Electron are never opened.
const assert = require('node:assert/strict');

async function checkAttackCadence(cdp, evaluate, waitFor) {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.protocol !== 'http:') throw new Error('Fixture requires isolated HTTP');
      window.__cadenceNow = 100000;
      Date.now = () => window.__cadenceNow;
      const ready = import('/packages/pet-battle/dist/ui/demo-gateway.js').then(async ({ DemoBattleGateway }) => {
        const result = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        window.__cadenceFixture = result.state;
      });
      window.petBattle = { execute: async () => {
        await ready;
        window.__cadenceDeliveredId = window.__cadenceFixture.activePet.petId;
        return { state: structuredClone(window.__cadenceFixture), events: [] };
      } };
    })();`,
  });
  await cdp.send('Page.reload');
  await waitFor(
    "Boolean(window.__cadenceFixture && document.querySelector('#battle-overlay')?.dataset.arenaPhase)",
    'isolated attack cadence fixture',
  );
  const step = (gap) =>
    evaluate(`(async () => {
      window.__cadenceNow += ${gap};
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const root = document.querySelector('#battle-overlay');
      const sheet = document.querySelector('#pet-sheet');
      return {
        at: window.__cadenceNow,
        phase: root.dataset.arenaPhase,
        turn: root.dataset.attackTurn,
        inRange: root.dataset.inAttackRange === 'true',
        petAttackSheet: sheet.src.endsWith('-attack.png') && sheet.classList.contains('animated-sheet'),
        petImpact: root.dataset.beat === 'IMPACT',
        hitReaction: document.querySelector('#enemy').classList.contains('hit-reaction'),
        enemyImpact: root.dataset.enemyImpact === 'true',
        slamEffect: document.querySelector('.enemy-slam').classList.contains('active'),
        petWalking: root.dataset.petWalking === 'true',
        enemyWalking: root.dataset.enemyWalking === 'true',
        petSize: parseFloat(getComputedStyle(root).getPropertyValue('--pet-size')),
        hp: document.querySelector('#enemy-hp-label').textContent,
        stage: document.querySelector('#stage-label').textContent,
      };
    })()`);
  const results = [];
  for (const [width, height, hp, size] of [
    [360, 180, 1, 'SMALL'],
    [640, 420, 0.6, 'LARGE'],
    [960, 540, 0.25, 'MEDIUM'],
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`(() => {
      const state = window.__cadenceFixture;
      state.activePet.petId = ${JSON.stringify(`cadence-${width}-${hp}`)};
      state.enemyHpRatio = ${hp};
      state.preview.enemySize = ${JSON.stringify(size)};
    })()`);
    await waitFor(
      `window.__cadenceDeliveredId === ${JSON.stringify(`cadence-${width}-${hp}`)} && document.querySelector('#enemy-hp-label').textContent === '${Math.round(hp * 100)}%' && ['RETREAT', 'CHASE'].includes(document.querySelector('#battle-overlay').dataset.arenaPhase) && document.querySelector('#battle-world').clientWidth === ${width + 60}`,
      'cadence identity and viewport reset',
    );
    const initial = await step(0);
    const frames = [];
    // Travel is distance/speed-driven now, not a fixed 8,040ms cycle. Give the
    // slow injured enemy enough real elapsed time before testing stalled beats.
    for (let index = 0; index < 36; index++) frames.push(await step(1000));
    for (const frame of frames) {
      assert.equal(frame.petSize, 96, 'frame gaps must not resize the pet');
      assert.equal(frame.hp, initial.hp, 'choreography must not change real HP');
      assert.equal(frame.stage, initial.stage, 'choreography must not advance the stage');
      assert.ok(!(frame.petImpact && frame.enemyImpact), 'both actors cannot hit simultaneously');
      if (frame.turn) {
        assert.equal(frame.inRange, true, 'attacks require ground contact range');
        assert.equal(frame.petWalking, false, 'walking yields to the attack owner');
        assert.equal(frame.enemyWalking, false, 'walking yields to the attack owner');
      }
      if (frame.petImpact) {
        assert.equal(frame.turn, 'PET');
        assert.equal(frame.petAttackSheet, true, 'pet impact has a visible attack sprite');
        assert.equal(frame.hitReaction, true, 'pet impact reaches the enemy hit effect');
        assert.equal(frame.slamEffect, false, 'enemy cannot slam during the pet turn');
      }
      if (frame.enemyImpact) {
        assert.equal(frame.turn, 'ENEMY');
        assert.equal(frame.slamEffect, true, 'enemy impact reaches the visible slam effect');
        assert.equal(frame.petAttackSheet, false, 'pet cannot attack during the enemy turn');
      }
    }
    assert.ok(
      frames.some((frame) => frame.petAttackSheet && frame.turn === 'PET'),
      `${width}x${height}: a render stall must not skip the pet attack animation`,
    );
    assert.ok(
      frames.some((frame) => frame.petImpact && frame.hitReaction),
      `${width}x${height}: a render stall must not skip every pet hit`,
    );
    assert.ok(
      frames.some((frame) => frame.enemyImpact && frame.slamEffect),
      `${width}x${height}: a render stall must not skip every enemy slam`,
    );
    results.push({ width, height, hp, frames });
  }
  for (const control of ['STOP', 'MENU']) {
    await evaluate(
      control === 'STOP'
        ? "window.__cadenceFixture.activePet.battleMode = 'PAUSED'"
        : "window.__cadenceFixture.preview.menu = 'PET'",
    );
    await waitFor(
      "document.querySelector('#battle-overlay').dataset.arenaPhase === 'IDLE' && document.querySelector('#battle-overlay').dataset.attackTurn === ''",
      `${control} suppresses attack ownership`,
    );
    const frame = await step(1000);
    assert.equal(frame.turn, '', `${control} cannot replay a skipped attack`);
    assert.equal(frame.petImpact, false);
    assert.equal(frame.enemyImpact, false);
    await evaluate(
      control === 'STOP'
        ? "window.__cadenceFixture.activePet.battleMode = 'FIGHTING'"
        : "window.__cadenceFixture.preview.menu = 'CLOSED'",
    );
    await waitFor(
      control === 'STOP'
        ? "document.querySelector('[data-action=START]').textContent === 'ON'"
        : "document.querySelector('#pet-menu').hidden",
      `${control} releases fixture pause`,
    );
  }
  return { frameGapMs: 1000, results, stopAndMenuSuppressImpacts: true };
}

module.exports = { checkAttackCadence };
