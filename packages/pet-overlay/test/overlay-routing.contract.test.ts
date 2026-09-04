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

test('원형 메뉴는 전투·정보·펫 관리만 상단에 두고 공통 Electron bridge로 위임한다', () => {
  assert.match(radialMenu, /key: 'battle', label: '전투', opensBattle: true, angle: 198/);
  assert.match(radialMenu, /panelScreen: 'info'/);
  assert.match(radialMenu, /key: 'petmgmt', label: '펫 관리', opensRoom: true, angle: -18/);
  assert.doesNotMatch(radialMenu, /label: '업적'/);
  assert.doesNotMatch(radialMenu, /label: '설정'/);
  assert.match(radialMenu, /opensRoom: true/);
  assert.match(radialMenu, /openPanel\(item\.panelScreen\)/);
  assert.match(radialMenu, /openPetRoom\(\)/);
  assert.match(radialMenu, /openBattle\(\)/);
  assert.match(bridge, /export function openPanel/);
  assert.match(bridge, /export function openPetRoom/);
  assert.match(bridge, /export function openBattle/);
});
