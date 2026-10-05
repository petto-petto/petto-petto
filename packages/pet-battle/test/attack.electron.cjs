// Build desktop + @pet/battle, then run with Electron (in-process battle engine).
// Uses only a temporary SQLite database and Electron profile, never app user data.
const assert = require('node:assert/strict');
const { accessSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');

const repo = path.resolve(__dirname, '../../..');
const directory =
  process.env.PETTO_BATTLE_TEST_PROFILE ||
  mkdtempSync(path.join(tmpdir(), 'petto-battle-host-smoke-'));
const artifactDirectory = process.env.PETTO_BATTLE_TEST_ARTIFACT_DIR;
app.setPath('userData', directory);
app.setPath('sessionData', directory);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let database;
let closeBattle;
let cleaned = false;

async function within(promise, label, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function evaluate(window, expression) {
  assert.equal(window.isDestroyed(), false, 'battle window must remain alive');
  return within(window.webContents.executeJavaScript(expression), 'renderer response');
}

async function waitFor(window, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(window, expression)) return;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

async function loaded(window) {
  const contents = window.webContents;
  if (contents.getURL().startsWith('file:') && !contents.isLoadingMainFrame()) return;
  let finished;
  let failed;
  try {
    await within(
      new Promise((resolve, reject) => {
        finished = resolve;
        failed = (_event, code, description) => reject(new Error(`${code}: ${description}`));
        contents.once('did-finish-load', finished);
        contents.once('did-fail-load', failed);
      }),
      'host battle document load',
    );
  } finally {
    contents.removeListener('did-finish-load', finished);
    contents.removeListener('did-fail-load', failed);
  }
}

async function click(window, selector) {
  await waitFor(
    window,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return bounds.width > 0 && bounds.height > 0 && hit && element.contains(hit);
    })()`,
    `clickable ${selector}`,
  );
  const point = await evaluate(
    window,
    `(() => {
      const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2)};
    })()`,
  );
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
}

async function petAction(window, action) {
  if (await evaluate(window, 'document.querySelector("#pet-menu").hidden')) {
    await click(window, '#pet');
  }
  await click(window, `[data-action="${action}"]`);
}

function command(window, value) {
  return evaluate(window, `window.petBattle.execute(${JSON.stringify(value)})`);
}

function state(window) {
  return command(window, { type: 'GET_STATE', nowMs: Date.now() }).then((result) => result.state);
}

async function waitForImpact(window) {
  await waitFor(
    window,
    `(() => {
      const root = document.querySelector('#battle-overlay');
      const slash = document.querySelector('.slash');
      if (!root || !slash) return false;
      const bounds = slash.getBoundingClientRect();
      return root.dataset.beat === 'IMPACT' && Number(getComputedStyle(slash).opacity) > 0 &&
        bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
        document.querySelector('#pet-sheet').classList.contains('animated-sheet');
    })()`,
    'visible attack sprite and slash',
    15_000,
  );
}

const stoppedExpression = `(() => {
  const root = document.querySelector('#battle-overlay');
  const slash = document.querySelector('.slash');
  return root.dataset.beat === 'IDLE' && Number(getComputedStyle(slash).opacity) === 0 &&
    !document.querySelector('#pet-sheet').classList.contains('animated-sheet');
})()`;

async function verifyStopped(window) {
  await waitFor(window, stoppedExpression, 'stopped animation');
  assert.equal((await state(window)).activePet.battleMode, 'PAUSED');
  // This bounded observation asserts that motion stays stopped, not just one idle frame.
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    assert.equal(await evaluate(window, stoppedExpression), true, 'STOP must remain effective');
    await delay(25);
  }
}

async function verifyAttack(window, label) {
  const decodedAssets = `['#battle-background', '#enemy-image', '#pet-sheet'].every(selector => {
    const image = document.querySelector(selector);
    return image?.complete && image.naturalWidth > 0;
  })`;
  try {
    await waitFor(window, decodedAssets, 'background, enemy and pet assets decoded');
  } catch (error) {
    const diagnostics = await evaluate(
      window,
      `({url: location.href, notice: document.querySelector('#battle-notice')?.textContent,
        images: ['#battle-background', '#enemy-image', '#pet-sheet'].map(selector => {
          const image = document.querySelector(selector);
          return {selector, src: image?.src, complete: image?.complete,
            naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight};
        })})`,
    );
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }
  await waitForImpact(window);
  await petAction(window, 'STOP');
  await waitFor(
    window,
    'document.querySelector("[data-action=STOP]").textContent === "OFF"',
    'STOP response',
  );
  await verifyStopped(window);
  await petAction(window, 'START');
  await waitFor(window, 'document.querySelector("#pet-menu").hidden', 'START closes menu');
  await waitForImpact(window);
  assert.equal((await state(window)).activePet.battleMode, 'FIGHTING');
  await petAction(window, 'STOP');
  await waitFor(
    window,
    'document.querySelector("[data-action=STOP]").textContent === "OFF"',
    'second STOP response',
  );
  await verifyStopped(window);
  await petAction(window, 'ATTACK');
  await waitForImpact(window);
  await waitFor(
    window,
    'document.querySelector("#battle-overlay").dataset.petAction === "IDLE"',
    'manual attack completes',
  );
  await verifyStopped(window);
  console.log(`PASS ${label}: startup attack / STOP / START / manual attack / visible slash`);
}

async function verifyPet(window, pet, growthStatus = 'LINKED') {
  const snapshot = await state(window);
  assert.equal(snapshot.activePet.petId, pet.ownedPetId);
  assert.equal(snapshot.activePet.level, pet.level);
  assert.equal(snapshot.activePet.evolutionStage, pet.evolutionStage);
  assert.equal(snapshot.growthStatus, growthStatus);
  const stage = pet.evolutionStage + 1;
  const sheets = snapshot.petSprites[pet.ownedPetId];
  for (const motion of ['idle', 'attack']) {
    const expected = path.join(
      repo,
      'apps/desktop/renderer/assets/pets',
      pet.rarity.toLowerCase(),
      pet.sprite,
      `stage${stage}`,
      `pet_${pet.speciesId}_s${stage}_${motion}.png`,
    );
    assert.equal(fileURLToPath(sheets[motion].asset), expected);
    assert.ok(Number.isInteger(sheets[motion].frameCount) && sheets[motion].frameCount > 0);
    accessSync(expected);
  }
  await waitFor(
    window,
    `(() => {
      const image = document.querySelector('#pet-sheet');
      return image && image.complete && image.naturalWidth > 0 &&
        ${JSON.stringify([sheets.idle.asset, sheets.attack.asset])}.includes(image.src) &&
        !document.querySelector('#pet').hidden &&
        (${JSON.stringify(growthStatus)} === 'UNLINKED' || document.querySelector('#battle-notice').hidden);
    })()`,
    `rendered ${growthStatus} ${pet.sprite} stage ${stage}`,
  );
}

async function verifyRoomPet(window, view) {
  await verifyPet(
    window,
    {
      ownedPetId: view.ownedPetId,
      speciesId: view.petId,
      rarity: view.rarity,
      sprite: view.slug,
      level: view.level,
      evolutionStage: view.stage - 1,
    },
    'UNLINKED',
  );
  assert.equal((await state(window)).activePet.displayName, view.name);
  await waitFor(
    window,
    `(() => {
      const notice = document.querySelector('#battle-notice');
      return notice && !notice.hidden && Number(getComputedStyle(notice).opacity) > 0 &&
        notice.textContent === '성장 정보 연결 대기 · 모션 미리보기';
    })()`,
    'unlinked growth notice',
  );
}

async function capturePreview(window, name) {
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true });
  const image = await window.webContents.capturePage();
  const filePath = path.join(artifactDirectory, `${name}.png`);
  writeFileSync(filePath, image.toPNG());
  console.log(`ARTIFACT ${filePath}`);
}

async function closeFromUi(window, label) {
  let onClosed;
  const closed = new Promise((resolve) => {
    onClosed = resolve;
    window.once('closed', onClosed);
  });
  try {
    await click(window, '.window-close');
    await within(closed, `${label} close button`, 3_000);
  } finally {
    window.removeListener('closed', onClosed);
  }
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  closeBattle?.();
  ipcMain.removeHandler('battle:open');
  for (const channel of ['room:scene', 'room:open', 'room:setActivePet']) {
    ipcMain.removeHandler(channel);
  }
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  database?.close();
  // The parent runner removes its profile after Electron releases Windows cache handles.
  if (!process.env.PETTO_BATTLE_TEST_PROFILE) rmSync(directory, { recursive: true, force: true });
}

const watchdog = setTimeout(() => {
  console.error('FAIL battle host smoke exceeded 90 seconds');
  try {
    cleanup();
  } finally {
    app.exit(1);
  }
}, 90_000);

async function run() {
  const desktop = (file) =>
    import(pathToFileURL(path.join(repo, 'apps/desktop/dist/main', file)).href);
  const [
    host,
    { SqliteFileDatabase },
    { APP_MIGRATIONS },
    { SqlitePetClient },
    { SqliteGrowthReadClient },
    { PetRepository },
    { PetGrowthRepository },
    { OVERLAY_GROWTH_RULES },
    { mountBattle },
    { PetClientRoomAdapter, RoomSelectionAdapter, seedCollection, toSnapshot },
    { RoomState, loadRoomCollection, mountRoom },
    { RoomCollectionPort },
    { JsonFileStore, ROOM_FILE_NAME },
  ] = await Promise.all([
    desktop('windows.js'),
    desktop('persistence/sqlite-file.js'),
    desktop('persistence/migrations/index.js'),
    desktop('clients/sqlite-pet-client.js'),
    desktop('clients/sqlite-growth-read-client.js'),
    desktop('persistence/repositories/pet-repository.js'),
    desktop('persistence/repositories/pet-growth-repository.js'),
    desktop('growth-rules.js'),
    import('@pet/battle/node'),
    import('@pet/room'),
    desktop('room.js'),
    desktop('collection.js'),
    desktop('store.js'),
  ]);
  database = new SqliteFileDatabase({
    filePath: path.join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  const pets = new SqlitePetClient(new PetRepository(database));
  const growth = new SqliteGrowthReadClient(new PetGrowthRepository(database));
  const roomPets = new PetClientRoomAdapter(pets);
  const [mole, initialWizard] = pets.createOwnedPets(['003', '006']);
  const wizard = pets.updateGrowth(initialWizard.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  pets.setActivePet(mole.ownedPetId);
  const sharedBefore = pets.listOwnedPets();
  const roomStore = new JsonFileStore(directory, ROOM_FILE_NAME);
  const seeded = seedCollection();
  roomStore.save(
    toSnapshot({
      ...seeded,
      pets: [
        ...seeded.pets,
        ...[mole, wizard].map((pet) => ({
          id: pet.ownedPetId,
          speciesPetId: pet.speciesId,
          level: pet.level,
        })),
      ],
    }),
  );
  const roomCollection = loadRoomCollection(roomStore);
  const room = new RoomState(
    roomStore,
    { now: () => new Date() },
    new RoomCollectionPort(roomCollection),
    roomCollection,
  );
  mountRoom(room, { showRoom() {}, broadcast: host.broadcast });
  closeBattle = mountBattle(roomPets, ipcMain, {
    growth,
    petAssetsDir: host.petAssetsDir,
    selection: new RoomSelectionAdapter(() => room.scene().pets),
    levelXpCosts: Array.from({ length: OVERLAY_GROWTH_RULES.maxLevel }, (_, i) =>
      OVERLAY_GROWTH_RULES.requiredXp(i + 1),
    ),
    isBattleSender: (id) => host.getBattleWindow()?.webContents.id === id,
    lifecycle: {
      onQuit(listener) {
        app.once('before-quit', listener);
        return () => app.removeListener('before-quit', listener);
      },
      onWindowClosed: host.subscribeBattleWindowClosed,
    },
  });
  let battleLoaded;
  ipcMain.handle('battle:open', () => {
    const window = host.createBattleWindow();
    battleLoaded = loaded(window);
  });
  const overlay = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(repo, 'apps/desktop/src/preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  await within(overlay.loadURL('about:blank'), 'overlay document load');
  await evaluate(overlay, 'window.petApi.setActivePet("seed-001")');
  assert.equal(roomStore.load().activePetId, 'seed-001');
  await evaluate(overlay, 'window.overlay.openBattle()');
  const battle = host.getBattleWindow();
  assert.ok(battle, 'overlay.openBattle must create the real host window');
  await battleLoaded;
  await waitFor(
    battle,
    'Boolean(window.petBattle && window.petBattle.execute)',
    'sandbox battle bridge',
  );
  assert.deepEqual(await evaluate(battle, '[typeof require, typeof process]'), [
    'undefined',
    'undefined',
  ]);
  await waitFor(battle, '!document.hidden', 'host battle window shown');
  assert.deepEqual(battle.getContentSize(), [640, 420]);
  await verifyRoomPet(battle, room.activeView());
  await evaluate(overlay, 'window.petApi.setActivePet("seed-006")');
  await verifyRoomPet(battle, room.activeView());
  await capturePreview(battle, 'unlinked-room-wizard');
  assert.equal(host.getBattleWindow(), battle, 'JSON room selection updates the running window');
  assert.deepEqual(battle.getContentSize(), [640, 420]);
  const unlinkedBeforeMotion = await state(battle);
  await verifyAttack(battle, 'JSON room selection → unlinked real assets');
  const unlinkedAfterMotion = await state(battle);
  assert.equal(unlinkedAfterMotion.growthStatus, 'UNLINKED');
  assert.equal(unlinkedAfterMotion.activePet.stage, unlinkedBeforeMotion.activePet.stage);
  assert.equal(unlinkedAfterMotion.enemyHpRatio, unlinkedBeforeMotion.enemyHpRatio);
  assert.deepEqual(pets.listOwnedPets(), sharedBefore);
  assert.equal(roomStore.load().activePetId, 'seed-006');
  console.log(
    'PASS JSON room IPC selection / live unlinked sprites / no fabricated XP / unchanged size',
  );

  await evaluate(overlay, `window.petApi.setActivePet(${JSON.stringify(mole.ownedPetId)})`);
  await verifyPet(battle, mole);
  await evaluate(overlay, `window.petApi.setActivePet(${JSON.stringify(wizard.ownedPetId)})`);
  await verifyPet(battle, wizard);
  await capturePreview(battle, 'linked-room-wizard');
  assert.equal(host.getBattleWindow(), battle, 'linked room selection updates the running window');
  assert.equal(pets.getActivePet().ownedPetId, mole.ownedPetId);
  const selectedRoomSnapshot = roomStore.load();
  await assert.rejects(
    command(battle, { type: 'GROWTH_XP_ADDED', petId: wizard.ownedPetId, amount: 99999, nowMs: 0 }),
    /허용하지/,
  );
  await verifyAttack(battle, 'RoomPetReadClient → sandbox host IPC → Electron engine');
  await command(battle, { type: 'SET_DISPLAY_OPACITY', percent: 35 });
  assert.equal(
    pets.getOwnedPet(wizard.ownedPetId).totalXp,
    384,
    'battle controls must not grant owner XP',
  );
  assert.deepEqual(pets.listOwnedPets(), sharedBefore);
  assert.deepEqual(roomStore.load(), selectedRoomSnapshot);
  await closeFromUi(battle, 'host battle');
  assert.equal(overlay.isDestroyed(), false);
  assert.equal(host.getBattleWindow(), undefined);
  console.log(
    'PASS host selection / shared stage assets / growth write rejection / X closes only battle',
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const reopened = host.getBattleWindow();
  await battleLoaded;
  await verifyPet(reopened, wizard);
  await verifyStopped(reopened);
  assert.equal((await state(reopened)).preview.displayOpacity, 0.35);
  await closeFromUi(reopened, 'reopened host battle');
  console.log('PASS host lifecycle: window close/reopen preserves STOP and opacity');

  const standalone = new BrowserWindow({
    width: 640,
    height: 420,
    useContentSize: true,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist/ui/preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  await within(
    standalone.loadFile(path.join(__dirname, '../dist/ui/index.html')),
    'standalone document load',
  );
  standalone.show();
  await waitFor(
    standalone,
    'Boolean(window.petBattle) && !document.hidden',
    'standalone Electron bridge',
  );
  await verifyAttack(standalone, 'Electron standalone');
  await closeFromUi(standalone, 'standalone battle');
  assert.equal(overlay.isDestroyed(), false);
  console.log('PASS Electron standalone: X closes only battle window');
}

app
  .whenReady()
  .then(run)
  .then(() => {
    clearTimeout(watchdog);
    cleanup();
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(watchdog);
    console.error(error);
    try {
      cleanup();
    } finally {
      app.exit(1);
    }
  });
