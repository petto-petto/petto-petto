const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const readline = require('node:readline');

const { contextBridge } = require('electron');

const binaryName = process.platform === 'win32' ? 'pet-battle-engine.exe' : 'pet-battle-engine';
const binaryPath = path.join(__dirname, '..', 'rust', 'target', 'debug', binaryName);
const sidecar = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const listeners = new Set();
const lines = readline.createInterface({ input: sidecar.stdout });
lines.on('line', (line) => {
  for (const listener of listeners) listener(line);
});
sidecar.stderr.on('data', (chunk) => console.error(`[pet-battle-engine] ${chunk}`));

const transport = {
  send(line) {
    sidecar.stdin.write(`${line}\n`);
  },
  onLine(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const client = import(
  pathToFileURL(path.join(__dirname, '..', 'dist', 'ipc', 'client.js')).href
).then(({ RustBattleClient }) => new RustBattleClient(transport));

contextBridge.exposeInMainWorld('petBattle', {
  execute(command) {
    return client.then((battle) => battle.execute(command));
  },
});

process.once('exit', () => sidecar.kill());
