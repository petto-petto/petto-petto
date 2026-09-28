import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(hangingMenu, /className="hmenu-item pixel-button"/);
  assert.match(hangingMenu, /<Icon name=\{it\.key\} \/>/);
  assert.match(hangingMenu, /className="hmenu-label"/);
  // 원형 메뉴의 각도 배치는 더 이상 쓰지 않는다.
  assert.doesNotMatch(hangingMenu, /angle/);
  assert.doesNotMatch(overlay, /RadialMenu/);
});

test('진화 가능할 때만 펫 관리에 배지와 진화 패널을 띄운다', () => {
  assert.match(hangingMenu, /pet\.evolutionAvailable && \(\s*<span className="hmenu-dot">/);
  assert.match(hangingMenu, /item\.opensRoom && !pet\.evolutionAvailable/);
  assert.match(hangingMenu, /g\.doEvolve\(\)/);
});
