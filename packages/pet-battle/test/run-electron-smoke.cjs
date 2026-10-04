// Isolated real Electron verification with no Cargo on PATH; the parent owns profile cleanup.
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

async function main() {
  const prefix = path.join(tmpdir(), 'petto-battle-electron-smoke-');
  const profile = await mkdtemp(prefix);
  if (!path.resolve(profile).startsWith(path.resolve(prefix)))
    throw new Error('Unexpected profile path');
  try {
    const env = { ...process.env, PETTO_BATTLE_TEST_PROFILE: profile };
    for (const key of Object.keys(env))
      if (key.toLowerCase() === 'path' || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
    env.PATH = '';
    const child = spawn(require('electron'), [path.join(__dirname, 'attack.electron.cjs')], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
