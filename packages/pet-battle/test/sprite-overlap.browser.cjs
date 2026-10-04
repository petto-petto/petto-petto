// Actual renderer + delayed local PNGs; run via arena.browser.cjs --sprite-only.
// No Electron, external service, or user database is opened.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

function sharedSpriteCases() {
  const battleRoot = path.resolve(__dirname, '..');
  const sharedRoot = path.resolve(__dirname, '../../../apps/desktop/renderer/assets/pets');
  const cases = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('_idle.json')) {
        const idle = JSON.parse(readFileSync(file, 'utf8'));
        const attackFile = file.replace('_idle.json', '_attack.json');
        const attack = JSON.parse(readFileSync(attackFile, 'utf8'));
        assert.equal(idle.frameWidth, idle.frameHeight, 'shared idle frames are square');
        assert.equal(attack.frameWidth, attack.frameHeight, 'shared attack frames are square');
        cases.push({
          label: path.relative(sharedRoot, directory).split(path.sep).join(':'),
          frameWidth: idle.frameWidth,
          shared: true,
          sprites: {
            idle: {
              asset: path
                .relative(battleRoot, file.replace('.json', '.png'))
                .split(path.sep)
                .join('/'),
              frameCount: idle.frameCount,
            },
            attack: {
              asset: path
                .relative(battleRoot, attackFile.replace('.json', '.png'))
                .split(path.sep)
                .join('/'),
              frameCount: attack.frameCount,
            },
          },
        });
      }
    }
  }
  visit(sharedRoot);
  assert.ok(cases.length > 0, 'actual shared pet assets must be present');
  return cases;
}

function assertSingleFrames(frames, label) {
  const mismatch = frames.find(
    (frame) => !Number.isFinite(frame.framesVisible) || Math.abs(frame.framesVisible - 1) > 0.001,
  );
  assert.equal(
    mismatch,
    undefined,
    `${label}: one viewport must display exactly one bitmap frame: ${JSON.stringify(mismatch)}`,
  );
  const misaligned = frames.find(
    (frame) =>
      Math.abs(
        frame.translation / frame.frameSize - Math.round(frame.translation / frame.frameSize),
      ) > 0.001,
  );
  assert.equal(
    misaligned,
    undefined,
    `${label}: sprite offset must stay aligned to the 96px crop: ${JSON.stringify(misaligned)}`,
  );
  assert.ok(
    frames.every((frame) => frame.frameSize === 96),
    `${label}: preserve the 96px pet`,
  );
  const croppedOutside = frames.find(
    (frame) =>
      frame.translation > 0.001 ||
      -frame.translation + frame.frameSize > frame.displayedWidth + 0.001,
  );
  assert.equal(
    croppedOutside,
    undefined,
    `${label}: a pending attack must not move the visible crop beyond the retained bitmap: ${JSON.stringify(croppedOutside)}`,
  );
}

