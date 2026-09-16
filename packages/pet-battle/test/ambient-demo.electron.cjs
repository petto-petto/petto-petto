// Uses the exact npm demo bootstrap, window options and Rust preload, with a real clock.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

require('../ui/demo-main.cjs');

app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    assert.ok(window);
    assert.deepEqual(window.getContentSize(), [640, 420]);
    const deadline = Date.now() + 25000;
    let state;
    do {
      await new Promise((resolve) => setTimeout(resolve, 250));
      state = await window.webContents.executeJavaScript(`(() => ({
        rust: typeof window.petBattle?.execute === 'function',
        petWidth: document.querySelector('#pet') && getComputedStyle(document.querySelector('#pet')).width,
        panels: [...document.querySelectorAll('[data-ambient-side]')].map(panel => ({
          hidden: panel.hidden, count: panel.querySelectorAll('li').length
        }))
      }))()`);
      if (
        state.panels.length === 2 &&
        state.panels.every((panel) => !panel.hidden && panel.count > 0)
      )
        break;
    } while (Date.now() < deadline);
    assert.equal(state.rust, true, 'must exercise the demo Rust preload');
    assert.equal(state.petWidth, '128px');
    assert.equal(state.panels.length, 2);
    assert.ok(
      state.panels.every((panel) => !panel.hidden && panel.count > 0),
      JSON.stringify(state),
    );
    const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'battle-demo-logs-'));
    await fs.writeFile(
      path.join(artifacts, '640x420.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(
      `PASS actual demo bootstrap / Rust preload / 640×420 / real-time logs: ${artifacts}`,
    );
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
