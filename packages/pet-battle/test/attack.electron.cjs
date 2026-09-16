// Build desktop + @pet/battle and its Rust binary, then run with Electron.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const repo = path.resolve(__dirname, '../../..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function click(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  await delay(100);
}

async function waitForImpact(window) {
  for (let attempt = 0; attempt < 65; attempt += 1) {
    const visible = await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#battle-overlay');
      const slash = document.querySelector('.slash');
      const r = slash.getBoundingClientRect();
      return root.dataset.beat === 'IMPACT' && Number(getComputedStyle(slash).opacity) > 0 &&
        r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight &&
        document.querySelector('#pet-sheet').classList.contains('animated-sheet');
    })()`);
    if (visible) return;
    await delay(50);
  }
  throw new Error('No visible attack + slash within one combat cycle');
}

async function verifyAttack(window, label) {
  await waitForImpact(window);
  await click(window, '#pet');
  await click(window, '[data-action="STOP"]');
  const readStopped = () =>
    window.webContents.executeJavaScript(`({
    beat: document.querySelector('#battle-overlay').dataset.beat,
    slash: getComputedStyle(document.querySelector('.slash')).opacity,
    animated: document.querySelector('#pet-sheet').classList.contains('animated-sheet')
  })`);
  assert.deepEqual(await readStopped(), { beat: 'IDLE', slash: '0', animated: false });
  await delay(500);
  assert.deepEqual(await readStopped(), { beat: 'IDLE', slash: '0', animated: false });
  await click(window, '[data-action="START"]');
  await waitForImpact(window);
  await click(window, '[data-action="STOP"]');
  await click(window, '[data-action="ATTACK"]');
  await waitForImpact(window);
  await delay(1100);
  assert.deepEqual(await readStopped(), { beat: 'IDLE', slash: '0', animated: false });
  console.log(`PASS ${label}: startup attack / STOP / START / manual attack / visible slash`);
}

app.whenReady().then(async () => {
  try {
    const host = await import(
      pathToFileURL(path.join(repo, 'apps/desktop/dist/main/windows.js')).href
    );
    ipcMain.handle('battle:open', () => {
      host.createBattleWindow();
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
    await overlay.loadURL('about:blank');
    await overlay.webContents.executeJavaScript('window.overlay.openBattle()');
    const battle = host.getBattleWindow();
    await new Promise((resolve) => battle.webContents.once('did-finish-load', resolve));
    assert.equal(await battle.webContents.executeJavaScript('Boolean(window.petBattle)'), false);
    await verifyAttack(battle, 'actual overlay IPC → desktop battle');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('battle close button failed')), 3000);
      battle.once('closed', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await click(battle, '.window-close');
    await closed;
    assert.equal(overlay.isDestroyed(), false);
    console.log('PASS overlay entry: X closes only battle window');
    const standalone = new BrowserWindow({
      width: 640,
      height: 420,
      useContentSize: true,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../ui/preload.cjs'),
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });
    await standalone.loadFile(path.join(__dirname, '../ui/index.html'));
    await verifyAttack(standalone, 'Rust standalone');
    const standaloneClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rust demo close button failed')), 3000);
      standalone.once('closed', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await click(standalone, '.window-close');
    await standaloneClosed;
    assert.equal(overlay.isDestroyed(), false);
    console.log('PASS Rust standalone: X closes only battle window');
    overlay.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
