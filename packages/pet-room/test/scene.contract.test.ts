/** 펫룸 장면 규칙의 실행 증거 — 낮/밤, 배회 영역, 위치 갱신, 깊이, 클릭 판정. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  backgroundAssetPath,
  backgroundAt,
  backgroundFrameIndexAt,
  clampToWalkArea,
  drawBoxOf,
  hitTest,
  inDrawOrder,
  InvalidWalkAreaError,
  layersInDrawOrder,
  phaseAt,
  PET_SCALE,
  ROAM_SPEED_PX_PER_SEC,
  spawnRoamingPet,
  stepRoaming,
  walkAreaOf,
  type BackgroundAnimation,
  type BackgroundMeta,
  type RoamingPet,
  type WalkArea,
} from '@pet/room';

/**
 * 결정론적 난수. 배회는 난수를 쓰지만 테스트는 매번 같은 결과를 봐야 한다.
 * mulberry32 — 짧고 분포가 고르다.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 실제 `bg_002.json`을 옮긴 값. 계약이 바뀌면 이 픽스처가 먼저 어긋난다. */
function forestMeta(): BackgroundMeta {
  return {
    id: 'bg_002',
    name: '깊은 숲 (낮)',
    width: 960,
    height: 360,
    horizon: 162,
    groundTop: 282,
    petAnchor: { x: 432, y: 186, w: 96, h: 96 },
    composite: 'bg_002_composite.png',
    layers: [
      { name: 'near', file: 'bg_002_near.png', z: 3, parallax: 1.0, opaque: false },
      { name: 'sky', file: 'bg_002_sky.png', z: 0, parallax: 0.0, opaque: true },
      { name: 'mid', file: 'bg_002_mid.png', z: 2, parallax: 0.55, opaque: false },
      { name: 'far', file: 'bg_002_far.png', z: 1, parallax: 0.25, opaque: false },
    ],
    animation: {
      layer: 'near',
      fps: 6,
      loop: true,
      frames: Array.from({ length: 12 }, (_, i) => `frames/near_${String(i).padStart(2, '0')}.png`),
    },
  };
}

const at = (hour: number, minute = 0): Date => new Date(2026, 8, 3, hour, minute, 0);

/* ---------- 낮 / 밤 ---------- */

test('낮과 밤의 경계는 06:00과 18:00이다', () => {
  assert.equal(phaseAt(at(5, 59)), 'night');
  assert.equal(phaseAt(at(6, 0)), 'day');
  assert.equal(phaseAt(at(17, 59)), 'day');
  assert.equal(phaseAt(at(18, 0)), 'night');
});

test('자정과 정오도 각각 밤과 낮이다', () => {
  assert.equal(phaseAt(at(0, 0)), 'night');
  assert.equal(phaseAt(at(12, 0)), 'day');
});

test('낮에는 bg_002, 밤에는 bg_003을 쓴다', () => {
  const day = backgroundAt(at(13));
  assert.equal(day.id, 'bg_002');
  assert.equal(day.directory, 'bg_002_deep_forest');
  assert.equal(day.metaFile, 'bg_002.json');

  const night = backgroundAt(at(22));
  assert.equal(night.id, 'bg_003');
  assert.equal(night.directory, 'bg_003_deep_forest_night');
  assert.equal(night.metaFile, 'bg_003.json');
});

test('배경 경로는 renderer 기준 상대 경로다 — 선두 슬래시는 파일 시스템 루트를 가리킨다', () => {
  const path = backgroundAssetPath('bg_002_deep_forest', 'frames/near_00.png');
  assert.equal(path, 'assets/backgrounds/bg_002_deep_forest/frames/near_00.png');
  assert.ok(!path.startsWith('/'));
});

/* ---------- 레이어와 반딧불이 ---------- */

test('레이어는 json 배열 순서가 아니라 z 오름차순으로 그린다', () => {
  const names = layersInDrawOrder(forestMeta()).map((layer) => layer.name);
  assert.deepEqual(names, ['sky', 'far', 'mid', 'near']);
});

test('반딧불이는 12프레임을 6fps로 순환한다', () => {
  const animation = forestMeta().animation as BackgroundAnimation;
  assert.equal(backgroundFrameIndexAt(animation, 0), 0);
  assert.equal(backgroundFrameIndexAt(animation, 166), 0);
  assert.equal(backgroundFrameIndexAt(animation, 167), 1);
  // 12프레임 / 6fps = 2초에 한 바퀴.
  assert.equal(backgroundFrameIndexAt(animation, 2000), 0);
  assert.equal(backgroundFrameIndexAt(animation, 2000 + 167), 1);
});

