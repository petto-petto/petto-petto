// Isolated host-entry regression; build @pet/battle first, then run this file with Node.
// Uses an in-memory preload gateway, never Electron or the user's persisted data.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile, realpath, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const repository = path.resolve(__dirname, '../../..');
const allowedRoot = path.resolve(__dirname, '..');
const browser =
  process.env.BATTLE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const errors = [];
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 5000);
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
        reject(new Error('CDP connection failed'));
      },
      { once: true },
    );
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  return {
    errors,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
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

// The selected EPIC pet/stage deliberately differ from demo defaults.
const fixture = `(() => {
  if (location.hostname !== '127.0.0.1') throw new Error('Isolated HTTP required');
  const pet = { petId: 'host-selected', displayName: '호스트 선택 펫', rarity: 'EPIC',
    level: 45, sprite: 'star_wizard', evolutionStage: 1, stage: 19,
    intervalXp: 0, battleMode: 'PAUSED' };
  const state = { activePet: pet, roster: [pet], spectatorPetIds: [],
    enemyHpRatio: 0.6, enemyColor: 'PURPLE', background: 'CRYSTAL_RUINS', overlay: null,
    preview: { displayOpacity: 1, menu: 'CLOSED', petAction: null, enemyAction: null,
      enemyPhase: 'VISIBLE', enemySize: null, enemyColor: null, enemyHpRatio: null,
      petAssetRarity: null, attackEffectRarity: null, reducedMotion: true } };
  const control = { calls: 0, pending: [], released: false };
  window.__entryFixture = control;
  window.petBattle = { execute(command) {
    if (command.type !== 'GET_STATE') throw new Error('Unexpected command: ' + command.type);
    control.calls++;
    if (control.released) return Promise.resolve({ state: structuredClone(state), events: [] });
    return new Promise((resolve, reject) => control.pending.push({ resolve, reject }));
  } };
  control.resolve = () => {
    control.released = true;
    control.pending.splice(0).forEach(call => call.resolve({ state: structuredClone(state), events: [] }));
  };
  control.reject = () => control.pending.shift().reject(new Error('fixture IPC unavailable'));
})();`;

const observe = `(() => {
  const bg = document.querySelector('#battle-background');
  const world = document.querySelector('#battle-world');
  const notice = document.querySelector('#battle-notice');
  const rect = world.getBoundingClientRect();
  return {
    background: bg.currentSrc || bg.src,
    imageReady: bg.complete && bg.naturalWidth > 0,
    worldCoversWindow: rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth && rect.bottom >= innerHeight,
    noticeVisible: !notice.hidden && getComputedStyle(notice).display !== 'none',
    notice: notice.textContent,
    petHidden: document.querySelector('#pet').hidden,
    enemyHidden: document.querySelector('#enemy').hidden,
    hpHidden: document.querySelector('.enemy-hp').hidden,
    stageHidden: document.querySelector('#stage-label').hidden,
    stage: document.querySelector('#stage-label').textContent,
    petAsset: document.querySelector('#pet-sheet').src,
    enemyAsset: document.querySelector('#enemy-image').src,
    hp: document.querySelector('#enemy-hp-label').textContent,
    calls: window.__entryFixture.calls
  };
})()`;

function assertLoading(frame) {
  assert.match(
    frame.background,
    /backgrounds\/v2\/mushroom-forest\.png$/,
    'moonlit battle art must render before the first host reply',
  );
  assert.equal(frame.imageReady, true, 'initial background must be decoded');
  assert.equal(frame.worldCoversWindow, true, 'initial world must fill the viewport');
  assert.equal(frame.noticeVisible, true, 'loading or connection status must remain visible');
  assert.match(frame.notice, /불러|연결/, 'explain why actors are not available yet');
  assert.equal(
    frame.petHidden && frame.enemyHidden && frame.hpHidden && frame.stageHidden,
    true,
    'never show invented demo actors or state while the real host is pending',
  );
}

async function main() {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
  };
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') return response.writeHead(405).end();
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = await realpath(path.resolve(repository, `.${name}`));
      const type = types[path.extname(file)];
      if (!file.startsWith(`${allowedRoot}${path.sep}`) || !type)
        return response.writeHead(403).end();
      response.writeHead(200, { 'Content-Type': type }).end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  let profile;
  let child;
  let exited;
  let cdp;
  const artifacts = await mkdtemp(path.join(tmpdir(), 'pet-battle-entry-evidence-'));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    profile = await mkdtemp(path.join(tmpdir(), 'pet-battle-entry-profile-'));
    child = spawn(
      browser,
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
        reject(new Error('Chrome exited before CDP'));
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
    const pages = await fetch(`http://${new URL(endpoint).host}/json/list`, {
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
    const page = pages.find((target) => target.type === 'page');
    assert.ok(page, 'Chrome page must exist');
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 420,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      for (let count = 0; count < 100; count++) {
        if (await evaluate(expression)) return;
        await delay(50);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const screenshot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const url = `http://127.0.0.1:${server.address().port}/packages/pet-battle/ui/index.html`;
    await cdp.send('Page.navigate', { url });
    await waitFor('window.__entryFixture?.pending.length === 1', 'first host request');
    // Waiting for image decode is conditional; absent src is an immediate assertion failure.
    await evaluate(
      "(() => { const image = document.querySelector('#battle-background'); return image.getAttribute('src') ? image.decode().catch(() => {}) : undefined; })()",
    );
    await screenshot('host-pending');
    const pending = await evaluate(observe);
    console.log(JSON.stringify({ phase: 'host-pending', artifacts, frame: pending }));
    assertLoading(pending);
    await evaluate('window.__entryFixture.resolve()');
    await waitFor(
      "document.querySelector('#stage-label').textContent === 'COLOR 7/8 · SIZE 1/3' && !document.querySelector('#pet').hidden",
      'selected host state',
    );
    await evaluate(
      "Promise.all(['#battle-background', '#pet-sheet', '#enemy-image'].map(selector => document.querySelector(selector).decode()))",
    );
    const ready = await evaluate(observe);
    assert.match(ready.background, /starlight-shrine\.png$/);
    assert.match(ready.petAsset, /epic-idle\.png$/);
    assert.match(ready.enemyAsset, /rainbow-worried\.png$/);
    assert.equal(ready.hp, '60%');
    assert.equal(ready.noticeVisible, false);
    await screenshot('host-ready');

    await cdp.send('Page.reload');
    await waitFor(
      'window.__entryFixture?.pending.length === 1 && !window.__entryFixture.released',
      'fresh host request',
    );
    await evaluate('window.__entryFixture.reject()');
    await waitFor(
      'window.__entryFixture.calls >= 2 && window.__entryFixture.pending.length === 1',
      'automatic retry',
    );
    await evaluate("document.querySelector('#battle-background').decode()");
    const failed = await evaluate(observe);
    assertLoading(failed);
    assert.match(failed.notice, /못|오류|다시/, 'initial failure must explain recovery');
    // Advance beyond the transient toast lifetime: persistent status must still be present.
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 3500 });
    await delay(100);
    const persistent = await evaluate(observe);
    assertLoading(persistent);
    assert.equal(persistent.notice, failed.notice);
    await screenshot('host-retrying');
    await evaluate('window.__entryFixture.resolve()');
    await waitFor(
      "document.querySelector('#stage-label').textContent === 'COLOR 7/8 · SIZE 1/3' && document.querySelector('#battle-notice').hidden",
      'retry recovery',
    );
    await evaluate(
      "Promise.all(['#battle-background', '#pet-sheet', '#enemy-image'].map(selector => document.querySelector(selector).decode()))",
    );
    const recovered = await evaluate(observe);
    assert.match(recovered.background, /starlight-shrine\.png$/);
    assert.equal(recovered.petHidden || recovered.enemyHidden || recovered.hpHidden, false);
    assert.deepEqual(cdp.errors, []);
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          mode: 'isolated delayed/rejected host bridge; no Electron or real user data',
          artifacts,
          pending,
          ready,
          failed,
          recovered,
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
