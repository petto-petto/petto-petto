import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const UI_ROOT = new URL('../ui/', import.meta.url);

test('상단에는 스테이지·HP만 남기고 모션 버튼과 전용 공간을 제거한다', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);
  const header = html.match(/<header class="battle-hud">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /id="stage-label"/);
  assert.match(header, /id="enemy-hp-fill"/);
  assert.doesNotMatch(header, /모션|<button/);
  assert.doesNotMatch(html, /data-action="REDUCED_MOTION"/);
  assert.doesNotMatch(css, /\.motion-toggle/);
  assert.match(css, /\.battle-hud\s*\{[^}]*grid-template-columns:\s*62px 1fr;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('분위기 로그에는 기척·연출 제목 없이 로그 목록만 표시한다', async () => {
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  const panels = [
    ...html.matchAll(/<aside\b[^>]*data-ambient-side="(?:PET|ENEMY)"[^>]*>([\s\S]*?)<\/aside>/g),
  ];
  assert.equal(panels.length, 2);
  for (const panel of panels) {
    assert.doesNotMatch(panel[1]!, /<h2\b|기척|연출/);
    assert.match(panel[1]!, /role="log"/);
  }
});

test('관중은 머리를 사각형으로 자르지 않고 온전한 프레임을 기울여 장애물 뒤에서 나온다', async () => {
  const [css, script] = await Promise.all([
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(script, /className = 'peek-actor'/);
  assert.match(script, /className = 'peek-sprite'/);
  assert.doesNotMatch(css, /\.peek-head/);
  assert.match(css, /rotate\(var\(--peek-angle\)\)/);
  assert.match(css, /clip-path:\s*polygon/);
});

test('전투 오버레이는 창을 채우며 이름·레벨 패널 없이 픽셀 캐릭터를 유지한다', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);

  assert.match(css, /width:\s*100%/);
  assert.match(css, /height:\s*100%/);
  assert.doesNotMatch(css, /--battle-(width|height)/);
  assert.match(css, /--pet-size:\s*128px/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(html, /data-character="pet"/);
  assert.match(html, /data-character="enemy"/);
  assert.doesNotMatch(html, /pet-identity|id="pet-name"|id="pet-level"/);
  assert.doesNotMatch(css, /\.pet-identity/);
});

test('보유 펫은 배경 뒤에서 빼꼼하고 처치 적과 반딧불 레이어는 유지한다', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);

  assert.match(html, /class="peeking-spectators"/);
  assert.doesNotMatch(html, /spectators-left/);
  assert.match(html, /class="spectators spectators-right"/);
  assert.match(html, /id="pet-spectators"/);
  assert.match(html, /id="defeated-enemy-spectators"/);
  assert.doesNotMatch(html, /spectators-right[\s\S]*purple-steady/);
  assert.match(html, /class="fireflies"/);
  assert.match(css, /@keyframes\s+spectator-cheer/);
  assert.match(css, /@keyframes\s+spectator-peek/);
  assert.match(css, /\.peek-slot\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.reduced-motion \.peek-actor\s*\{[^}]*animation:\s*none !important/s);
  assert.match(css, /@keyframes\s+firefly-drift/);
  assert.match(css, /@keyframes\s+firefly-blink/);
});

test('프로토타입에서 합의한 펫·적 제어가 하나도 빠지지 않는다', async () => {
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  const actions = [
    'START',
    'STOP',
    'ATTACK',
    'GROWTH',
    'ATTACK_EFFECT',
    'PET_ASSET',
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
  assert.match(html, />펫</);
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

test('펫 발밑 보정은 대기 이미지를 사용하고 프레임·공격 이동과 분리된다', async () => {
  const [script, css] = await Promise.all([
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);
  assert.match(
    script,
    /petGrounding\.setSource\(hasPet \? assetUrl\(scene\.petIdleAsset\) : null\)/,
  );
  assert.match(script, /petGrounding\.resize\(layout\.petSize\)/);
  assert.match(
    css,
    /\.pet-viewport\s*\{[^}]*transform:\s*translateY\(var\(--pet-ground-offset, 0px\)\)/s,
  );
  assert.match(css, /transform:\s*translateX\(var\(--sheet-shift\)\)/);
  assert.match(
    script,
    /pet\.style\.transform = `translate\(\$\{offset\.x\}px, \$\{offset\.y\}px\) scale/,
  );
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
