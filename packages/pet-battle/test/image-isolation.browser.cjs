// Real renderer with delayed local images, using arena.browser.cjs --image-isolation-only.
const assert = require('node:assert/strict');

async function checkImageIsolation(cdp, evaluate, waitFor) {
  const fixture = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const ready = import('/packages/pet-battle/dist/ui/demo-gateway.js').then(async ({ DemoBattleGateway }) => {
        const { state } = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        state.activePet.battleMode = 'PAUSED';
        state.spectatorPetIds = [];
        state.preview.petAction = null;
        window.__imageIsolation = state;
      });
      window.petBattle = { execute: async () => {
        await ready;
        return { state: structuredClone(window.__imageIsolation), events: [] };
      } };
    })();`,
  });
  try {
    await cdp.send('Page.reload');
    await waitFor('Boolean(window.__imageIsolation)', 'image fixture ready');
    const results = [];
    for (const mode of ['selection', 'evolution', 'stop']) {
      const previous = `assets/pets/v2/common-attack.png?sprite-delay-ms=1000&isolation=${mode}`;
      await evaluate(`(() => {
        const state = window.__imageIsolation;
        state.activePet.battleMode = ${mode === 'stop' ? "'FIGHTING'" : "'PAUSED'"};
        state.activePet.sprite = 'cheek_hamster';
        state.preview.petAction = null;
        state.petSprites = { [state.activePet.petId]: {
          idle: { asset: 'assets/pets/v2/common-idle.png', frameCount: 4 },
          attack: { asset: ${JSON.stringify(previous)}, frameCount: 6 },
        } };
        window.__oldImageFinished = false;
        const observer = new PerformanceObserver((list) => {
          if (list.getEntries().some((entry) => entry.name.includes(${JSON.stringify(`isolation=${mode}`)}))) {
            window.__oldImageFinished = true;
            observer.disconnect();
          }
        });
        observer.observe({ type: 'resource' });
      })()`);
      await waitFor(
        "document.querySelector('#pet-sheet').src.endsWith('common-idle.png') && document.querySelector('#pet-sheet').complete",
        `${mode}: old pet displayed`,
      );
      // Allow a state poll to initiate the separate attack preload, then switch before it finishes.
      await evaluate('new Promise((resolve) => setTimeout(resolve, 180))');
      assert.equal(await evaluate('window.__oldImageFinished'), false, 'old load is pending');
      await evaluate(`(() => {
        const state = window.__imageIsolation;
        const pet = state.activePet;
        pet.battleMode = 'PAUSED';
        if (${JSON.stringify(mode)} === 'selection') {
          pet.petId = 'new-wizard';
          pet.sprite = 'star_wizard';
        }
        if (${JSON.stringify(mode)} === 'evolution') pet.evolutionStage = 2;
        state.petSprites[pet.petId] = {
          idle: { asset: 'assets/pets/v2/rare-idle.png', frameCount: 4 },
          attack: { asset: 'assets/pets/v2/rare-attack.png', frameCount: 6 },
        };
        state.preview.petAction = null;
      })()`);
      await waitFor(
        "document.querySelector('#pet-sheet').complete && document.querySelector('#pet-sheet').currentSrc.endsWith('rare-idle.png')",
        `${mode}: current idle established after selection`,
      );
      if (mode !== 'stop') {
        await evaluate("window.__imageIsolation.preview.petAction = 'ATTACK'");
      }
      const expected = mode === 'stop' ? 'rare-idle.png' : 'rare-attack.png';
      await waitFor(
        `(() => { const image = document.querySelector('#pet-sheet'); return image.complete && image.currentSrc.endsWith(${JSON.stringify(expected)}); })()`,
        `${mode}: new image displayed`,
      );
      await waitFor('window.__oldImageFinished', `${mode}: old preload actually finished`);
      const frames = await evaluate(`new Promise((resolve) => {
        const frames = [];
        const start = performance.now();
        function sample() {
          const image = document.querySelector('#pet-sheet');
          frames.push(image.currentSrc);
          if (performance.now() - start > 250) resolve(frames);
          else requestAnimationFrame(sample);
        }
        sample();
      })`);
      assert.ok(frames.length > 1);
      assert.ok(
        frames.every((src) => src.endsWith(expected)),
        `${mode}: late result never replaces current image`,
      );
      results.push({ mode, samples: frames.length, oldRequestCompleted: true });
    }
    return results;
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  }
}

module.exports = { checkImageIsolation };
