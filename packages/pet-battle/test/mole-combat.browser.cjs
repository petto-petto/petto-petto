// Actual renderer and all three shared mole assets; run arena.browser.cjs --mole-only.
// The gateway, clock and selection are page-local: never Electron or the user's DB.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function moleSprites(stage) {
  const root = path.resolve(__dirname, '..');
  const directory = path.resolve(
    root,
    `../../apps/desktop/renderer/assets/pets/common/mole_digger/stage${stage}`,
  );
  return Object.fromEntries(
    ['idle', 'attack'].map((action) => {
      const stem = path.join(directory, `pet_003_s${stage}_${action}`);
      const metadata = JSON.parse(readFileSync(`${stem}.json`, 'utf8'));
      return [
        action,
        {
          asset: path.relative(path.join(root, 'ui'), `${stem}.png`).split(path.sep).join('/'),
          frameCount: metadata.frameCount,
        },
      ];
    }),
  );
}

function readMole() {
  const root = document.querySelector('#battle-overlay');
  const pet = document.querySelector('#pet');
  const sheet = document.querySelector('#pet-sheet');
  const enemy = document.querySelector('#enemy-image');
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width };
  };
  const alpha = (image, isSheet) => {
    if (!image.complete || !image.naturalWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const frame = isSheet ? canvas.height : canvas.width;
    let left = frame;
    let right = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (!pixels[(y * canvas.width + x) * 4 + 3]) continue;
        left = Math.min(left, x % frame);
        right = Math.max(right, (x % frame) + 1);
      }
    return { left: left / frame, right: right / frame };
  };
  const petAlpha = alpha(sheet, true);
  const enemyAlpha = alpha(enemy, false);
  const viewport = rect(document.querySelector('.pet-viewport'));
  const enemyBox = rect(enemy);
  const opacity = (selector) => {
    const element = document.querySelector(selector);
    return element ? Number(getComputedStyle(element).opacity) : null;
  };
  const nativeSprite = document.querySelector('.mole-native-sprite');
  const nativeArt = () => {
    if (!nativeSprite || !sheet.complete || !sheet.naturalWidth) return null;
    const source = document.createElement('canvas');
    source.width = source.height = 32;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.drawImage(sheet, 0, 0, 32, 32, 0, 0, 32, 32);
    const original = sourceContext.getImageData(0, 0, 32, 32).data;
    const rendered = nativeSprite
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, nativeSprite.width, nativeSprite.height).data;
    const color = (pixels, offset) => Array.from(pixels.slice(offset, offset + 4)).join(',');
    const palette = new Set();
    for (let index = 0; index < original.length; index += 4)
      if (original[index + 3]) palette.add(color(original, index));
    let fabricatedPixels = 0;
    let changedBodyPixels = 0;
    let visiblePixels = 0;
    for (let y = 0; y < nativeSprite.height; y++) {
      for (let x = 0; x < nativeSprite.width; x++) {
        const offset = (y * nativeSprite.width + x) * 4;
        if (rendered[offset + 3]) {
          visiblePixels++;
          if (!palette.has(color(rendered, offset))) fabricatedPixels++;
        }
        // The left arm belongs to the pet's right-hand screen side. Its face,
        // torso and opposite arm must remain the actual source frame, not a redraw.
        if (x < 20 && color(rendered, offset) !== color(original, (y * 32 + x) * 4))
          changedBodyPixels++;
      }
    }
    return {
      source: nativeSprite.dataset.source,
      evolution: Number(nativeSprite.dataset.evolution),
      width: nativeSprite.width,
      height: nativeSprite.height,
      rendering: getComputedStyle(nativeSprite).imageRendering,
      fabricatedPixels,
      changedBodyPixels,
      visiblePixels,
    };
  };
  return {
    profile: root.dataset.petAnimation,
    phase: root.dataset.molePhase,
    arenaPhase: root.dataset.arenaPhase,
    turn: root.dataset.attackTurn,
    impact: root.dataset.beat === 'IMPACT',
    enemyImpact: root.dataset.enemyImpact === 'true',
    enemyHit: document.querySelector('#enemy').classList.contains('hit-reaction'),
    rarity: root.dataset.effectRarity,
    swordVisible: [...document.querySelectorAll('.slash')].some((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && Number(style.opacity) > 0;
    }),
    depth: parseFloat(getComputedStyle(pet).getPropertyValue('--burrow-depth')),
    nativeOpacity: opacity('.mole-native-sprite'),
    nativeArt: nativeSprite && opacity('.mole-native-sprite') > 0 ? nativeArt() : null,
    viewportVisibility: getComputedStyle(document.querySelector('.pet-viewport')).visibility,
    fabricatedLimbs: document.querySelectorAll('.mole-left-paw, .mole-left-arm').length,
    soil: opacity('.mole-soil'),
    clipping: document.querySelector('.pet-body-clip')
      ? getComputedStyle(document.querySelector('.pet-body-clip')).overflow
      : null,
    pet: rect(pet),
    enemy: rect(document.querySelector('#enemy')),
    world: {
      pet: { x: Number(root.dataset.petWorldX), y: Number(root.dataset.petWorldY) },
      enemy: { x: Number(root.dataset.enemyWorldX), y: Number(root.dataset.enemyWorldY) },
    },
    gap:
      petAlpha && enemyAlpha
        ? enemyBox.x +
          enemyAlpha.left * enemyBox.width -
          (viewport.x + petAlpha.right * viewport.width)
        : null,
    hp: document.querySelector('#enemy-hp-label').textContent,
    stage: document.querySelector('#stage-label').textContent,
    source: sheet.currentSrc,
    petSize: parseFloat(getComputedStyle(pet).width),
    backendPreview: window.__moleState.preview.petAction,
  };
}

