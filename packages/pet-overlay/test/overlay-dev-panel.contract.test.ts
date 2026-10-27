import assert from 'node:assert/strict';
import test from 'node:test';

import { DEV_PANEL_QUERY, showsDevPanel } from '../src/overlay/dev-panel.ts';

test('Electron 오버레이는 시작 옵션이 붙인 질의 값이 있을 때만 개발 패널을 그린다', () => {
  assert.equal(showsDevPanel('', true), false, '옵션 없이 띄우면 숨긴다');
  assert.equal(showsDevPanel(`?${DEV_PANEL_QUERY}=1`, true), true);
  assert.equal(showsDevPanel(`?${DEV_PANEL_QUERY}=0`, true), false, '1 이 아니면 끈 것이다');
  assert.equal(showsDevPanel(`?${DEV_PANEL_QUERY}=`, true), false);
});

test('브라우저 미리보기는 옵션 없이도 개발 패널을 그린다 — 성장을 움직일 방법이 패널뿐이다', () => {
  assert.equal(showsDevPanel('', false), true);
});
