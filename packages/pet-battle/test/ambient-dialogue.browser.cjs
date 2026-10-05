// Isolated renderer-only fixture. Fake clock/randomness never reaches Electron or user data.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

function sharedPortraits() {
  const root = path.resolve(__dirname, '../../../apps/desktop/renderer/assets/pets');
  const battleRoot = path.resolve(__dirname, '..');
  const portraits = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('_idle.json')) {
        const sprites = {};
        for (const action of ['idle', 'attack']) {
          const metadataFile = file.replace('_idle.json', `_${action}.json`);
          const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
          sprites[action] = {
            asset: path
              .relative(path.join(battleRoot, 'ui'), metadataFile.replace('.json', '.png'))
              .split(path.sep)
              .join('/'),
            frameCount: metadata.frameCount,
          };
        }
        portraits.push({
          label: path.relative(root, directory).split(path.sep).join(':'),
          sprites,
        });
      }
    }
  }
  visit(root);
  assert.ok(portraits.length >= 18, 'inspect all currently shared pet/stage assets');
  return portraits;
}

function inspectDialogue() {
  const root = document.querySelector('#battle-overlay');
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const rootRect = rect(root);
  const opaque = (image, viewport, strip = false) => {
    if (!image.complete || image.naturalHeight === 0) return null;
    const width = strip ? image.naturalHeight : image.naturalWidth;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, canvas.height);
    let left = width,
      right = 0,
      top = canvas.height,
      bottom = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
    const target = rect(viewport);
    return {
      x: target.x + (left / width) * target.width,
      right: target.x + (right / width) * target.width,
      y: target.y + (top / canvas.height) * target.height,
      bottom: target.y + (bottom / canvas.height) * target.height,
    };
  };
  const content = {
    x: rootRect.x + root.clientLeft,
    y: rootRect.y + root.clientTop,
    width: root.clientWidth,
    height: root.clientHeight,
  };
  return {
    content,
    actorSources: {
      PET: document.querySelector('#pet-sheet').currentSrc,
      ENEMY: document.querySelector('#enemy-image').currentSrc,
    },
    opaqueActors: {
      PET: opaque(
        document.querySelector('#pet-sheet'),
        document.querySelector('.pet-viewport'),
        true,
      ),
      ENEMY: opaque(document.querySelector('#enemy-image'), document.querySelector('#enemy-image')),
    },
    hp: rect(document.querySelector('.enemy-hp')),
    panels: [...document.querySelectorAll('[data-ambient-side]')].map((panel) => ({
      side: panel.dataset.ambientSide,
      hidden: panel.hidden,
      rect: rect(panel),
      rows: [...panel.querySelectorAll('.ambient-log-entry')].map((row) => {
        const portrait = row.querySelector('.ambient-log-portrait');
        const crop = row.querySelector('.ambient-portrait-crop');
        const image = portrait?.querySelector('img');
        const text = row.querySelector('.ambient-log-text');
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const transform = image ? new DOMMatrixReadOnly(getComputedStyle(image).transform) : null;
        return {
          id: row.dataset.logId,
          text: text?.textContent,
          rect: rect(row),
          textRect: text && rect(text),
          // scrollWidth includes the deliberately protruding speech tail.
          // A DOM Range measures actual glyph lines, independent of pseudo-elements.
          textLines:
            text &&
            [...range.getClientRects()].map((r) => ({
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
            })),
          textOverflow: text && {
            x: text.scrollWidth - text.clientWidth,
            y: text.scrollHeight - text.clientHeight,
          },
          portrait: portrait && rect(portrait),
          crop: crop && {
            rect: rect(crop),
            x: Number(crop.dataset.x),
            y: Number(crop.dataset.y),
            width: Number(crop.dataset.width),
            height: Number(crop.dataset.height),
            scale: Number(crop.dataset.scale),
            overflow: getComputedStyle(crop).overflow,
          },
          image: image && {
            source: image.src,
            currentSource: image.currentSrc,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            rect: rect(image),
            x: transform.m41,
            y: transform.m42,
            animation: getComputedStyle(image).animationName,
            visibility: getComputedStyle(image).visibility,
          },
        };
      }),
    })),
  };
}

