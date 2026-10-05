// Optional semantic renderer check; uses isolated headless Chrome, never Electron or user data.
// Build @pet/battle first, then: node packages/pet-battle/test/window-layout.browser.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile, realpath, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const repository = path.resolve(__dirname, '../../..');
const allowedRoot = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP connection timeout'));
    }, 5000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error('CDP connection failed'));
      },
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    if (result.method === 'Runtime.exceptionThrown')
      errors.push(result.params.exceptionDetails.text);
    const call = pending.get(result.id);
    if (!call) return;
    pending.delete(result.id);
    clearTimeout(call.timer);
    if (result.error) call.reject(new Error(JSON.stringify(result.error)));
    else call.resolve(result.result);
  });
  return {
    errors,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('CDP closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}

// Executed inside the browser. Alpha bounds use the actual decoded PNG, not its transparent frame.
function snapshot() {
  const rect = (selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const sheet = document.querySelector('#pet-sheet');
  const canvas = document.createElement('canvas');
  canvas.width = sheet.naturalWidth;
  canvas.height = sheet.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(sheet, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) bottom = y + 1;
    }
  }
  const viewport = rect('.pet-viewport');
  return {
    width: innerWidth,
    height: innerHeight,
    pet: rect('#pet'),
    enemy: rect('#enemy'),
    enemyImage: rect('#enemy-image'),
    petFoot: viewport.y + (bottom / canvas.height) * viewport.height,
    enemySource: document.querySelector('#enemy-image').src,
    backgroundSource: document.querySelector('#battle-background').src,
    beat: document.querySelector('#battle-overlay').dataset.beat,
    animated: sheet.classList.contains('animated-sheet'),
    opacity: Object.fromEntries(
      ['#pet', '#enemy', '#battle-environment', '.enemy-hp'].map((selector) => [
        selector,
        Number(getComputedStyle(document.querySelector(selector)).opacity),
      ]),
    ),
  };
}

// Sample one complete manual attack using rAF, including the actual opaque pixels of each frame.
function sampleAttack() {
  const started = performance.now();
  const samples = [];
  const images = new Map();
  let active = false;
  return new Promise((resolve, reject) => {
    function frame() {
      const root = document.querySelector('#battle-overlay');
      const pet = document.querySelector('#pet');
      const sheet = document.querySelector('#pet-sheet');
      const beat = root.dataset.beat;
      if (beat !== 'IDLE') active = true;
      if (sheet.complete && sheet.naturalWidth > 0) {
        let image = images.get(sheet.src);
        if (!image) {
          const canvas = document.createElement('canvas');
          canvas.width = sheet.naturalWidth;
          canvas.height = sheet.naturalHeight;
          const context = canvas.getContext('2d');
          context.drawImage(sheet, 0, 0);
          image = context.getImageData(0, 0, canvas.width, canvas.height);
          images.set(sheet.src, image);
        }
        const count = Number(getComputedStyle(sheet).getPropertyValue('--frame-count'));
        const frameWidth = image.width / count;
        const frameSize = parseFloat(getComputedStyle(pet).width);
        const transform = getComputedStyle(sheet).transform;
        const shift = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
        const index = Math.max(0, Math.min(count - 1, Math.round(-shift / frameSize)));
        let x0 = image.width,
          x1 = -1,
          y0 = image.height,
          y1 = -1;
        for (let y = 0; y < image.height; y++) {
          for (let x = index * frameWidth; x < (index + 1) * frameWidth; x++) {
            if (!image.data[(y * image.width + x) * 4 + 3]) continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x + 1);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y + 1);
          }
        }
        if (x1 >= 0) {
          const r = sheet.getBoundingClientRect();
          const v = document.querySelector('.pet-viewport').getBoundingClientRect();
          const visible = {
            left: r.x + (x0 / image.width) * r.width,
            right: r.x + (x1 / image.width) * r.width,
            top: r.y + (y0 / image.height) * r.height,
            bottom: r.y + (y1 / image.height) * r.height,
          };
          samples.push({
            beat,
            ...visible,
            clipped:
              visible.left < v.x - 0.5 ||
              visible.right > v.right + 0.5 ||
              visible.top < v.y - 0.5 ||
              visible.bottom > v.bottom + 0.5,
          });
        }
      }
      if (active && beat === 'IDLE' && !sheet.classList.contains('animated-sheet'))
        return resolve(samples);
      if (performance.now() - started > 2500)
        return reject(new Error('Manual attack did not return to idle'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

async function main() {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = await realpath(path.resolve(repository, `.${name}`));
      const type = types[path.extname(file)];
      if (!file.startsWith(`${allowedRoot}${path.sep}`) || !type) {
        response.writeHead(403).end();
        return;
      }
      response
        .writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' })
        .end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  let profile, child, exited, cdp;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    profile = await mkdtemp(path.join(tmpdir(), 'pet-battle-layout-profile-'));
    child = spawn(
      process.env.BATTLE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    exited = new Promise((resolve) => child.once('exit', resolve));
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 10000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Chrome exited before startup'));
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-8192);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const address = new URL(endpoint);
    const pages = await fetch(`http://${address.host}/json/list`, {
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
    cdp = await connect(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression: typeof expression === 'function' ? `(${expression})()` : expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await delay(30);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const menu = async (target) => {
      const selector = `#${target}-menu`;
      if (await evaluate(`document.querySelector('${selector}').hidden`)) await click(`#${target}`);
      await waitFor(`!document.querySelector('${selector}').hidden`, `${target} menu`);
      const buttons = await evaluate(
        `[...document.querySelectorAll('${selector} button')].map(b => { const r=b.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; })`,
      );
      const viewport = await evaluate('({width:innerWidth,height:innerHeight})');
      for (const button of buttons)
        assert.ok(
          button.x >= 0 &&
            button.y >= 0 &&
            button.right <= viewport.width &&
            button.bottom <= viewport.height,
          `${target} menu bounds ${JSON.stringify(button)}`,
        );
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 180,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/packages/pet-battle/ui/index.html`,
    });
    await waitFor(
      "document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth > 0",
      'first pet image',
    );
    assert.equal(
      await evaluate('Boolean(window.petBattle)'),
      false,
      'only isolated demo is permitted',
    );
    await menu('pet');
    await click('[data-action="STOP"]');
    await waitFor(
      "document.querySelector('#battle-overlay').dataset.beat === 'IDLE' && !document.querySelector('#pet-sheet').classList.contains('animated-sheet')",
      'STOP',
    );
    await waitFor(
      "document.querySelector('#pet').style.getPropertyValue('--pet-ground-offset') !== '0px'",
      'foot grounding',
    );
    const initial = await evaluate(snapshot);
    assert.match(initial.enemySource, /red-steady\.png$/);
    assert.equal(initial.enemyImage.height, 56, 'stage 1 starts SMALL');
    const results = [];
    const attacks = [];
    let screenshot;
    for (const [width, height] of [
      [360, 180],
      [640, 420],
      [960, 540],
      [360, 640],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitFor(
        `innerWidth === ${width} && innerHeight === ${height} && document.querySelector('#battle-overlay').clientWidth === ${width - 4}`,
        'resize',
      );
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      await menu('pet');
      await menu('enemy');
      for (const enemyHeight of [56, 64, 80]) {
        for (let attempts = 0; attempts < 3; attempts++) {
          const actual = await evaluate(
            "parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height)",
          );
          if (actual === enemyHeight) break;
          const source = await evaluate("document.querySelector('#enemy-image').src");
          await click('[data-action="SIZE"]');
          await waitFor(
            `parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height) !== ${actual}`,
            'size button',
          );
          assert.equal(
            await evaluate("document.querySelector('#enemy-image').src"),
            source,
            'size changes must not recolor enemy',
          );
        }
        const before = await evaluate(snapshot);
        assert.equal(before.pet.width, 96);
        assert.equal(before.enemy.width, 128);
        assert.equal(before.enemyImage.height, enemyHeight);
        assert.ok(
          Math.abs(before.petFoot - before.enemy.bottom) <= 0.5,
          'visible feet share enemy floor',
        );
        assert.equal(before.beat, 'IDLE');
        await click('[data-action="COLOR"]');
        await waitFor(
          `document.querySelector('#enemy-image').src !== ${JSON.stringify(before.enemySource)}`,
          'color button',
        );
        const after = await evaluate(snapshot);
        assert.equal(after.enemyImage.height, enemyHeight, 'color changes must not resize enemy');
        results.push({
          width,
          height,
          enemyHeight,
          petWidth: after.pet.width,
          footError: after.petFoot - after.enemy.bottom,
        });
      }
      await evaluate(
        "(() => { const slider=document.querySelector('#display-opacity');slider.value='35';slider.dispatchEvent(new Event('input',{bubbles:true})); })()",
      );
      await waitFor(
        "Math.abs(Number(getComputedStyle(document.querySelector('#enemy')).opacity)-0.35)<0.001",
        'opacity transition',
      );
      const state = await evaluate(snapshot);
      for (const selector of ['#enemy', '#battle-environment', '.enemy-hp'])
        assert.ok(Math.abs(state.opacity[selector] - 0.35) < 0.001, `${selector} opacity`);
      assert.equal(state.opacity['#pet'], 1);
      if (width === 640) {
        await click('#enemy');
        await waitFor("document.querySelector('#enemy-menu').hidden", 'close menu for screenshot');
        const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const evidence = await mkdtemp(path.join(tmpdir(), 'pet-battle-layout-evidence-'));
        screenshot = path.join(evidence, '640x420-large.png');
        await writeFile(screenshot, Buffer.from(png.data, 'base64'));
      }
      await menu('pet');
      await click('[data-action="ATTACK"]');
      const samples = await evaluate(sampleAttack);
      assert.ok(
        samples.some((sample) => sample.beat === 'IMPACT'),
        'manual attack includes impact',
      );
      for (const sample of samples) {
        assert.ok(
          sample.left >= 0 && sample.top >= 0 && sample.right <= width && sample.bottom <= height,
          `attack outside ${width}×${height}: ${JSON.stringify(sample)}`,
        );
        assert.equal(sample.clipped, false, `attack clipped: ${JSON.stringify(sample)}`);
      }
      attacks.push({ width, height, samples: samples.length, impact: true, clipped: false });
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.beat === 'IDLE'",
        'return to STOP',
      );
    }
    assert.deepEqual(cdp.errors, []);
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          mode: 'isolated headless HTTP demo; no Electron or user DB',
          layouts: results,
          attacks,
          screenshot,
          screenshotOpacity: 0.35,
          errors: cdp.errors,
        },
        null,
        2,
      ),
    );
  } finally {
    cdp?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(1500)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (profile) await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