test('루프가 아닌 배경 애니메이션은 마지막 프레임에서 멈춘다', () => {
  const animation: BackgroundAnimation = {
    layer: 'near',
    fps: 6,
    loop: false,
    frames: ['a.png', 'b.png', 'c.png'],
  };
  assert.equal(backgroundFrameIndexAt(animation, 10_000), 2);
});

/* ---------- 배회 영역 ---------- */

test('배회 영역은 지면 위에 있고 전경 나무 기둥을 피한다', () => {
  const area = walkAreaOf(forestMeta());

  // 지면(groundTop 282)보다 아래에서 시작해 화면 바닥(360) 안에서 끝난다.
  assert.ok(area.y > 282, `발 y 시작 ${area.y}이 groundTop보다 위다`);
  assert.ok(area.y + area.height < 360, '발 y 끝이 화면 밖이다');

  // 좌우 기둥(실측 0~59, 876~942)에 펫의 절반(24px)이 닿지 않는다.
  assert.ok(area.x - 24 > 59, `왼쪽 기둥과 겹친다 (x ${area.x})`);
  assert.ok(area.x + area.width + 24 < 876, `오른쪽 기둥과 겹친다 (right ${area.x + area.width})`);
});

test('메타가 walkArea를 주면 유도하지 않고 그대로 쓴다', () => {
  const given: WalkArea = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(walkAreaOf({ ...forestMeta(), walkArea: given }), given);
});

test('지면이 없는 배경은 조용히 이상한 영역을 만들지 않고 던진다', () => {
  const broken = { ...forestMeta(), groundTop: 355 };
  assert.throws(() => walkAreaOf(broken), InvalidWalkAreaError);
});

test('클램프는 영역 경계를 넘지 않는다', () => {
  const area: WalkArea = { x: 100, y: 300, width: 200, height: 40 };
  assert.deepEqual(clampToWalkArea(area, -50, -50), { x: 100, y: 300 });
  assert.deepEqual(clampToWalkArea(area, 9999, 9999), { x: 300, y: 340 });
  assert.deepEqual(clampToWalkArea(area, 150, 320), { x: 150, y: 320 });
});

/* ---------- 배회 ---------- */

const insideArea = (area: WalkArea, pet: RoamingPet): boolean =>
  pet.x >= area.x &&
  pet.x <= area.x + area.width &&
  pet.y >= area.y &&
  pet.y <= area.y + area.height;

test('배회하는 펫은 어떤 프레임에서도 영역을 벗어나지 않는다', () => {
  const area = walkAreaOf(forestMeta());
  const random = seededRandom(20_260_903);
  const pets = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => spawnRoamingPet(id, area, random));

  for (const pet of pets)
    assert.ok(insideArea(area, pet), `시작 위치가 영역 밖이다: ${pet.ownedPetId}`);

  // 60fps로 2분치.
  for (let frame = 0; frame < 60 * 120; frame += 1) {
    stepRoaming(pets, area, 1 / 60, random);
    for (const pet of pets) {
      assert.ok(insideArea(area, pet), `${frame}프레임에서 영역을 벗어났다: ${pet.ownedPetId}`);
    }
  }
});

test('펫은 1초에 ROAM_SPEED만큼 목표를 향해 움직인다', () => {
  const area: WalkArea = { x: 0, y: 0, width: 1000, height: 1000 };
  const pets: RoamingPet[] = [
    { ownedPetId: 'a', x: 100, y: 100, targetX: 300, targetY: 100, restMs: 0 },
  ];
  // 60fps로 1초. 한 번에 dt=1을 넘기면 클램프에 걸리므로(아래 테스트) 프레임을 쌓는다.
  for (let frame = 0; frame < 60; frame += 1) stepRoaming(pets, area, 1 / 60, () => 0.5);

  const moved = pets[0];
  assert.ok(moved);
  assert.equal(Math.round(moved.x), 100 + ROAM_SPEED_PX_PER_SEC);
  // 목표가 같은 높이에 있으므로 y는 움직이지 않는다.
  assert.equal(moved.y, 100);
});

test('쉬는 중인 펫은 움직이지 않고 남은 시간만 줄인다', () => {
  const area: WalkArea = { x: 0, y: 0, width: 1000, height: 1000 };
  const pets: RoamingPet[] = [
    { ownedPetId: 'a', x: 100, y: 100, targetX: 900, targetY: 900, restMs: 500 },
  ];
  stepRoaming(pets, area, 0.1, () => 0.5);
  const resting = pets[0];
  assert.ok(resting);
  assert.equal(resting.x, 100);
  assert.equal(resting.y, 100);
  assert.equal(resting.restMs, 400);
});

