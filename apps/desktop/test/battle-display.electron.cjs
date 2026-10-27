// Run after typecheck + @pet/battle build:ui, using an isolated Electron profile.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '../../..');
const battleWindowOptions = require('../../../packages/pet-battle/ui/window-options.json');
const profile = mkdtempSync(path.join(tmpdir(), 'petto-display-'));
app.setPath('userData', profile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(window, expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(40);
  }
  throw new Error(`Timed out: ${expression}`);
}
app
  .whenReady()
  .then(async () => {
    const meta = await import('@pet/meta');
    const { DisplaySettingsBattleGateway } =
      await import('../../../packages/pet-battle/dist/app/display-settings.js');
    const { DemoBattleGateway } =
      await import('../../../packages/pet-battle/dist/testing/demo-gateway.js');
    const state = new meta.MetaAppState(
      new meta.InMemoryMetaStore(),
      profile,
      'test',
      new meta.InMemoryCollection(),
      new meta.InMemoryTokenClient(),
      new meta.InMemoryPetClient(),
      meta.STUB_GROWTH_RULES,
      meta.FixtureCollector.withEmptySnapshots(),
    );
    const host = {
      showPanel() {},
      hidePanel() {},
      applyOverlayVisibility() {},
      applyPetSize() {},
      broadcast(channel, payload) {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(channel, payload);
      },
      openExternal: async () => {},
      revealPath() {},
      petPortrait: () => undefined,
    };
    const handlers = meta.metaHandlers(state, host);
    state.panelScreen = 'settings';
    for (const [channel, handler] of Object.entries(handlers))
      ipcMain.handle(channel, (_event, ...args) => handler(...args));
    const gateway = new DisplaySettingsBattleGateway(new DemoBattleGateway(), {
      read: () => ({
        animationsEnabled: state.meta.settings.battleAnimationsEnabled,
        opacity: state.meta.settings.battleOpacity,
      }),
      setOpacity: (value) => handlers['settings:battle']('opacity', value),
    });
    let visualPet;
    ipcMain.handle('battle:command', async (_event, command) => {
      const result = await gateway.execute(command);
      if (!visualPet) return result;
      const activePet = { ...result.state.activePet, evolutionStage: visualPet.evolutionStage };
      return {
        ...result,
        state: { ...result.state, activePet, petSprites: { [activePet.petId]: visualPet.sprites } },
      };
    });
    const panel = new BrowserWindow({
      width: 400,
      height: 544,
      show: false,
      webPreferences: {
        preload: path.join(repo, 'apps/desktop/src/preload/preload.cjs'),
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    const battle = new BrowserWindow({
      ...battleWindowOptions,
      webPreferences: {
        preload: path.join(repo, 'packages/pet-battle/ui/host-preload.cjs'),
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    assert.equal(
      battle.hasShadow(),
      false,
      'transparent battle windows must not have an OS shadow',
    );
    assert.equal(
      battleWindowOptions.thickFrame,
      false,
      'Windows must not draw its own non-client frame',
    );
    const originalSize = battle.getContentSize();
    battle.setContentSize(540, 360);
    const resized = battle.getContentSize();
    assert.ok(
      resized.every((size, index) => Math.abs(size - [540, 360][index]) <= 1),
      'window size controls must work within one pixel of Windows DPI rounding',
    );
    battle.setContentSize(...originalSize);
    await Promise.all([
      panel.loadFile(path.join(repo, 'packages/pet-meta/ui/index.html')),
      battle.loadFile(path.join(repo, 'packages/pet-battle/dist/ui/index.html')),
    ]);
    await waitFor(panel, "document.querySelectorAll('.subtab').length === 5");
    const labels = await panel.webContents.executeJavaScript(
      "[...document.querySelectorAll('.subtab')].map(x=>x.textContent)",
    );
    assert.deepEqual(labels, ['수집', '화면', '알림', '전투', '기타']);
    await panel.webContents.executeJavaScript(
      "[...document.querySelectorAll('.subtab')].find(x=>x.textContent==='전투').click()",
    );
    await waitFor(panel, '!!document.querySelector(\'input[aria-label="전투 투명도"]\')');
    await panel.webContents.executeJavaScript("document.querySelector('[role=switch]').click()");
    await waitFor(
      battle,
      "document.querySelector('#battle-overlay').classList.contains('simple-animation')",
    );
    assert.equal(
      await battle.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('#battle-toast')).opacity",
      ),
      '0',
      'empty toast must not leave a parchment rectangle',
    );
    await panel.webContents.executeJavaScript(
      "window.draggedSlider=document.querySelector('input[type=range]');window.draggedSlider.value='35';window.draggedSlider.dispatchEvent(new Event('input',{bubbles:true}))",
    );
    await waitFor(
      battle,
      "getComputedStyle(document.querySelector('#battle-environment')).opacity === '0.35'",
    );
    assert.equal(
      await panel.webContents.executeJavaScript(
        "window.draggedSlider===document.querySelector('input[type=range]')",
      ),
      true,
      'live changes must preserve the dragged slider',
    );
    await panel.webContents.executeJavaScript(
      "window.draggedSlider.dispatchEvent(new Event('change',{bubbles:true}))",
    );
    assert.equal(
      await battle.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('#battle-overlay')).opacity",
      ),
      '1',
      'the pet ancestor must remain opaque',
    );
    await delay(150);
    const transparentImage = await battle.webContents.capturePage();
    const pixels = transparentImage.toBitmap();
    writeFileSync(path.join(profile, 'transparent.png'), transparentImage.toPNG());
    let maximumAlpha = 0;
    for (let index = 3; index < pixels.length; index += 4)
      maximumAlpha = Math.max(maximumAlpha, pixels[index]);
    assert.ok(
      maximumAlpha === 255 && pixels[3] === 0,
      `pet must stay opaque while the border fades: max alpha ${maximumAlpha}, border ${pixels[3]}`,
    );
    const position = () =>
      battle.webContents.executeJavaScript(
        "[document.querySelector('#pet').style.left,document.querySelector('#pet').style.bottom,document.querySelector('#enemy').style.left,document.querySelector('#enemy').style.bottom,document.querySelector('#battle-world').style.transform]",
      );
    const before = await position();
    await delay(400);
    assert.deepEqual(await position(), before, 'simple attacks must preserve placement');
    await waitFor(
      battle,
      "document.querySelector('#pet-sheet').classList.contains('animated-sheet')",
    );
    await battle.webContents.executeJavaScript(
      "window.petBattle.execute({type:'SET_DISPLAY_OPACITY',percent:62})",
    );
    await waitFor(panel, "document.querySelector('input[type=range]').value === '62'");
    await panel.webContents.executeJavaScript("window.petApi.setBattleSetting('opacity',0)");
    await waitFor(
      battle,
      "getComputedStyle(document.querySelector('#battle-environment')).opacity === '0'",
    );
    assert.equal(
      await battle.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('#pet')).opacity",
      ),
      '1',
    );
    await delay(150);
    const petOnly = (await battle.webContents.capturePage()).toBitmap();
    let petOnlyAlpha = 0;
    for (let index = 3; index < petOnly.length; index += 4)
      petOnlyAlpha = Math.max(petOnlyAlpha, petOnly[index]);
    assert.equal(petOnly[3], 0, 'the frame must disappear at zero opacity');
    assert.equal(petOnlyAlpha, 255, 'the combat pet must remain visible at zero opacity');
    assert.equal(
      await battle.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('#pet > .ground-shadow')).backgroundColor",
      ),
      'rgba(21, 17, 35, 0)',
      'pet decoration must not leave an opaque shadow on a transparent scene',
    );
    assert.equal(
      await panel.webContents.executeJavaScript('getComputedStyle(document.body).opacity'),
      '1',
    );
    await panel.webContents.executeJavaScript(
      "window.petApi.setBattleSetting('opacity',100);window.petApi.setBattleSetting('animations_enabled',true)",
    );
    await waitFor(
      battle,
      "getComputedStyle(document.querySelector('#battle-environment')).opacity === '1' && !document.querySelector('#battle-overlay').classList.contains('simple-animation')",
    );
    await waitFor(
      panel,
      "document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'",
    );
    await battle.webContents.executeJavaScript(
      "const opacitySlider=document.querySelector('#display-opacity');opacitySlider.value='35';opacitySlider.dispatchEvent(new Event('input',{bubbles:true}))",
    );
    await waitFor(
      battle,
      "document.querySelector('#battle-toast').classList.contains('visible') && getComputedStyle(document.querySelector('#battle-toast')).opacity === '0.35'",
    );
    await waitFor(
      battle,
      "!document.querySelector('#battle-toast').classList.contains('visible') && getComputedStyle(document.querySelector('#battle-toast')).opacity === '0'",
    );
    await panel.webContents.executeJavaScript("window.petApi.setBattleSetting('opacity',100)");
    await waitFor(
      battle,
      "getComputedStyle(document.querySelector('#battle-environment')).opacity === '1'",
    );
    for (const evolutionStage of [0, 2]) {
      const stage = evolutionStage + 1;
      const sprites = Object.fromEntries(
        ['idle', 'attack'].map((action) => {
          const file = path.join(
            repo,
            `apps/desktop/renderer/assets/pets/common/mole_digger/stage${stage}/pet_003_s${stage}_${action}.png`,
          );
          const size = nativeImage.createFromPath(file).getSize();
          assert.equal(size.height, 32);
          return [
            action,
            { asset: pathToFileURL(file).href, frameCount: size.width / size.height },
          ];
        }),
      );
      visualPet = { evolutionStage, sprites };
      await panel.webContents.executeJavaScript("window.petApi.setBattleSetting('opacity',0)");
      await waitFor(
        battle,
        "document.querySelector('#battle-overlay').dataset.petAnimation === 'mole' && document.querySelector('.mole-native-sprite').style.opacity === '1'",
      );
      const frame = await battle.webContents.capturePage();
      const bitmap = frame.toBitmap();
      assert.equal(
        bitmap[3],
        0,
        'the client corner remains transparent during a native mole attack',
      );
      assert.equal(
        await battle.webContents.executeJavaScript(
          "getComputedStyle(document.querySelector('#pet > .ground-shadow')).backgroundColor",
        ),
        'rgba(21, 17, 35, 0)',
      );
      for (const background of ['white', 'black']) {
        const composite = await battle.webContents.executeJavaScript(`(async () => {
          const image = new Image(); image.src = ${JSON.stringify(frame.toDataURL())}; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.fillStyle = ${JSON.stringify(background)};
          context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
          return canvas.toDataURL('image/png');
        })()`);
        writeFileSync(
          path.join(profile, `mole-${stage}-${background}.png`),
          Buffer.from(composite.split(',')[1], 'base64'),
        );
      }
    }
    visualPet = undefined;
    await panel.webContents.executeJavaScript("window.petApi.setBattleSetting('opacity',100)");
    writeFileSync(
      path.join(profile, 'settings.png'),
      (await panel.webContents.capturePage()).toPNG(),
    );
    console.log(
      `PASS battle tab / stationary basic attacks / live opacity / opaque pet / transparent border / zero-opacity recovery; screenshot ${path.join(profile, 'settings.png')}`,
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
