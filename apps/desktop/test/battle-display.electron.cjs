// Run after typecheck + @pet/battle build:ui, using an isolated Electron profile.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const repo = path.resolve(__dirname, '../../..');
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
    ipcMain.handle('battle:command', (_event, command) => gateway.execute(command));
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
      width: 640,
      height: 420,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      webPreferences: {
        preload: path.join(repo, 'packages/pet-battle/ui/host-preload.cjs'),
        offscreen: true,
        backgroundThrottling: false,
      },
    });
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
      maximumAlpha === 255 && pixels[3] > 0 && pixels[3] <= 95,
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