test('목표에 닿으면 새 목표를 고르고 잠시 쉰다', () => {
  const area: WalkArea = { x: 0, y: 0, width: 1000, height: 1000 };
  const pets: RoamingPet[] = [
    { ownedPetId: 'a', x: 500, y: 500, targetX: 500, targetY: 500, restMs: 0 },
  ];
  stepRoaming(pets, area, 1 / 60, seededRandom(7));
  const retargeted = pets[0];
  assert.ok(retargeted);
  assert.ok(retargeted.targetX !== 500 || retargeted.targetY !== 500, '목표가 갱신되지 않았다');
  assert.ok(retargeted.restMs > 0, '쉬지 않고 바로 다음 목표로 출발했다');
});

test('창이 백그라운드에 있다 돌아와도 펫이 순간이동하지 않는다', () => {
  const area: WalkArea = { x: 0, y: 0, width: 10_000, height: 10_000 };
  const pets: RoamingPet[] = [
    { ownedPetId: 'a', x: 0, y: 0, targetX: 9000, targetY: 0, restMs: 0 },
  ];
  // dt 30초가 그대로 들어와도 한 프레임분(0.1초)까지만 반영된다.
  stepRoaming(pets, area, 30, () => 0.5);
  const moved = pets[0];
  assert.ok(moved);
  assert.ok(moved.x <= ROAM_SPEED_PX_PER_SEC * 0.1 + 0.001, `${moved.x}px나 움직였다`);
});

/* ---------- 깊이와 클릭 ---------- */

test('발이 아래에 있는 펫이 나중에(= 앞에) 그려진다', () => {
  const pets: RoamingPet[] = [
    { ownedPetId: 'back', x: 0, y: 300, targetX: 0, targetY: 300, restMs: 0 },
    { ownedPetId: 'front', x: 0, y: 340, targetX: 0, targetY: 340, restMs: 0 },
    { ownedPetId: 'middle', x: 0, y: 320, targetX: 0, targetY: 320, restMs: 0 },
  ];
  assert.deepEqual(
    inDrawOrder(pets).map((pet) => pet.ownedPetId),
    ['back', 'middle', 'front'],
  );
});

test('그릴 사각형은 발이 하단 중앙이 되도록 놓인다', () => {
  const pet: RoamingPet = {
    ownedPetId: 'a',
    x: 200,
    y: 340,
    targetX: 200,
    targetY: 340,
    restMs: 0,
  };
  const box = drawBoxOf(pet, 32, 32);
  assert.equal(box.width, 32 * PET_SCALE);
  assert.equal(box.height, 32 * PET_SCALE);
  assert.equal(box.left, 200 - 32);
  assert.equal(box.top, 340 - 64);
});

test('EPIC stage3(48px)도 32로 하드코딩되지 않고 제 크기로 잡힌다', () => {
  const pet: RoamingPet = {
    ownedPetId: 'a',
    x: 200,
    y: 340,
    targetX: 200,
    targetY: 340,
    restMs: 0,
  };
  const box = drawBoxOf(pet, 48, 48);
  assert.equal(box.width, 96);
  assert.equal(box.height, 96);
  // 배경 계약의 petAnchor.h가 96이다 — 배경이 기대하는 크기와 맞는다.
  assert.equal(box.height, forestMeta().petAnchor.h);
});

test('겹친 펫을 클릭하면 앞에 그려진 쪽이 선택된다', () => {
  const boxes = [
    { ownedPetId: 'back', left: 100, top: 200, width: 64, height: 64 },
    { ownedPetId: 'front', left: 110, top: 210, width: 64, height: 64 },
  ];
  assert.equal(hitTest(boxes, 120, 220), 'front');
  // 앞 펫이 덮지 않은 자리는 뒤 펫이 받는다.
  assert.equal(hitTest(boxes, 102, 202), 'back');
});

test('빈 자리를 클릭하면 아무도 선택되지 않는다', () => {
  const boxes = [{ ownedPetId: 'a', left: 100, top: 200, width: 64, height: 64 }];
  assert.equal(hitTest(boxes, 10, 10), undefined);
  // 경계는 오른쪽·아래를 포함하지 않는다.
  assert.equal(hitTest(boxes, 164, 220), undefined);
});
