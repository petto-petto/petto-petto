// Run after building @pet/battle: electron packages/pet-battle/test/peeking.electron.cjs
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const click = (action) => evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  const settle = () => evaluate(`new Promise(resolve => setTimeout(resolve, 180))`);
  const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'battle-peeking-'));
  try {
    await window.loadFile(path.join(__dirname, '../ui/index.html'));
    await settle();
    await click('STOP');
    await settle();
    assert.equal(
      await evaluate(`document.querySelector('#defeated-enemy-spectators').hidden`),
      true,
    );

    for (const [theme, clicks] of [
      ['MUSHROOM_FOREST', 0],
      ['CRYSTAL_RUINS', 3],
      ['STARLIGHT_SHRINE', 3],
    ]) {
      for (let count = 0; count < clicks; count++) {
        await click('COLOR');
        await settle();
      }
      assert.equal(
        await evaluate(`document.querySelector('#pet-spectators').dataset.theme`),
        theme,
      );
      // Polls must preserve the DOM nodes and animation clocks.
      await evaluate(`window.peekNode = document.querySelector('.peek-actor')`);
      await settle();
      assert.equal(
        await evaluate(`window.peekNode === document.querySelector('.peek-actor')`),
        true,
      );

      for (const [width, height] of [
        [640, 420],
        [1440, 900],
        [1920, 1080],
        [2560, 1080],
        [900, 1440],
        [360, 180],
        [360, 640],
      ]) {
        window.setContentSize(width, height);
        await settle();
        const slots = await evaluate(`(() => {
          const root = document.querySelector('#battle-overlay');
          return [...document.querySelectorAll('.peek-slot:not([hidden])')].map(slot => {
            const r = slot.getBoundingClientRect();
            const head = slot.querySelector('.peek-actor');
            const animation = head.getAnimations()[0];
            animation.pause();
            const timing = animation.effect.getTiming();
            animation.currentTime = timing.delay + timing.duration * 1.1;
            const hidden = head.getBoundingClientRect();
            animation.currentTime = timing.delay + timing.duration * 1.44;
            const visible = head.getBoundingClientRect();
            const edge = r.left + r.width / 2;
            const right = slot.dataset.direction === 'RIGHT';
            const sprite = slot.querySelector('.peek-sprite');
            const frame = parseFloat(getComputedStyle(head).width);
            return {
              x: r.x, y: r.y, right: r.right, bottom: r.bottom,
              edge,
              concealed: right ? hidden.right <= edge : hidden.left >= edge,
              revealed: right ? visible.right > edge : visible.left < edge,
              leaning: Math.abs(new DOMMatrix(getComputedStyle(head).transform).b) > .1,
              wholeFrame: sprite.clientWidth === frame && sprite.clientHeight === frame,
              frame,
              mask: getComputedStyle(slot).clipPath,
              alignedMask: slot.style.clipPath,
              overflow: getComputedStyle(slot).overflow,
              pointerEvents: getComputedStyle(slot).pointerEvents,
              petSize: getComputedStyle(document.querySelector('#pet')).width,
              imageLoaded: head.querySelector('img').naturalWidth === 128,
              theme: document.querySelector('#pet-spectators').dataset.theme,
            };
          });
        })()`);
        assert.ok(slots.length <= 3);
        if (width >= height)
          assert.equal(slots.length, 3, 'restore all three available spectators');
        for (const slot of slots) {
          assert.ok(slot.edge > 0 && slot.edge < width && slot.bottom <= height);
          assert.equal(slot.concealed, true, 'head must be fully concealed behind obstacle');
          assert.equal(
            slot.revealed,
            true,
            `head must emerge on reveal beat: ${JSON.stringify(slot)}`,
          );
          assert.equal(slot.overflow, 'hidden');
          assert.equal(slot.wholeFrame, true, 'never truncate a head or neck to a fixed rectangle');
          assert.equal(slot.leaning, true, 'head must lean around the obstacle edge');
          assert.match(slot.mask, /polygon/);
          assert.match(
            slot.alignedMask,
            /^polygon\(/,
            'use projected artwork contour, not generic half clipping',
          );
          assert.equal(slot.frame % 32, 0);
          assert.ok(
            slot.frame >= 64 && slot.frame <= 128,
            'never shrink the original spectator scale',
          );
          if (width >= 1440) assert.equal(slot.frame, 128);
          assert.equal(slot.pointerEvents, 'none');
          assert.equal(slot.petSize, '128px');
          assert.equal(slot.imageLoaded, true);
          assert.equal(slot.theme, theme);
        }
        // Hide transient toast only for deterministic visual evidence.
        await evaluate(`document.querySelector('#battle-toast').classList.remove('visible')`);
        await settle();
        await fs.writeFile(
          path.join(artifacts, `${theme}-${width}x${height}.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        console.log(`PASS peeking / hidden / 128px pet: ${theme} ${width}×${height}`);
      }
    }

    await evaluate(`(() => {
      const input = document.querySelector('#display-opacity');
      input.value = '35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await settle();
    const opacity = await evaluate(`({
      environment: getComputedStyle(document.querySelector('#battle-environment')).opacity,
      pet: getComputedStyle(document.querySelector('#pet')).opacity,
      insideEnvironment: Boolean(document.querySelector('#battle-environment #pet-spectators')),
    })`);
    assert.equal(opacity.environment, '0.35');
    assert.equal(opacity.pet, '1');
    assert.equal(opacity.insideEnvironment, true);
    assert.equal(await evaluate(`document.querySelector('.motion-toggle') === null`), true);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await settle();
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.peek-actor')).animationName`),
      'none',
    );
    console.log(`PASS opacity / reduced motion; screenshots: ${artifacts}`);
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
