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
    'ASSET_V1',
    'ASSET_V2',
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
});

test('표시 투명도는 배경·적·HP 바에 동일하게 적용된다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');

  assert.match(script, /background\.style\.opacity\s*=\s*String\(scene\.displayOpacity\)/);
  assert.match(script, /enemy\.style\.opacity\s*=.*String\(scene\.displayOpacity\)/);
  assert.match(script, /hpBar\.style\.opacity\s*=\s*String\(scene\.displayOpacity\)/);
});

test('renderer와 Electron IPC는 같은 epoch 시간 기준을 사용한다', async () => {
  const script = await readFile(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');

  assert.match(script, /return Date\.now\(\)/);
  assert.doesNotMatch(script, /performance\.now\(\)/);
});