function assertDialogue(snapshot, expectedCount, label) {
  const { content, panels, hp } = snapshot;
  assert.equal(panels.length, 2, `${label}: pet and enemy panels exist`);
  for (const panel of panels) {
    assert.equal(panel.hidden, false, `${label}: ${panel.side} visible`);
    assert.equal(panel.rows.length, expectedCount, `${label}: at most five independent rows`);
    assert.ok(Math.abs(panel.rect.y - content.y - 48) <= 1, `${label}: dialogue starts below HP`);
    assert.ok(panel.rect.y >= hp.bottom + 8, `${label}: HP bar clearance`);
    const margin =
      panel.side === 'PET'
        ? panel.rect.x - content.x
        : content.x + content.width - panel.rect.right;
    assert.ok(Math.abs(margin - 16) <= 1, `${label}: ${panel.side} stays 16px from its edge`);
    assert.ok(panel.rect.bottom <= content.y + content.height, `${label}: panel fits window`);
    assert.equal(
      new Set(panel.rows.map((row) => row.text)).size,
      panel.rows.length,
      `${label}: no visible duplicate text`,
    );
    for (const row of panel.rows) {
      assert.ok(
        row.text && !/^(펫|적)(이|의)\s/.test(row.text),
        `${label}: speech is first-person, not narration`,
      );
      assert.ok(
        row.textLines.length > 0 &&
          row.textLines.every(
            (line) =>
              line.x >= row.textRect.x + 1 &&
              line.right <= row.textRect.right - 1 &&
              line.y >= row.textRect.y + 1 &&
              line.bottom <= row.textRect.bottom - 1,
          ),
        `${label}: complete dialogue fits: ${row.text} ${JSON.stringify(row.textLines)}`,
      );
      assert.ok(
        row.rect.x >= panel.rect.x - 1 && row.rect.right <= panel.rect.right + 1,
        `${label}: row stays inside panel`,
      );
      assert.ok(
        row.rect.y >= panel.rect.y - 1 && row.rect.bottom <= panel.rect.bottom + 1,
        `${label}: five rows fit panel height`,
      );
      for (const [actor, body] of Object.entries(snapshot.opaqueActors)) {
        assert.ok(body, `${label}: ${actor} bitmap loaded for independent body bounds`);
        const overlapX =
          Math.min(row.textRect.right, body.right) - Math.max(row.textRect.x, body.x);
        const overlapY =
          Math.min(row.textRect.bottom, body.bottom) - Math.max(row.textRect.y, body.y);
        assert.ok(
          overlapX <= 0 || overlapY <= 0,
          `${label}: speech overlaps paused ${actor} opaque pixels by ${overlapX}x${overlapY}px`,
        );
      }
      assert.ok(row.portrait && row.crop && row.image, `${label}: every line has its own face`);
      if (panel.side === 'PET')
        assert.ok(row.portrait.right <= row.textRect.x + 1, `${label}: pet face is left of speech`);
      else
        assert.ok(
          row.textRect.right <= row.portrait.x + 1,
          `${label}: enemy face is right of speech`,
        );
      const { crop, image } = row;
      assert.equal(image.complete, true, `${label}: portrait image loaded`);
      assert.equal(image.visibility, 'visible', `${label}: loaded face is actually shown`);
      assert.equal(
        image.currentSource,
        snapshot.actorSources[panel.side],
        `${label}: every speech face belongs to the current visible character`,
      );
      assert.ok(
        image.naturalWidth > 0 && image.naturalHeight > 0,
        `${label}: portrait pixels exist`,
      );
      assert.ok(
        crop.height > 0 && crop.height < image.naturalHeight,
        `${label}: face crop excludes full body`,
      );
      assert.ok(
        crop.width > 0 && crop.width <= image.naturalHeight,
        `${label}: crop stays in the first square frame`,
      );
      assert.ok(
        crop.x >= 0 &&
          crop.x + crop.width <= image.naturalHeight &&
          crop.y >= 0 &&
          crop.y + crop.height <= image.naturalHeight,
        `${label}: crop inside first frame`,
      );
      assert.ok(
        Math.abs(crop.rect.width - crop.width * crop.scale) <= 1 &&
          Math.abs(crop.rect.height - crop.height * crop.scale) <= 1,
        `${label}: native crop is actually clipped`,
      );
      assert.ok(
        ['hidden', 'clip'].includes(crop.overflow),
        `${label}: sprite outside face is hidden`,
      );
      assert.ok(
        Math.abs(image.x + crop.x * crop.scale) <= 0.01 &&
          Math.abs(image.y + crop.y * crop.scale) <= 0.01,
        `${label}: image matches its declared face crop`,
      );
      assert.equal(
        image.animation,
        'none',
        `${label}: portrait cannot drift into another sprite frame`,
      );
    }
  }
  assert.ok(
    panels[0].rect.right + 8 <= panels[1].rect.x,
    `${label}: left and right speech never overlap`,
  );
}