function sampleSprite(durationMs) {
  const started = performance.now();
  const frames = [];
  const original = document.querySelector('#pet-sheet');
  let paintedFrameCount = original.naturalWidth / original.naturalHeight;
  return new Promise((resolve) => {
    function frame() {
      const image = document.querySelector('#pet-sheet');
      const style = getComputedStyle(image);
      const viewport = document.querySelector('.pet-viewport');
      const frameSize = parseFloat(getComputedStyle(viewport).width);
      const displayedWidth = parseFloat(style.width);
      const translation = new DOMMatrixReadOnly(style.transform).m41;
      // Chromium retains the previous decoded bitmap while a new src is pending.
      // The new PNG's intrinsic metadata can arrive before decoding completes;
      // those natural dimensions do not yet describe the retained painted strip.
      // Keep the last decoded count, independently of the CSS width under test.
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        paintedFrameCount = image.naturalWidth / image.naturalHeight;
      }
      frames.push({
        at: performance.now() - started,
        source: image.src,
        currentSource: image.currentSrc,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayedWidth,
        frameSize,
        translation,
        paintedFrameCount,
        framesVisible: paintedFrameCount * (frameSize / displayedWidth),
        phase: document.querySelector('#battle-overlay').dataset.arenaPhase,
        walking: document.querySelector('#battle-overlay').dataset.petWalking === 'true',
        animated: image.classList.contains('animated-sheet'),
      });
      if (performance.now() - started >= durationMs) resolve(frames);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

async function checkSpriteOverlap(cdp, evaluate, waitFor, screenshot) {
  const fixture = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      Date.now = () => Math.floor(performance.timeOrigin + performance.now());
      const ready = import('/packages/pet-battle/dist/ui/demo-gateway.js').then(async ({ DemoBattleGateway }) => {
        const result = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        const state = result.state;
        state.activePet.battleMode = 'PAUSED';
        state.spectatorPetIds = [];
        state.preview.petAction = 'ATTACK';
        state.petSprites = { mio: {
          idle: { asset: 'assets/pets/v2/common-idle.png', frameCount: 4 },
          attack: { asset: 'assets/pets/v2/common-attack.png', frameCount: 6 },
        } };
        window.__spriteFixture = state;
      });
      window.petBattle = { execute: async () => {
        await ready;
        return { state: structuredClone(window.__spriteFixture), events: [] };
      } };
    })();`,
  });
  try {
    await cdp.send('Page.reload');
    await waitFor(
      "Boolean(window.__spriteFixture && document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth > 0 && document.querySelector('#pet-sheet').src.endsWith('common-attack.png'))",
      'decoded attack sheet for sprite transition fixture',
    );
    const shared = sharedSpriteCases();
    const cases = [
      ...['common', 'rare', 'epic'].map((rarity) => ({
        label: `fallback:${rarity}`,
        shared: false,
        sprites: {
          idle: { asset: `assets/pets/v2/${rarity}-idle.png`, frameCount: 4 },
          attack: { asset: `assets/pets/v2/${rarity}-attack.png`, frameCount: 6 },
        },
      })),
      ...shared,
    ];
    const results = [];
    const screenshots = [];
    for (const item of cases) {
      await evaluate(`(() => {
        const state = window.__spriteFixture;
        state.preview.petAction = 'ATTACK';
        state.petSprites.mio = ${JSON.stringify(item.sprites)};
      })()`);
      const attackFile = path.basename(item.sprites.attack.asset);
      await waitFor(
        `(() => { const image = document.querySelector('#pet-sheet'); return image.complete && image.currentSrc.endsWith(${JSON.stringify(attackFile)}) && image.naturalWidth / image.naturalHeight === ${item.sprites.attack.frameCount}; })()`,
        `${item.label} attack sheet is actually decoded`,
      );
      const pendingAsset = `${item.sprites.idle.asset}?sprite-delay-ms=650&case=${encodeURIComponent(item.label)}`;
      const pendingSuffix = `${path.basename(item.sprites.idle.asset)}?sprite-delay-ms=650`;
      await evaluate(`(() => {
        window.__spriteFixture.petSprites.mio.idle.asset = ${JSON.stringify(pendingAsset)};
        window.__spriteFixture.preview.petAction = null;
        window.__spriteSampling = (${sampleSprite})(1100);
      })()`);
      await waitFor(
        `document.querySelector('#pet-sheet').src.includes(${JSON.stringify(pendingSuffix)}) && !document.querySelector('#pet-sheet').complete`,
        `${item.label} delayed idle request is pending`,
      );
      if (screenshot && ['fallback:epic', 'epic:star_wizard:stage3'].includes(item.label)) {
        screenshots.push(await screenshot(`sprite-${item.label.replaceAll(':', '-')}-pending`));
      }
      const frames = await evaluate('window.__spriteSampling');
      await waitFor(
        `(() => { const image = document.querySelector('#pet-sheet'); return image.complete && image.currentSrc.includes(${JSON.stringify(pendingSuffix)}) && image.naturalWidth / image.naturalHeight === ${item.sprites.idle.frameCount}; })()`,
        `${item.label} delayed idle sheet eventually displayed`,
      );
      assertSingleFrames(frames, item.label);
      const pendingFrames = frames.filter((frame) => !frame.complete).length;
      assert.ok(pendingFrames > 0, `${item.label}: delayed transition is actually exercised`);
      const pendingAttack = `${item.sprites.attack.asset}?sprite-delay-ms=650&case=inverse-${encodeURIComponent(item.label)}`;
      const pendingAttackSuffix = `${path.basename(item.sprites.attack.asset)}?sprite-delay-ms=650`;
      await evaluate(`(() => {
        window.__spriteFixture.petSprites.mio.attack.asset = ${JSON.stringify(pendingAttack)};
        window.__spriteFixture.preview.petAction = 'ATTACK';
        window.__spriteSampling = (${sampleSprite})(1100);
      })()`);
      await waitFor(
        `document.querySelector('#pet-sheet').src.includes(${JSON.stringify(pendingAttackSuffix)}) && !document.querySelector('#pet-sheet').complete`,
        `${item.label} inverse delayed attack request is pending`,
      );
      const inverseFrames = await evaluate('window.__spriteSampling');
      await waitFor(
        `(() => { const image = document.querySelector('#pet-sheet'); return image.complete && image.currentSrc.includes(${JSON.stringify(pendingAttackSuffix)}) && image.naturalWidth / image.naturalHeight === ${item.sprites.attack.frameCount}; })()`,
        `${item.label} delayed attack sheet eventually displayed`,
      );
      assertSingleFrames(inverseFrames, `${item.label} idle-to-attack`);
      const inversePendingFrames = inverseFrames.filter((frame) => !frame.complete).length;
      assert.ok(inversePendingFrames > 0, `${item.label}: inverse delayed transition is exercised`);
      assert.ok(
        inverseFrames.some((frame) => frame.complete && frame.animated),
        `${item.label}: attack animation resumes after decode`,
      );
      results.push({
        label: item.label,
        samples: frames.length,
        pendingFrames,
        inverseSamples: inverseFrames.length,
        inversePendingFrames,
      });
    }
    const cycles = [];
    for (const frameWidth of [32, 48]) {
      const item = shared.find((candidate) => candidate.frameWidth === frameWidth);
      assert.ok(item, `representative ${frameWidth}px shared sheet exists`);
      await evaluate(`(() => {
        const state = window.__spriteFixture;
        state.petSprites.mio = ${JSON.stringify(item.sprites)};
        state.activePet.battleMode = 'FIGHTING';
        state.preview.petAction = null;
      })()`);
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.petWalking === 'true' && document.querySelector('#pet-sheet').complete",
        `${item.label} normal walking begins`,
      );
      const frames = await evaluate(`(${sampleSprite})(8500)`);
      assertSingleFrames(frames, `${item.label} full walk/attack cycle`);
      assert.ok(
        frames.some((frame) => frame.walking),
        'cycle includes walking',
      );
      assert.ok(
        frames.some((frame) => frame.animated && frame.phase === 'PET_ATTACK'),
        'cycle includes the pet attack',
      );
      await evaluate("window.__spriteFixture.activePet.battleMode = 'PAUSED'");
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.arenaPhase === 'IDLE' && document.querySelector('#battle-overlay').dataset.petWalking === 'false'",
        `${item.label} STOP is applied`,
      );
      const stopped = await evaluate(`(${sampleSprite})(350)`);
      assertSingleFrames(stopped, `${item.label} STOP`);
      assert.ok(
        stopped.every((frame) => !frame.walking && !frame.animated && frame.translation === 0),
        'STOP shows one stationary frame',
      );
      cycles.push({
        label: item.label,
        sourceFrameWidth: frameWidth,
        samples: frames.length,
        stopSamples: stopped.length,
      });
    }
    return {
      delayedTransitions: results.length,
      inverseDelayedTransitions: results.length,
      sharedPetStages: shared.length,
      fallbackPets: cases.length - shared.length,
      totalTransitionSamples: results.reduce((sum, result) => sum + result.samples, 0),
      totalPendingSamples: results.reduce((sum, result) => sum + result.pendingFrames, 0),
      totalInverseSamples: results.reduce((sum, result) => sum + result.inverseSamples, 0),
      totalInversePendingSamples: results.reduce(
        (sum, result) => sum + result.inversePendingFrames,
        0,
      ),
      mismatches: 0,
      cycles,
      screenshots,
    };
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  }
}

module.exports = { checkSpriteOverlap };