function assertSafe(frame, width, height, initial) {
  for (const actor of ['pet', 'enemy']) {
    const box = frame[actor];
    assert.ok(
      box.x >= -0.1 && box.y >= -0.1 && box.right <= width + 0.1 && box.bottom <= height + 0.1,
      `${frame.phase}: ${actor} escaped ${width}x${height}: ${JSON.stringify(box)}`,
    );
  }
  assert.equal(frame.petSize, 96, 'the pet frame stays 96px');
  assert.equal(frame.hp, initial.hp, 'visual slap cannot change real HP');
  assert.equal(frame.stage, initial.stage, 'visual slap cannot change progression');
  assert.equal(frame.fabricatedLimbs, 0, 'no independently drawn CSS arm or glove remains');
  assert.ok(!(frame.impact && frame.enemyImpact), 'attack ownership is exclusive');
  if (frame.nativeOpacity > 0) {
    assert.equal(frame.viewportVisibility, 'hidden', 'native sprite is composited exactly once');
    assert.ok(frame.nativeArt, 'native slap canvas is available');
    assert.equal(frame.nativeArt.source, frame.source, 'slap uses the currently selected sheet');
    assert.equal(frame.nativeArt.width, 48, 'pixel canvas includes space for the native arm');
    assert.equal(frame.nativeArt.height, 32, 'native source frame keeps its original resolution');
    assert.equal(frame.nativeArt.rendering, 'pixelated', 'native pixels remain crisp');
    assert.ok(frame.nativeArt.visiblePixels > 0, 'slap sprite is not blank');
    assert.equal(
      frame.nativeArt.fabricatedPixels,
      0,
      'every slap pixel comes from the native palette',
    );
    assert.equal(frame.nativeArt.changedBodyPixels, 0, 'face, body and opposite arm stay native');
  }
  if (frame.depth === 0 && frame.gap !== null)
    assert.ok(frame.gap >= -0.1, `${frame.phase}: opaque bodies overlap by ${-frame.gap}px`);
  if (frame.impact) {
    assert.equal(frame.turn, 'PET');
    assert.equal(frame.enemyHit, true, 'slap contact triggers the shared enemy hit reaction');
    assert.equal(frame.swordVisible, false, `${frame.rarity}: a mole slap must not become a sword`);
    assert.equal(frame.nativeOpacity, 1, 'contact uses the actual native left arm');
  }
}