async function checkAmbientDialogue(cdp, evaluate, waitFor, screenshot) {
  const fixture = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      window.__ambientNow = 100000;
      window.__ambientRandom = 0.5;
      Date.now = () => window.__ambientNow;
      Math.random = () => window.__ambientRandom;
      const ready = Promise.all([
        import('/packages/pet-battle/dist/testing/demo-gateway.js'),
        import('/packages/pet-battle/dist/view/ambient-logs.js'),
      ]).then(async ([{ DemoBattleGateway }, { AMBIENT_MESSAGES }]) => {
        const { state } = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        state.activePet.battleMode = 'PAUSED';
        state.preview.menu = 'CLOSED';
        state.preview.petAction = null;
        state.preview.petAssetRarity = null;
        state.spectatorPetIds = [];
        window.__ambientFixture = state;
        window.__ambientMessages = AMBIENT_MESSAGES;
      });
      window.petBattle = { execute: async () => {
        await ready;
        return { state: structuredClone(window.__ambientFixture), events: [] };
      } };
    })();`,
  });
  const snapshot = () => evaluate(`(${inspectDialogue})()`);
  const rowSelector = (side) => `[data-ambient-side=${side}] .ambient-log-entry`;
  const waitPortraits = () =>
    waitFor(
      "[...document.querySelectorAll('.ambient-log-portrait img')].every(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility === 'visible')",
      'all speech faces loaded',
    );
  const advance = async (phraseIndex) => {
    const expected = await evaluate(`(() => {
      const visible = [...document.querySelectorAll('[data-ambient-side=PET] .ambient-log-text')].map(node => node.textContent);
      const candidates = window.__ambientMessages.PET.filter(text => !visible.includes(text));
      const text = window.__ambientMessages.PET[${phraseIndex}];
      const index = candidates.indexOf(text);
      if (index < 0) throw new Error('Fixture requested an already visible phrase');
      window.__ambientRandom = (index + 0.25) / candidates.length;
      window.__ambientNow += 20001;
      return { pet: text, enemy: window.__ambientMessages.ENEMY[${phraseIndex}] };
    })()`);
    await waitFor(
      `document.querySelector('${rowSelector('PET')}:last-child .ambient-log-text')?.textContent === ${JSON.stringify(expected.pet)} && document.querySelector('${rowSelector('ENEMY')}:last-child .ambient-log-text')?.textContent === ${JSON.stringify(expected.enemy)}`,
      'one new speech per side after clock step',
    );
    await waitFor(
      "[...document.querySelectorAll('.ambient-log-entry')].every(row => getComputedStyle(row).transform === 'none' || new DOMMatrixReadOnly(getComputedStyle(row).transform).m42 === 0)",
      'speech entry pop animation settled',
    );
    await waitPortraits();
    return snapshot();
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
      'speech responsive layout settled',
    );
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  };
  try {
    await resize(544, 420);
    await cdp.send('Page.reload');
    await waitFor(
      "Boolean(window.__ambientFixture && window.__ambientMessages && !document.querySelector('[data-ambient-side=PET]')?.hidden)",
      'isolated speech fixture ready',
    );
    const messages = await evaluate('window.__ambientMessages');
    assert.equal(messages.PET.length, 20);
    assert.equal(messages.ENEMY.length, 20);
    const seen = { PET: new Set(), ENEMY: new Set() };
    let previous;
    for (let index = 0; index < 20; index++) {
      const current = await advance(index);
      assertDialogue(current, Math.min(index + 1, 5), `phrase ${index + 1}`);
      for (const panel of current.panels) {
        panel.rows.forEach((row) => seen[panel.side].add(row.text));
        if (index >= 5)
          assert.deepEqual(
            panel.rows.slice(0, 4).map((row) => row.id),
            previous.panels
              .find((item) => item.side === panel.side)
              .rows.slice(1)
              .map((row) => row.id),
            'oldest speech is evicted, newest stays',
          );
      }
      previous = current;
    }
    assert.equal(seen.PET.size, 20);
    assert.equal(seen.ENEMY.size, 20);
    const sizes = [];
    const screenshots = [];
    for (const [width, height, visible] of [
      [360, 180, false],
      [544, 324, false],
      [544, 420, true],
      [640, 420, true],
      [960, 540, true],
    ]) {
      await resize(width, height);
      await waitFor(
        `[...document.querySelectorAll('[data-ambient-side]')].every(panel => panel.hidden === ${!visible})`,
        'speech visibility follows window size',
      );
      if (visible)
        await waitFor(
          "[...document.querySelectorAll('.ambient-log-entry')].every(row => getComputedStyle(row).transform === 'none' || new DOMMatrixReadOnly(getComputedStyle(row).transform).m42 === 0)",
          'speech pop after a hidden-to-visible resize settles',
        );
      const current = await snapshot();
      if (visible) assertDialogue(current, 5, `${width}x${height}`);
      sizes.push({ width, height, visible });
      if (visible && (width === 544 || width === 640))
        screenshots.push(await screenshot(`ambient-${width}x${height}-five-dialogues`));
    }
    await resize(640, 420);
    const portraits = sharedPortraits();
    const portraitChecks = [];
    const wizard = portraits.find((item) => item.label === 'epic:star_wizard:stage3');
    assert.ok(wizard, 'final screenshot uses the actual star wizard asset');
    portraits.splice(portraits.indexOf(wizard), 1);
    portraits.push(wizard);
    for (const item of portraits) {
      const id = `ambient-${item.label}`;
      await evaluate(`(() => {
        const state = window.__ambientFixture;
        state.activePet.petId = ${JSON.stringify(id)};
        state.petSprites = { [state.activePet.petId]: ${JSON.stringify(item.sprites)} };
        state.roster = [state.activePet];
      })()`);
      await waitFor(
        `document.querySelector('#pet-sheet').currentSrc.endsWith(${JSON.stringify(path.basename(item.sprites.idle.asset))}) && document.querySelectorAll('${rowSelector('PET')}').length === 0`,
        'active pet replaces previous face/context',
      );
      const current = await advance(0);
      assertDialogue(current, 1, item.label);
      const pet = current.panels.find((panel) => panel.side === 'PET').rows[0];
      assert.ok(
        pet.image.currentSource.endsWith(path.basename(item.sprites.idle.asset)),
        `${item.label}: use current shared idle asset`,
      );
      portraitChecks.push({ label: item.label, crop: pet.crop, source: pet.image.currentSource });
    }
    for (let index = 1; index < 5; index++) await advance(index);
    screenshots.push(await screenshot('ambient-wizard-five-dialogues'));
    const enemyChecks = [];
    for (const hp of [0.6, 0.25]) {
      const before = await snapshot();
      await evaluate(`window.__ambientFixture.enemyHpRatio = ${hp}`);
      const face = hp === 0.6 ? 'worried' : 'exhausted';
      await waitFor(
        `[...document.querySelectorAll('[data-ambient-side=ENEMY] .ambient-log-portrait img')].every(image => image.complete && image.currentSrc.endsWith('red-${face}.png'))`,
        'existing speech faces track current enemy HP',
      );
      const current = await snapshot();
      assertDialogue(current, 5, `enemy ${face}`);
      assert.deepEqual(
        current.panels[1].rows.map((row) => row.id),
        before.panels[1].rows.map((row) => row.id),
        'HP face refresh does not erase existing speech',
      );
      enemyChecks.push({ hp, face, rows: current.panels[1].rows.length });
    }
    for (const color of ['BLUE', 'RAINBOW']) {
      await evaluate(`window.__ambientFixture.preview.enemyColor = ${JSON.stringify(color)}`);
      await waitFor(
        `document.querySelector('#enemy-image').currentSrc.endsWith('${color.toLowerCase()}-exhausted.png') && document.querySelectorAll('${rowSelector('ENEMY')}').length === 0`,
        'new enemy color clears old enemy dialogue',
      );
      // The pet feed remains populated; reset fixture identity to align both
      // independent feeds for the next deterministic set of five phrases.
      await evaluate(
        "window.__ambientFixture.activePet.petId += '-next'; window.__ambientFixture.petSprites[window.__ambientFixture.activePet.petId] = Object.values(window.__ambientFixture.petSprites)[0]",
      );
      await waitFor(
        `document.querySelectorAll('${rowSelector('PET')}').length === 0`,
        'paired fixture contexts reset',
      );
      for (let index = 0; index < 5; index++) await advance(index);
      const current = await snapshot();
      assertDialogue(current, 5, color);
      assert.ok(
        current.panels[1].rows.every((row) =>
          row.image.currentSource.endsWith(`${color.toLowerCase()}-exhausted.png`),
        ),
        'all rows show current enemy color, never a stale avatar',
      );
      enemyChecks.push({ color, rows: current.panels[1].rows.length });
    }
    screenshots.push(await screenshot('ambient-wizard-rainbow-five-dialogues'));
    return {
      phrases: { pet: seen.PET.size, enemy: seen.ENEMY.size },
      oldestEviction: true,
      sizes,
      sharedPetStages: portraitChecks.length,
      portraits: portraitChecks,
      enemyChecks,
      screenshots,
    };
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  }
}

module.exports = { checkAmbientDialogue };
