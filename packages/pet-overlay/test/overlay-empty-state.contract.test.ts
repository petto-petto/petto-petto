import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]): string =>
  readFileSync(join(packageRoot, '..', 'src', ...segments), 'utf8');

const app = read('App.jsx');
const emptyPet = read('overlay', 'EmptyPet.jsx');
const overlay = read('overlay', 'Overlay.jsx');
const bridge = read('platform', 'bridge.js');
const styles = read('styles.css');

/**
 * 첫 펫은 뽑기로만 생긴다. 그런데 메뉴에도 트레이에도 뽑기 진입점이 없어서, 뽑기 창을
 * 닫고 나면 오버레이가 유일한 복귀 경로다. 이게 없으면 세션 안에서 막힌다.
 */
test('보유 펫이 0마리면 뽑기로 가는 길을 보여 준다', () => {
  assert.match(app, /rosterLoaded && roster\.length === 0/);
  assert.match(emptyPet, /onClick=\{\(\) => void openGacha\(\)\}/);
  assert.match(bridge, /export function openGacha/);
  assert.match(styles, /\.empty-pet \{/);
});

/**
 * 투명 오버레이는 hit-test 훅이 setInteractive 를 불러야 입력을 받는다. 빈 상태 패널이
 * 그 훅 밖에 있어서 버튼이 눌리지도, 창이 움직이지도 않았다.
 */
test('빈 상태 패널도 hit-test 를 건다', () => {
  assert.match(emptyPet, /useOverlayHitTest\(\)/);
  assert.match(overlay, /useOverlayHitTest\(menuOpen\)/);
  assert.match(emptyPet, /className="pet-anchor io"/, '.io 가 있어야 hit-test 가 잡는다');
});

/**
 * "명부가 아직 안 옴"과 "보유 펫 0마리"는 다른 상태다. 둘을 구분하지 않으면 로딩 중에
 * 안내가 번쩍이거나, 0마리인데 투명 창만 남는다.
 */
test('명부 도착 전과 0마리를 구분한다', () => {
  assert.match(app, /const \[rosterLoaded, setRosterLoaded\] = useState\(!isElectron\)/);
  assert.match(app, /setRosterLoaded\(true\);/);
  assert.match(app, /if \(!activeView\) return null;/);
});

/**
 * 오버레이 창은 alwaysOnTop 이다. 뽑기 창이 떠 있는데 안내를 그리면 그 창을 덮는다 —
 * 실제로 뽑기 화면이 가려졌다.
 */
test('뽑기 창이 떠 있는 동안에는 안내를 그리지 않는다', () => {
  assert.match(app, /onGachaVisibility\(setGachaOpen\)/);
  assert.match(app, /gachaOpen \? null : <EmptyPet \/>/);
  assert.match(bridge, /export function onGachaVisibility/);
});

/**
 * 시작 시 broadcast 는 오버레이가 구독하기 전에 지나간다. 그것만 믿으면 첫 실행에
 * 안내가 뽑기 창을 덮은 채로 남는다 — 실제로 그랬다.
 */
test('마운트할 때 뽑기 창 상태를 한 번 묻는다', () => {
  assert.match(app, /void isGachaOpen\(\)/);
  assert.match(bridge, /export function isGachaOpen/);
});

/**
 * 오버레이는 프레임이 없어서 끌 수 있는 자리가 내용뿐이다. 펫은 끌 수 있는데 이 패널만
 * 못 끌면 첫 실행 화면이 한자리에 박힌다.
 */
test('빈 상태 패널도 끌어서 창을 옮길 수 있다', () => {
  assert.match(emptyPet, /dragStart\(e\.screenX, e\.screenY\)/);
  assert.match(emptyPet, /dragMove\(e\.screenX, e\.screenY\)/);
  assert.match(emptyPet, /dragEnd\(\)/);
  // 버튼 위에서 드래그를 시작하면 포인터 캡처가 클릭을 삼킨다.
  assert.match(emptyPet, /e\.target\.closest\?\.\('\.empty-pet-cta'\)/);
});
