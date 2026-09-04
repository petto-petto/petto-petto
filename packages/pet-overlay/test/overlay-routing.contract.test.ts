import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const radialMenu = readFileSync(
  join(packageRoot, '..', 'src', 'overlay', 'RadialMenu.jsx'),
  'utf8',
);
const bridge = readFileSync(join(packageRoot, '..', 'src', 'platform', 'bridge.js'), 'utf8');

test('원형 메뉴는 메타 패널과 펫룸 진입을 공통 Electron bridge로 위임한다', () => {
  assert.match(radialMenu, /panelScreen: 'info'/);
  assert.match(radialMenu, /panelScreen: 'achievements'/);
  assert.match(radialMenu, /panelScreen: 'settings'/);
  assert.match(radialMenu, /opensRoom: true/);
  assert.match(radialMenu, /openPanel\(item\.panelScreen\)/);
  assert.match(radialMenu, /openPetRoom\(\)/);
  assert.match(bridge, /export function openPanel/);
  assert.match(bridge, /export function openPetRoom/);
});
