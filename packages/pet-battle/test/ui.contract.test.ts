import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const UI_ROOT = new URL('../ui/', import.meta.url);

test('HP 테두리·숫자·채움은 움직이지 않고 초록 그라데이션 농도만 변한다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');
  const bar = css.match(/\.enemy-hp\s*\{([^}]*)\}/)?.[1];
  const fill = css.match(/#enemy-hp-fill\s*\{([^}]*)\}/)?.[1];
  const surface = css.match(/#enemy-hp-fill::before\s*\{([^}]*)\}/)?.[1];
  assert.ok(bar && fill && surface);
  assert.doesNotMatch(bar, /transform:|animation:/);
  assert.doesNotMatch(fill, /transform:|animation:/);
  assert.match(fill, /overflow:\s*hidden/);
  assert.doesNotMatch(surface, /transform:|animation:|--hp-wave/);
  assert.match(surface, /inset:\s*0/);
  assert.match(surface, /linear-gradient\(90deg,\s*#8fd68a,\s*#3c7a4a,\s*#1c4a34\)/);
  assert.match(surface, /opacity:\s*var\(--hp-tone, 0\)/);
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  assert.doesNotMatch(html, /enemy-hp-trail/);
});

test('HP 끝은 오른쪽 2px 도트만 살짝 깎고 강한 소멸색·점멸·잔상을 없앤다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');
  const edge = css.match(/#enemy-hp-fill::after\s*\{([^}]*)\}/)?.[1];
  assert.ok(edge);
  assert.match(edge, /inset:\s*0 0 0 auto/);
  assert.match(edge, /width:\s*2px/);
  assert.match(edge, /max-width:\s*25%/);
  assert.match(edge, /#202439/);
  assert.doesNotMatch(edge, /#ffd166|#f08a8a|#f0b775|transform:|animation:|box-shadow:/);
  assert.match(edge, /clip-path:\s*polygon/);
  assert.match(edge, /opacity:\s*var\(--hp-edge-opacity, 0\)/);
});

test('내려찍기 잔광은 짧은 충격 신호가 끝나도 fade-out까지 독립 재생한다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');
  assert.match(css, /\.enemy-slam\.active i\s*\{/);
  assert.doesNotMatch(css, /\[data-enemy-impact='true'\] \.enemy-slam/);
});

test('지면 연출은 카메라와 관중을 함께 이동시키고 HUD는 고정한다', async () => {
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');
  assert.match(html, /id="battle-world"/);
  assert.match(html, /class="enemy-slam"/);
  assert.match(html, /class="defeat-burst"/);
  assert.match(script, /new ArenaDirector\(\)/);
  assert.match(script, /requestAnimationFrame\(animateArena\)/);
  assert.match(script, /worldPlane\.style\.transform/);
  assert.match(script, /visibleEnemyStage\(next\)/);
});

test('펫·스테이지·테마 전환은 직전 적의 피격 효과를 새 장면으로 넘기지 않는다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');
  assert.match(
    script,
    /if \(key !== arenaKey\)\s*\{\s*clearEnemyHitReaction\(\);\s*previousPetImpact = false;/,
  );
});

test('첫 상태 전에도 달빛 전투 배경과 로딩 안내를 표시하고 가짜 펫·적은 만들지 않는다', async () => {
  const html = await readFile(new URL('index.html', UI_ROOT), 'utf8');
  const background = html.match(/<img\b[^>]*id="battle-background"[^>]*>/)?.[0];
  assert.ok(background);
  assert.match(background, /src="\.\.\/assets\/backgrounds\/v2\/mushroom-forest\.png"/);
  const notice = html.match(/<p\b[^>]*id="battle-notice"[^>]*>([^<]*)<\/p>/);
  assert.ok(notice);
  assert.doesNotMatch(notice[0], /\bhidden\b/);
  assert.match(notice[1]!, /불러오는 중/);
  for (const id of ['pet-sheet', 'enemy-image']) {
    const element = html.match(new RegExp(`<img\\b[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(element);
    assert.doesNotMatch(element, /\bsrc=/);
    assert.match(element, /decoding="async"/);
  }
});

test('JS·IPC 준비 전에도 배경 크기가 0으로 줄지 않으며 기본색은 달빛 테마를 따른다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');
  const world = css.match(/\.camera-world\s*\{([^}]*)\}/)?.[1];
  assert.ok(world);
  assert.match(world, /width:\s*100%/);
  assert.match(world, /height:\s*100%/);
  const environment = css.match(/\.battle-environment\s*\{([^}]*)\}/)?.[1];
  assert.ok(environment);
  assert.doesNotMatch(environment, /background:\s*var\(--forest-deep\)/);
});

test('반복 조회는 이미지 주소를 재지정하지 않고 현재 펫의 공격만 미리 준비한다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');
  for (const [element, asset] of [
    ['background', 'backgroundAsset'],
    ['petSheet', 'petAsset'],
    ['enemyImage', 'enemyAsset'],
  ]) {
    assert.doesNotMatch(script, new RegExp(`${element}\\.src\\s*=`));
    assert.match(
      script,
      new RegExp(`setImageSource\\(${element}, assetUrl\\(scene\\.${asset}\\)\\)`),
    );
  }
  assert.match(
    script,
    /battleImages\.preload\(hasPet \? assetUrl\(scene\.petAttackAsset\) : null\)/,
  );
});

test('관중 배치와 버튼 라벨 갱신은 변경 직후 불필요한 레이아웃·텍스트 재생성을 피한다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');
  assert.match(script, /layout\.width \+ worldOverscan \* 2/);
  assert.match(script, /layout\.height \+ worldOverscan \* 2/);
  assert.match(script, /button && button\.textContent !== label/);
});

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
  assert.match(css, /--pet-size:\s*96px/);
  assert.match(css, /\.enemy\s*\{[^}]*width:\s*var\(--enemy-frame-size\)/s);
  assert.match(css, /\.enemy img\s*\{[^}]*max-width:\s*var\(--enemy-frame-size\)/s);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(html, /data-character="pet"/);
  assert.match(html, /data-character="enemy"/);
  assert.doesNotMatch(html, /pet-identity|id="pet-name"|id="pet-level"/);
  assert.doesNotMatch(css, /\.pet-identity/);
});

test('처치 적 관중은 제거하고 빼꼼 펫·반딧불·현재 전투 적은 유지한다', async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL('index.html', UI_ROOT), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /class="peeking-spectators"/);
  assert.doesNotMatch(html, /spectators-left/);
  assert.match(html, /id="pet-spectators"/);
  assert.doesNotMatch(html, /defeated-enemy-spectators|spectators-right/);
  assert.doesNotMatch(script, /defeatedEnemySpectators|defeatedEnemyColors|spectatorElement/);
  assert.match(script, /hasDefeatedSpectators:\s*false/);
  assert.match(html, /id="enemy-image"/);
  assert.match(html, /class="fireflies"/);
  assert.doesNotMatch(css, /spectator-cheer|enemy-fan|defeated-fan/);
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

test('이미지 교체 중에도 실제 스프라이트의 정사각 프레임 비율과 96px 높이를 유지한다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');
  const sheet = css.match(/\.pet-sheet\s*\{([^}]+)\}/s)?.[1] ?? '';
  // Pending src can still paint the previous six-frame bitmap: the next four-frame
  // profile must not squeeze it into a narrower strip before decoding finishes.
  assert.match(sheet, /width:\s*auto;/);
  assert.match(sheet, /height:\s*var\(--pet-size\);/);
  assert.doesNotMatch(sheet, /width:[^;]*var\(--frame-count\)/);
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
  assert.match(script, /placeActor\(\s*pet,/);
  assert.match(script, /element\.style\.bottom = `\$\{layout\.height - foot\}px`/);
  assert.match(script, /element\.style\.transform = `scale/);
});

test('v2 펫은 전투 캐릭터와 이펙트보다 위 레이어에 유지된다', async () => {
  const css = await readFile(new URL('battle.css', UI_ROOT), 'utf8');

  assert.match(css, /\.pet\s*\{[^}]*z-index:\s*7;/s);
  assert.match(css, /\.enemy\s*\{[^}]*z-index:\s*2;/s);
  assert.match(css, /\.combat-effects\s*\{[^}]*z-index:\s*3;/s);
});

test('전투 패키지 공개 계약과 화면은 v1 선택 경로를 제공하지 않는다', async () => {
  const [contracts, overlay] = await Promise.all([
    readFile(new URL('../src/contracts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(contracts, /AssetVersion|SELECT_ASSET_VERSION|V1/);
  assert.doesNotMatch(overlay, /ASSET_V1|ASSET_V2|SELECT_ASSET_VERSION/);
});

test('걸음 프레임은 지면 발구름과 동기화하고 수동 공격도 몸 접촉 거리를 공유한다', async () => {
  const [script, css] = await Promise.all([
    readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8'),
    readFile(new URL('battle.css', UI_ROOT), 'utf8'),
  ]);
  assert.match(script, /combatContactDistance\(layout, base.enemyHeight\)/);
  assert.match(script, /separateCombatants\(/);
  assert.match(script, /frame.petStep/);
  assert.match(script, /frame.enemyStep/);
  assert.match(script, /petSheet.style.transform/);
  assert.doesNotMatch(css, /animation:\s*pet-walk/);
});
