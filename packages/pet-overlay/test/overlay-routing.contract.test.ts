import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const radialMenu = readFileSync(
  join(packageRoot, '..', 'src', 'overlay', 'RadialMenu.jsx'),
  'utf8',
);
const bridge = readFileSync(join(packageRoot, '..', 'src', 'platform', 'bridge.js'), 'utf8');
const app = readFileSync(join(packageRoot, '..', 'src', 'App.jsx'), 'utf8');
const growthHook = readFileSync(join(packageRoot, '..', 'src', 'growth', 'useGrowth.js'), 'utf8');
const overlayDirectory = join(packageRoot, '..', 'src', 'overlay');

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

test('오버레이의 활성 펫은 명부가 정한다 — 이 창은 자기 값을 저장하지 않는다', () => {
  // 지정은 호출만 하고, 화면은 push 를 받고 나서 바꾼다(펫룸과 같은 규칙).
  assert.match(bridge, /export function roomScene/);
  assert.match(bridge, /export function setActivePet/);
  assert.match(bridge, /export function onActivePetChanged/);

  assert.match(app, /roomScene\(\)/);
  assert.match(app, /onActivePetChanged\(/);
  assert.match(app, /onSelectPet=\{setActivePet\}/);

  // 활성 펫 키를 따로 저장하던 경로가 남아 있으면 진실의 원천이 다시 둘이 된다.
  assert.doesNotMatch(app, /activePetKey/);
  assert.doesNotMatch(app, /saveOverlayState|loadOverlayState/);
  assert.equal(existsSync(join(overlayDirectory, 'state-storage.js')), false);
});

test('성장 기록은 종이 아니라 보유 개체를 키로 쓴다', () => {
  // 종을 키로 쓰면 같은 종 두 마리의 성장이 한 기록에서 합쳐진다.
  assert.match(growthHook, /export function useGrowth\(activePet\)/);
  assert.match(growthHook, /activePet\?\.ownedPetId/);
  assert.match(growthHook, /petKey: petKeys\.current\.get\(id\)/);
});

test('Electron 에서는 명부에 없는 대역 개체를 만들지 않는다', () => {
  // 대역을 초기값으로 두면 명부가 오기 전에 그 가짜 개체의 성장 행이 실제 DB에 남는다.
  assert.match(app, /const INITIAL_ROSTER = isElectron \? \[\] : PREVIEW_ROSTER/);
  assert.match(app, /if \(!activeView\) return null/);
});
