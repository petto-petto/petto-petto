import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const hangingMenu = readFileSync(
  join(packageRoot, '..', 'src', 'overlay', 'HangingMenu.jsx'),
  'utf8',
);
const overlay = readFileSync(join(packageRoot, '..', 'src', 'overlay', 'Overlay.jsx'), 'utf8');
const bridge = readFileSync(join(packageRoot, '..', 'src', 'platform', 'bridge.js'), 'utf8');
const app = readFileSync(join(packageRoot, '..', 'src', 'App.jsx'), 'utf8');
const growthHook = readFileSync(join(packageRoot, '..', 'src', 'growth', 'useGrowth.js'), 'utf8');
const overlayDirectory = join(packageRoot, '..', 'src', 'overlay');

test('팻말 메뉴는 전투·펫 관리·정보만 두고 공통 Electron bridge로 위임한다', () => {
  assert.match(hangingMenu, /key: 'battle', label: '전투', opensBattle: true/);
  assert.match(hangingMenu, /key: 'petmgmt', label: '펫 관리', opensRoom: true/);
  assert.match(hangingMenu, /key: 'info', label: '정보', panelScreen: 'info'/);
  assert.doesNotMatch(hangingMenu, /label: '업적'/);
  assert.doesNotMatch(hangingMenu, /label: '설정'/);
  assert.match(hangingMenu, /openPanel\(item\.panelScreen\)/);
  assert.match(hangingMenu, /openPetRoom\(\)/);
  assert.match(hangingMenu, /openBattle\(\)/);
  assert.match(bridge, /export function openPanel/);
  assert.match(bridge, /export function openPetRoom/);
  assert.match(bridge, /export function openBattle/);
});

/**
 * 시안 02(매달린 팻말)가 채택 디자인이다. 레일·걸이·아이콘 세 가지가 이 디자인을
 * 디자인답게 만드는 부분이라, 하나라도 빠지면 다른 메뉴가 된다.
 */
test('팻말 메뉴는 레일과 걸이 위에 아이콘과 라벨을 함께 건다', () => {
  assert.match(hangingMenu, /className="hmenu-rail"/);
  assert.match(hangingMenu, /hmenu-item pixel-button/);
  assert.match(hangingMenu, /<Icon name=\{it\.key\} \/>/);
  assert.match(hangingMenu, /className="hmenu-label"/);
  // 원형 메뉴의 각도 배치는 더 이상 쓰지 않는다.
  assert.doesNotMatch(hangingMenu, /angle/);
  assert.doesNotMatch(overlay, /RadialMenu/);
});

/**
 * 각 팻말은 한 가지 일만 한다.
 *
 * 예전에는 진화 가능할 때만 펫 관리가 펫룸 대신 "담당 파트가 구현합니다" 패널을 띄우고 그
 * 안에 진화 버튼이 있었다. 같은 버튼이 상황마다 달랐고, 처음 쓰는 사람은 진화하는 법을
 * 찾을 수 없었다. 이제 진화는 자기 팻말을 갖는다.
 */
test('펫 관리는 항상 펫룸만 열고 자리 표시용 패널이 없다', () => {
  assert.doesNotMatch(hangingMenu, /담당 파트가 구현/);
  assert.doesNotMatch(hangingMenu, /useState/, '열고 닫을 자체 패널이 없다');
  // 진화는 메뉴가 아니라 펫 머리 위 말풍선이 맡는다(팀 의견: 메뉴 패널은 별로).
  assert.doesNotMatch(hangingMenu, /evolutionAvailable|doEvolve|onEvolve/);
  assert.match(hangingMenu, /else if \(item\.opensRoom\) void openPetRoom/);
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
