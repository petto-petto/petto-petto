import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const UI_ROOT = new URL('../ui/', import.meta.url);

test('전투 오버레이는 360×180 픽셀 화면과 양쪽 원형 메뉴를 제공한다', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);

  assert.match(css, /--battle-width:\s*360px/);
  assert.match(css, /--battle-height:\s*180px/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(html, /data-character="pet"/);
  assert.match(html, /data-character="enemy"/);
});

test('프로토타입에서 합의한 펫·적 제어가 하나도 빠지지 않는다', async () => {
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  const actions = [
    'START',
    'STOP',
    'ATTACK',
    'GROWTH',
    'ATTACK_EFFECT',
    'HIT',
    'DEFEAT',
    'SPAWN',
    'RESET',
    'SIZE',
    'COLOR',
    'HP',
  ];

  for (const action of actions) {
    assert.match(html, new RegExp(`data-action="${action}"`), `${action} 버튼이 필요하다`);
  }
  assert.match(html, /type="range"/);
  assert.match(html, /data-action="OPACITY"/);
  assert.doesNotMatch(html, /data-action="ASSET_V[12]"/);
  assert.doesNotMatch(html, /\/v1\//);
});

test('표시 투명도는 펫을 제외한 전투 환경·적·HP 바에 동일하게 적용된다', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="battle-environment"/);
  assert.match(script, /environment\.style\.opacity\s*=\s*String\(scene\.displayOpacity\)/);
  assert.match(script, /enemy\.style\.opacity\s*=.*String\(scene\.displayOpacity\)/);
  assert.match(script, /hpBar\.style\.opacity\s*=\s*String\(scene\.displayOpacity\)/);
  assert.doesNotMatch(script, /pet\.style\.opacity/);
});

test('renderer와 Electron IPC는 같은 epoch 시간 기준을 사용한다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');

  assert.match(script, /return Date\.now\(\)/);
  assert.doesNotMatch(script, /performance\.now\(\)/);
});

test('상태 조회 중에도 사용자의 버튼 명령은 버리지 않는다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');

  assert.match(script, /command\.type === 'GET_STATE' && inFlight > 0/);
  assert.doesNotMatch(script, /if \(busy\) return/);
});

test('수동 맞기와 실제 공격은 하나의 피격 애니메이션 클래스를 공유한다', async () => {
  const [script, css] = await Promise.all([
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);

  assert.match(script, /shouldStartEnemyHitReaction/);
  assert.match(script, /enemy\.classList\.add\('hit-reaction'\)/);
  assert.match(css, /\.enemy\.hit-reaction\s*\{[^}]*animation:\s*enemy-hit 420ms/s);
  assert.doesNotMatch(css, /\[data-enemy-phase='HIT'\] \.enemy/);
});

test('공격 스프라이트는 한 번만 재생하고 마지막 프레임을 유지한다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');

  assert.match(
    css,
    /\.pet-sheet\.animated-sheet\s*\{[^}]*animation:\s*pet-frames[^;]*1 forwards;/s,
  );
  assert.doesNotMatch(css, /animation:\s*pet-frames[^;]*infinite/);
  assert.match(css, /steps\(var\(--frame-steps\)\)/);
});

test('v2 펫은 전투 캐릭터와 이펙트보다 위 레이어에 유지된다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');

  assert.match(css, /\.pet\s*\{[^}]*z-index:\s*7;/s);
  assert.match(css, /\.enemy\s*\{[^}]*z-index:\s*2;/s);
  assert.match(css, /\.combat-effects\s*\{[^}]*z-index:\s*3;/s);
});

test('전투 패키지 공개 계약과 에셋 생성기는 v1 선택 경로를 제공하지 않는다', async () => {
  const [contracts, overlay, pipeline] = await Promise.all([
    readFile(new URL('../src/contracts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
    readFile(new URL('../rust/src/asset_pipeline.rs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(contracts, /AssetVersion|SELECT_ASSET_VERSION|V1/);
  assert.doesNotMatch(overlay, /ASSET_V1|ASSET_V2|SELECT_ASSET_VERSION/);
  assert.doesNotMatch(pipeline, /\("v1"/);
});
