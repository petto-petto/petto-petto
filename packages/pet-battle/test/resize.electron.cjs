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
          identity: rect('.pet-identity'), opacity: rect('.opacity-control'),
          controls: [...document.querySelectorAll('#enemy-menu button')].map(button => rect('[data-action="' + button.dataset.action + '"]')),
        };
        document.querySelector('#enemy-menu').hidden = true;
        return result;
      })()`);
      assert.equal(result.root.width, width);
      assert.equal(result.root.height, height);
      for (const rect of [result.pet, result.enemy, result.opacity, ...result.controls]) {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= width && rect.bottom <= height);
      }
      const { identity, opacity } = result;
      assert.ok(
        identity.right <= opacity.x || identity.bottom <= opacity.y || identity.y >= opacity.bottom,
        'pet identity must not overlap opacity control',
      );
      console.log(`PASS responsive DOM: ${width}×${height}`);
    }
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
