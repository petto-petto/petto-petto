// Run after building @pet/battle: electron packages/pet-battle/test/resize.electron.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 360,
    height: 180,
    useContentSize: true,
    frame: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try {
    await window.loadFile(path.join(__dirname, '../ui/index.html'));
    assert.equal(
      await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('button.window-close[type="button"][aria-label="전투 창 닫기"]'))`,
      ),
      true,
      'battle window needs an accessible close button',
    );
    for (const [width, height] of [
      [360, 180],
      [640, 420],
      [960, 540],
      [280, 180],
      [360, 640],
    ]) {
      window.setContentSize(width, height);
      await window.webContents.executeJavaScript(`new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })`);
      const result = await window.webContents.executeJavaScript(`(() => {
        const rect = selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        // Reveal without changing state: inspect actual CSS geometry before the next IPC poll.
        document.querySelector('#enemy-menu').hidden = false;
        const result = {
          root: rect('#battle-overlay'), pet: rect('#pet'), enemy: rect('#enemy'),
          identity: Boolean(document.querySelector('.pet-identity, #pet-name, #pet-level')), opacity: rect('.opacity-control'),
          close: rect('.window-close'), hud: rect('.battle-hud'),
          petSize: parseFloat(getComputedStyle(document.querySelector('#pet')).width),
          controls: [...document.querySelectorAll('#enemy-menu button')].map(button => rect('[data-action="' + button.dataset.action + '"]')),
        };
        document.querySelector('#enemy-menu').hidden = true;
        return result;
      })()`);
      assert.equal(result.root.width, width);
      assert.equal(result.root.height, height);
      assert.equal(result.petSize, 128, 'resizing must not shrink the battle pet');
      for (const rect of [
        result.pet,
        result.enemy,
        result.opacity,
        result.close,
        ...result.controls,
      ]) {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= width && rect.bottom <= height);
      }
      assert.ok(result.hud.right < result.close.x, 'close button must not overlap HUD');
      assert.equal(result.identity, false, 'pet name and level panel must be removed');
      console.log(`PASS responsive DOM: ${width}×${height}`);
    }
    const otherWindow = new BrowserWindow({ show: false });
    const point = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.window-close');
      const r = button.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    const closed = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('close button did not close battle window')),
        3000,
      );
      window.once('closed', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await closed;
    assert.equal(otherWindow.isDestroyed(), false, 'other app windows must stay open');
    otherWindow.destroy();
    console.log('PASS close button: only battle window closed');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
