import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceUi = path.join(packageRoot, 'ui');
const outputUi = path.join(packageRoot, 'dist', 'ui');
const files = [
  'index.html',
  'battle.css',
  'host-preload.cjs',
  'preload.cjs',
  'window-options.json',
  'demo-main.cjs',
];

await mkdir(outputUi, { recursive: true });
for (const file of files) await copyFile(path.join(sourceUi, file), path.join(outputUi, file));

async function copyRuntimeAssets(source, relative = '') {
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`UI assets cannot contain symlinks: ${entry.name}`);
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) await copyRuntimeAssets(source, child);
    else if (entry.isFile() && entry.name.endsWith('.png')) {
      const destination = path.join(outputUi, 'assets', child);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(source, child), destination);
    }
  }
}

await copyRuntimeAssets(path.join(sourceUi, 'assets'));