function assertRestored(frame, label) {
  assert.equal(frame.phase, 'IDLE', `${label}: mole phase is cleared`);
  assert.equal(frame.depth, 0, `${label}: pet cannot remain underground`);
  assert.equal(frame.nativeOpacity, 0, `${label}: native slap has no stale overlay`);
  assert.equal(
    frame.viewportVisibility,
    'visible',
    `${label}: restore the complete native idle sprite`,
  );
  assert.equal(frame.soil, 0, `${label}: dirt has no stale overlay`);
  assert.equal(frame.impact, false, `${label}: no late pet hit`);
}

async function checkMoleCombat(cdp, evaluate, waitFor, screenshot) {
  const sprites = [1, 2, 3].map(moleSprites);
  const fixture = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      window.__moleNow = 100000;
      Date.now = () => window.__moleNow;
      Math.random = () => 0.25;
      window.__moleVersion = 0;
      window.__moleOptions = { species: 'mole_digger', evolution: 0, running: false,
        reduced: false, fallback: false, id: 'mole-fixture-1' };
      const sprites = ${JSON.stringify(sprites)};
      const ready = import('/packages/pet-battle/dist/testing/demo-gateway.js')
        .then(({ DemoBattleGateway }) => new DemoBattleGateway());
      window.petBattle = { execute: async command => {
        const gateway = await ready;
        const options = window.__moleOptions;
        if (command.type === 'SET_BATTLE_RUNNING') options.running = command.running;
        const result = await gateway.execute(command);
        Object.assign(result.state.activePet, { petId: options.id, sprite: options.species,
          evolutionStage: options.evolution, battleMode: options.running ? 'FIGHTING' : 'PAUSED' });
        result.state.petSprites = { [options.id]: sprites[options.evolution] };
        result.state.preview.reducedMotion = options.reduced;
        result.state.preview.petAssetRarity = options.fallback ? 'COMMON' : null;
        result.state.spectatorPetIds = [];
        window.__moleState = structuredClone(result.state);
        window.__moleDelivered = window.__moleVersion;
        return result;
      } };
    })();`,
  });
  const settle = () =>
    evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const read = () => evaluate(`(${readMole})()`);
  const step = async (ms) => {
    await evaluate(`window.__moleNow += ${ms}`);
    await settle();
    return read();
  };
  const update = async (options) => {
    const version = await evaluate(`(() => {
      Object.assign(window.__moleOptions, ${JSON.stringify(options)});
      return ++window.__moleVersion;
    })()`);
    await waitFor(`window.__moleDelivered === ${version}`, 'mole fixture selection delivered');
    await settle();
    return read();
  };
  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await settle();
  };
  const menu = async (open) => {
    if ((await evaluate("document.querySelector('#pet-menu').hidden")) === open)
      await click('#pet');
    await waitFor(`document.querySelector('#pet-menu').hidden === ${!open}`, 'pet menu state');
  };
  const resize = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `innerWidth === ${width} && document.querySelector('#battle-world').clientWidth === ${width + 60}`,
      'mole viewport resized',
    );
    await settle();
  };
  const begin = async (action = 'ATTACK') => {
    await menu(true);
    await click(`[data-action="${action}"]`);
    await waitFor(
      "document.querySelector('#battle-overlay').dataset.molePhase === 'DIG'",
      'manual mole cycle starts with digging',
    );
    return read();
  };
  const screenshots = [];
  const results = [];
  try {
    await cdp.send('Page.reload');
    await waitFor(
      "Boolean(window.__moleState && document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth && document.querySelector('#battle-overlay')?.dataset.petAnimation)",
      'actual shared mole renderer ready',
    );
    for (const [evolution, width, height] of [
      [0, 360, 180],
      [1, 640, 420],
      [2, 960, 540],
    ]) {
      await resize(width, height);
      await update({ evolution, id: `mole-fixture-${evolution + 1}` });
      await waitFor(
        `document.querySelector('#pet-sheet').complete && document.querySelector('#pet-sheet').currentSrc.endsWith('pet_003_s${evolution + 1}_idle.png')`,
        `mole stage ${evolution + 1} idle asset decoded`,
      );
      const before = await read();
      assert.equal(before.profile, 'mole', 'actual selected mole uses its registered profile');
      const frames = [await begin(evolution === 1 ? 'ATTACK_EFFECT' : 'ATTACK')];
      const captured = new Set();
      for (let index = 0; index < 90; index++) {
        const frame = await step(40);
        frames.push(frame);
        assertSafe(frame, width, height, before);
        if (
          (['WINDUP', 'SLAP'].includes(frame.phase) ||
            (evolution === 0 && ['TUNNEL', 'RESURFACE'].includes(frame.phase))) &&
          !captured.has(frame.phase)
        ) {
          captured.add(frame.phase);
          if (screenshot)
            screenshots.push(
              await screenshot(`mole-stage${evolution + 1}-${frame.phase.toLowerCase()}`),
            );
        }
        if (frame.phase === 'IDLE') break;
      }
      const phases = [...new Set(frames.map((frame) => frame.phase))];
      assert.deepEqual(
        phases,
        [
          'DIG',
          'TUNNEL',
          'EMERGE',
          'WINDUP',
          'SLAP',
          'DIVE',
          'RETURN',
          'RESURFACE',
          'SETTLE',
          'IDLE',
        ],
        `stage ${evolution + 1}: full ordered ground-level mole sequence`,
      );
      const hits = frames.filter((frame, index) => frame.impact && !frames[index - 1]?.impact);
      assert.equal(hits.length, 1, 'manual cycle produces exactly one contact');
      assert.ok(
        frames.some((frame) => frame.phase === 'SLAP' && frame.nativeOpacity > 0),
        'visible actual-native-left-arm slap',
      );
      for (const frame of frames.filter((item) => item.nativeOpacity > 0))
        assert.equal(
          frame.nativeArt.evolution,
          evolution,
          'native arm matches the selected evolution',
        );
      assert.ok(
        frames.some((frame) => frame.phase === 'DIG' && frame.soil > 0),
        'pixel dirt while digging',
      );
      for (const frame of frames.filter((item) => ['TUNNEL', 'RETURN'].includes(item.phase))) {
        assert.ok(frame.depth >= 96, 'underground body is fully below the ground clip');
        assert.ok(
          ['hidden', 'clip'].includes(frame.clipping),
          'ground clipping is real, not opacity',
        );
      }
      assert.ok(
        frames.some(
          (frame) => frame.backendPreview === null && !['IDLE', 'DIG'].includes(frame.phase),
        ),
        'local mole motion outlives the backend 960ms preview without truncation',
      );
      const after = frames.at(-1);
      assertRestored(after, 'completed manual cycle');
      assert.ok(Math.abs(after.world.pet.x - before.world.pet.x) < 0.1, 'return to cycle origin x');
      assert.ok(
        Math.abs(after.world.pet.y - before.world.pet.y) < 0.1,
        'return to cycle origin ground y',
      );
      for (let index = 0; index < 6; index++)
        assertRestored(await step(100), 'manual stays one-shot');
      results.push({ evolution, width, height, phases, contacts: hits.length });
    }

    await resize(640, 420);
    await update({ evolution: 0, id: 'mole-effects' });
    const rarities = [];
    for (let effect = 0; effect < 3; effect++) {
      const initial = await begin('ATTACK_EFFECT');
      let contact;
      for (let index = 0; index < 70; index++) {
        const frame = await step(40);
        assertSafe(frame, 640, 420, initial);
        if (frame.impact) contact = frame;
        if (frame.phase === 'IDLE') break;
      }
      assert.ok(contact, 'each rarity preview reaches the same hand contact');
      rarities.push(contact.rarity);
    }
    assert.deepEqual(new Set(rarities), new Set(['COMMON', 'RARE', 'EPIC']));
    await update({ evolution: 0, id: 'mole-resize' });
    await begin();
    let tunnel;
    for (let index = 0; index < 20; index++) {
      tunnel = await step(40);
      if (tunnel.phase === 'TUNNEL') break;
    }
    assert.equal(tunnel.phase, 'TUNNEL');
    await resize(840, 420);
    const resized = await read();
    assert.equal(resized.phase, tunnel.phase, 'resize preserves the current digging cycle');
    assert.equal(resized.world.pet.x, tunnel.world.pet.x, 'resize must not recenter the pet');
    await resize(360, 180);
    for (let index = 0; index < 75; index++) {
      const frame = await step(40);
      assertSafe(frame, 360, 180, tunnel);
      if (frame.phase === 'IDLE') break;
    }
    assertRestored(await read(), 'resized cycle completes');

    const cancellations = [
      ...['STOP', 'MENU', 'HIDDEN', 'DEFEAT', 'SPECIES'].map((control) => [control, 'TUNNEL']),
      ...['STOP', 'MENU', 'SPECIES'].map((control) => [control, 'WINDUP']),
    ];
    for (const [control, cancelPhase] of cancellations) {
      const label = `${control} during ${cancelPhase}`;
      await update({
        species: 'mole_digger',
        id: `mole-cancel-${control}-${cancelPhase}`,
        running: false,
      });
      await begin();
      let interrupted;
      for (let index = 0; index < 35; index++) {
        interrupted = await step(40);
        if (interrupted.phase === cancelPhase) break;
      }
      assert.equal(
        interrupted.phase,
        cancelPhase,
        `${label}: requested cancellation phase reached`,
      );
      if (cancelPhase === 'WINDUP')
        assert.equal(
          interrupted.nativeOpacity,
          1,
          'cancellation starts with the native canvas visible',
        );
      if (control === 'STOP') await click('[data-action="STOP"]');
      else if (control === 'MENU') await click('#pet');
      else if (control === 'HIDDEN') {
        await evaluate(`(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        })()`);
        await step(300);
        await evaluate(`(() => {
          delete document.hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        })()`);
      } else if (control === 'DEFEAT') await click('[data-action="DEFEAT"]');
      else await update({ species: 'unregistered_new_pet', id: 'unknown-pet' });
      for (let index = 0; index < 30; index++) assertRestored(await step(100), label);
      if (control === 'DEFEAT') await click('[data-action="RESET"]');
    }

    await update({ species: 'mole_digger', id: 'mole-fallback', fallback: true });
    assert.equal(
      (await read()).profile,
      'default',
      'fallback sprout artwork must not tunnel as a mole',
    );
    await update({ fallback: false, reduced: true, id: 'mole-reduced' });
    await menu(true);
    await click('[data-action="ATTACK"]');
    const reduced = [];
    for (let index = 0; index < 65; index++) {
      const frame = await step(40);
      reduced.push(frame);
      assert.equal(frame.depth, 0, 'reduced motion never tunnels');
      assert.equal(frame.soil, 0, 'reduced motion omits decorative dirt');
    }
    assert.equal(
      reduced.filter((frame, index) => frame.impact && !reduced[index - 1]?.impact).length,
      1,
    );
    assertRestored(reduced.at(-1), 'reduced preview completes');

    await resize(640, 420);
    await update({ reduced: false, id: 'mole-auto' });
    await click('[data-action="START"]');
    await menu(false);
    const automatic = [];
    for (let index = 0; index < 220; index++) {
      const frame = await step(100);
      automatic.push(frame);
      assertSafe(frame, 640, 420, automatic[0]);
      const contacts = automatic.filter((item, i) => item.impact && !automatic[i - 1]?.impact);
      if (contacts.length >= 2 && automatic.some((item) => item.enemyImpact)) break;
    }
    assert.ok(
      automatic.some((frame) => frame.enemyImpact),
      'enemy retains its own slam turn',
    );
    assert.ok(
      automatic.filter((frame, index) => frame.impact && !automatic[index - 1]?.impact).length >= 2,
      'automatic battle repeats the mole cycle',
    );
    assert.ok(
      automatic.some((frame) => frame.phase === 'TUNNEL'),
      'automatic uses the same burrow profile',
    );
    let interrupted;
    for (let index = 0; index < 100; index++) {
      interrupted = await step(100);
      if (interrupted.phase === 'TUNNEL') break;
    }
    assert.equal(interrupted.phase, 'TUNNEL');
    await menu(true);
    for (let index = 0; index < 30; index++) assertRestored(await step(100), 'open automatic menu');
    return {
      results,
      rarities,
      screenshots,
      automaticFrames: automatic.length,
      cancellation: [
        ...cancellations.map(([control, phase]) => `${control}:${phase}`),
        'AUTO_MENU',
      ],
      noUserData: true,
    };
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  }
}

module.exports = { checkMoleCombat };
