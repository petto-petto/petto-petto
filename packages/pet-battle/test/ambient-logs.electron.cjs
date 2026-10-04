// electron packages/pet-battle/test/ambient-logs.electron.cjs (after building @pet/battle)
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640,
    height: 420,
    useContentSize: true,
    frame: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 180))');
  const advance = async (ms) => {
    await evaluate(`window.logNow += ${ms}`);
    await settle();
  };
  const snapshot = () =>
    evaluate(`Object.fromEntries(['PET','ENEMY'].map(side => {
    const panel = document.querySelector('[data-ambient-side="'+side+'"]');
    const r = panel.getBoundingClientRect();
    return [side, { hidden: panel.hidden, x:r.x, right:r.right, top:r.top, bottom:r.bottom,
      lines: [...panel.querySelectorAll('li')].map(li => ({id: li.dataset.logId, text: li.textContent})),
      unclipped: [...panel.querySelectorAll('li')].every(li => li.scrollHeight <= li.clientHeight && li.scrollWidth <= li.clientWidth)
    }];
  }))`);
  try {
    await window.loadFile(path.join(__dirname, '../ui/index.html'));
    // Test-only clock/visibility control. Production renderer has no debug switches.
    await evaluate(`window.logNow = Date.now(); Date.now = () => window.logNow;
      window.logPageHidden = false;
      Object.defineProperty(document, 'hidden', { get: () => window.logPageHidden });
      document.querySelector('[data-action="STOP"]').click();`);
    await settle();
    assert.equal((await snapshot()).PET.hidden, false);
    await advance(9999);
    assert.equal((await snapshot()).PET.lines.length, 0);
    for (let index = 1; index <= 6; index++) {
      const previous = await snapshot();
      await advance(20001);
      const current = await snapshot();
      for (const side of ['PET', 'ENEMY']) {
        assert.equal(current[side].lines.length, Math.min(index, 5));
        assert.equal(
          new Set(current[side].lines.map((line) => line.text)).size,
          Math.min(index, 5),
        );
        assert.ok(
          !previous[side].lines.some((line) => line.text === current[side].lines.at(-1).text),
        );
        assert.deepEqual(current[side].lines.slice(0, -1), previous[side].lines.slice(-4));
        assert.equal(current[side].unclipped, true);
      }
    }
    console.log(
      'PASS independent timed logs / no visible duplicates / oldest-first eviction / text fits',
    );
    const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'battle-ambient-'));
    // The overlay border consumes 4px; 292px leaves the required 288px content height.
    for (const [width, height] of [
      [640, 420],
      [800, 420],
      [700, 292],
      [1440, 900],
    ]) {
      window.setContentSize(width, height);
      await settle();
      const current = await snapshot();
      const fighters = await evaluate(`(() => {
        const pet = document.querySelector('#pet').getBoundingClientRect();
        const enemy = document.querySelector('#enemy').getBoundingClientRect();
        return { petX: pet.x, enemyRight: enemy.right, petWidth: getComputedStyle(document.querySelector('#pet')).width };
      })()`);
      assert.equal(current.PET.hidden, false);
      assert.ok(current.PET.right < fighters.petX && current.ENEMY.x > fighters.enemyRight);
      assert.ok(current.PET.top >= 48 && current.ENEMY.bottom <= height);
      assert.equal(fighters.petWidth, '128px');
      assert.equal(current.PET.unclipped && current.ENEMY.unclipped, true);
      assert.deepEqual(
        await evaluate(`(async () => {
        await document.fonts.ready;
        const { AMBIENT_MESSAGES } = await import('../dist/view/ambient-logs.js');
        const clipped = [];
        for (const side of ['PET', 'ENEMY']) {
          const list = document.querySelector('[data-ambient-side="'+side+'"] ol');
          const probe = document.createElement('li');
          probe.className = 'ambient-log-entry';
          list.append(probe);
          for (const text of AMBIENT_MESSAGES[side]) {
            probe.textContent = text;
            if (probe.scrollHeight > probe.clientHeight || probe.scrollWidth > probe.clientWidth) clipped.push(text);
          }
          probe.remove();
        }
        return clipped;
      })()`),
        [],
      );
      await evaluate(`document.querySelector('#battle-toast').classList.remove('visible')`);
      await settle();
      await fs.writeFile(
        path.join(artifacts, `${width}x${height}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    const retained = await snapshot();
    window.setContentSize(360, 180);
    await settle();
    await advance(600000);
    assert.equal((await snapshot()).PET.hidden, true);
    window.setContentSize(800, 420);
    await settle();
    assert.deepEqual((await snapshot()).PET.lines, retained.PET.lines);
    await advance(9999);
    assert.deepEqual((await snapshot()).PET.lines, retained.PET.lines);
    await evaluate(`window.logPageHidden = true`);
    await settle();
    await advance(600000);
    await evaluate(`window.logPageHidden = false`);
    await settle();
    assert.deepEqual((await snapshot()).PET.lines, retained.PET.lines);
    await evaluate(`document.querySelector('#pet').click()`);
    await settle();
    assert.equal((await snapshot()).PET.hidden, true);
    await evaluate(`document.querySelector('#pet').click()`);
    await settle();
    assert.equal((await snapshot()).PET.hidden, false);
    await evaluate(`document.querySelector('[data-action="COLOR"]').click()`);
    await settle();
    assert.equal((await snapshot()).ENEMY.lines.length, 0);
    assert.deepEqual((await snapshot()).PET.lines, retained.PET.lines);
    await evaluate(
      `const input = document.querySelector('#display-opacity'); input.value = '40'; input.dispatchEvent(new Event('input'));`,
    );
    await settle();
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('[data-ambient-side="PET"]')).opacity`,
      ),
      '0.4',
    );
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await settle();
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.ambient-log-entry')).animationDuration`,
      ),
      '0.001s',
    );
    console.log(
      `PASS responsive / hidden-window pause / menu / enemy change / opacity / reduced motion; screenshots: ${artifacts}`,
    );
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
