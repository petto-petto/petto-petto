// Optional cold-renderer probe; not an Electron app or part of npm test.
// Build @pet/battle first, then: node packages/pet-battle/test/startup-performance.browser.cjs
// BATTLE_BROWSER overrides Chrome; BATTLE_PROBE_MS defaults to 4000.
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile, realpath, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const browser =
  process.env.BATTLE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const duration = Number(process.env.BATTLE_PROBE_MS || 4000);
const repository = path.resolve(__dirname, '../../..');
const allowedRoot = path.resolve(__dirname, '..');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;
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
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    } else {
      for (const listener of listeners.get(message.method) || []) listener(message.params);
    }
  });
  return {
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
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
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

async function main() {
  if (!Number.isFinite(duration) || duration < 1000 || duration > 10000) {
    throw new Error('BATTLE_PROBE_MS must be between 1000 and 10000');
  }
  // Only battle's public UI/build/assets are served. Reject traversal and symlink escapes.
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
      const content = await readFile(file);
      response
        .writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  let profile;
  let child;
  let cdp;
  let exited;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/packages/pet-battle/ui/index.html`;
    profile = await mkdtemp(path.join(tmpdir(), 'pet-battle-browser-probe-'));
    child = spawn(
      browser,
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--metrics-recording-only',
        '--window-size=640,420',
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
        reject(new Error('Chrome exited before CDP startup'));
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
    const page = pages.find((target) => target.type === 'page');
    if (!page) throw new Error('Chrome did not create a page target');
    cdp = await connect(page.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.text));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 420,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Performance.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const result = { frames: [], longTasks: [], srcWrites: [], finished: false };
        const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
          result.srcWrites.push({ at: performance.now(), id: this.id || '(detached)', value: String(value) });
          descriptor.set.call(this, value);
        }});
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) result.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }).observe({ type: 'longtask', buffered: true });
        let previous;
        function frame(now) {
          if (previous !== undefined) result.frames.push({ at: now, delta: now - previous });
          previous = now;
          if (!result.finished) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        result.done = new Promise(resolve => setTimeout(() => { result.finished = true; resolve(); }, ${duration}));
        window.__battleProbe = result;
      })();`,
    });
    const before = await cdp.send('Performance.getMetrics');
    await cdp.send('Page.navigate', { url });
    // Navigation changes execution contexts; wait for the new instrumented document.
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'Boolean(window.__battleProbe)',
        returnByValue: true,
      });
      if (result.result.value) {
        ready = true;
        break;
      }
      await delay(50);
    }
    if (!ready) throw new Error('Battle document failed to start');
    const result = await cdp.send('Runtime.evaluate', {
      expression: `window.__battleProbe.done.then(() => ({
        frames: window.__battleProbe.frames, longTasks: window.__battleProbe.longTasks,
        srcWrites: window.__battleProbe.srcWrites,
        viewport: { width: innerWidth, height: innerHeight },
        paint: performance.getEntriesByType('paint').map(e => ({ name: e.name, start: e.startTime })),
        resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, duration: e.duration, bytes: e.decodedBodySize })),
        petVisible: !document.querySelector('#pet').hidden,
        engine: window.petBattle ? 'unexpected-host-bridge' : 'isolated-demo'
      }))`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    const data = result.result.value;
    const after = await cdp.send('Performance.getMetrics');
    const start = Object.fromEntries(before.metrics.map(({ name, value }) => [name, value]));
    const end = Object.fromEntries(after.metrics.map(({ name, value }) => [name, value]));
    const deltas = data.frames.map((frame) => frame.delta).sort((a, b) => a - b);
    const metrics = Object.fromEntries(
      [
        'LayoutCount',
        'RecalcStyleCount',
        'ScriptDuration',
        'LayoutDuration',
        'RecalcStyleDuration',
        'TaskDuration',
      ].map((name) => [name, end[name] - (start[name] || 0)]),
    );
    const writes = {};
    for (const entry of data.srcWrites) writes[entry.id] = (writes[entry.id] || 0) + 1;
    console.log(
      JSON.stringify(
        {
          mode: 'cold-profile HTTP demo; not Electron IPC or real user data',
          durationMs: duration,
          viewport: data.viewport,
          engine: data.engine,
          petVisible: data.petVisible,
          frameCount: deltas.length,
          frameMs: {
            p50: deltas[Math.floor(deltas.length * 0.5)] || 0,
            p95: deltas[Math.floor(deltas.length * 0.95)] || 0,
            max: deltas.at(-1) || 0,
          },
          framesOver32ms: deltas.filter((value) => value > 32).length,
          firstSecondFramesOver32ms: data.frames.filter(
            (frame) => frame.at <= 1000 && frame.delta > 32,
          ).length,
          longTasks: data.longTasks,
          paint: data.paint,
          imageSrcWrites: writes,
          uniqueImageUrls: new Set(data.srcWrites.map((entry) => entry.value)).size,
          metrics,
          resources: data.resources,
          errors,
        },
        null,
        2,
      ),
    );
    if (errors.length || data.engine !== 'isolated-demo' || !data.petVisible) process.exitCode = 1;
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
