/** 펫룸 장면 규칙의 실행 증거 — 낮/밤, 배회 영역, 위치 갱신, 깊이, 클릭 판정. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  backgroundAssetPath,
  backgroundAt,
  backgroundOf,
  isSameBackground,
  backgroundFrameIndexAt,
  clampToWalkArea,
  clipWalkAreaToViewport,
  drawBoxOf,
  hitTest,
  inDrawOrder,
  InvalidWalkAreaError,
  layersInDrawOrder,
  phaseAt,
  seasonAt,
  BACKGROUND_PHASES,
  SEASONS,
  PET_SCALE,
  ROAM_SPEED_PX_PER_SEC,
  spawnRoamingPet,
  stepRoaming,
  SCENE_SCALE,
  viewportOf,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
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

/* ---------- 계절 / 시간대 ---------- */

/** 계절을 보려면 달을 움직여야 한다. `at`은 9월로 고정이다. */
const onDate = (month: number, day: number, hour = 12): Date =>
  new Date(2026, month - 1, day, hour, 0, 0);

test('시간대 경계는 05:00 · 08:00 · 17:00 · 20:00이다', () => {
  assert.equal(phaseAt(at(4, 59)), 'night');
  assert.equal(phaseAt(at(5, 0)), 'dawn');
  assert.equal(phaseAt(at(7, 59)), 'dawn');
  assert.equal(phaseAt(at(8, 0)), 'day');
  assert.equal(phaseAt(at(16, 59)), 'day');
  assert.equal(phaseAt(at(17, 0)), 'dusk');
  assert.equal(phaseAt(at(19, 59)), 'dusk');
  assert.equal(phaseAt(at(20, 0)), 'night');
});

test('밤은 하루를 가로지른다 — 자정도 밤이다', () => {
  assert.equal(phaseAt(at(0, 0)), 'night');
  assert.equal(phaseAt(at(23, 59)), 'night');
});

test('계절 경계는 3·6·9·12월이다', () => {
  assert.equal(seasonAt(onDate(2, 28)), 'winter');
  assert.equal(seasonAt(onDate(3, 1)), 'spring');
  assert.equal(seasonAt(onDate(5, 31)), 'spring');
  assert.equal(seasonAt(onDate(6, 1)), 'summer');
  assert.equal(seasonAt(onDate(8, 31)), 'summer');
  assert.equal(seasonAt(onDate(9, 1)), 'autumn');
  assert.equal(seasonAt(onDate(11, 30)), 'autumn');
  assert.equal(seasonAt(onDate(12, 1)), 'winter');
});

test('겨울은 해를 가로지른다 — 1월도 겨울이다', () => {
  assert.equal(seasonAt(onDate(1, 15)), 'winter');
});

/**
 * 경계를 손으로 짚는 검사만 두면 구간 사이에 구멍이 나도 모른다. 하루 24시간과
 * 열두 달을 전부 훑어 선언된 값만 나오는지 본다.
 */
test('24시간과 열두 달 어디에도 구멍이 없다', () => {
  for (let hour = 0; hour < 24; hour += 1) {
    assert.ok(
      (BACKGROUND_PHASES as readonly string[]).includes(phaseAt(at(hour))),
      `${hour}시가 어느 시간대에도 속하지 않는다`,
    );
  }
  for (let month = 1; month <= 12; month += 1) {
    assert.ok(
      (SEASONS as readonly string[]).includes(seasonAt(onDate(month, 15))),
      `${month}월이 어느 계절에도 속하지 않는다`,
    );
  }
});

/**
 * 이 검사가 없어서 켜 둔 창의 배경이 하루 종일 바뀌지 않았다.
 *
 * `refreshBackground`가 `id`로 같은지 보는데 16 variant가 전부 `bg_007`이라
 * 언제나 "안 바뀌었다"가 나왔다. 그림을 가르는 것은 `metaFile`이다.
 */
test('같은 id라도 계절이나 시간대가 다르면 다른 배경이다', () => {
  const autumnDay = backgroundOf('autumn', 'day');
  const autumnNight = backgroundOf('autumn', 'night');
  const winterDay = backgroundOf('winter', 'day');

  assert.equal(autumnDay.id, autumnNight.id, '전제: 16장이 같은 id를 쓴다');

  assert.ok(isSameBackground(autumnDay, backgroundOf('autumn', 'day')));
  assert.ok(!isSameBackground(autumnDay, autumnNight), '시간대가 넘어갔는데 같다고 한다');
  assert.ok(!isSameBackground(autumnDay, winterDay), '계절이 넘어갔는데 같다고 한다');
});

test('하루가 흐르면 배경이 네 번 바뀐다', () => {
  const seen = new Set<string>();
  let previous = backgroundAt(at(0));
  let changes = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const next = backgroundAt(at(hour));
    seen.add(next.metaFile);
    if (!isSameBackground(next, previous)) changes += 1;
    previous = next;
  }
  assert.equal(seen.size, 4, '하루에 네 시간대가 모두 나와야 한다');
  // 밤이 하루의 양 끝에 걸쳐 있다. 0시(밤)에서 시작해 5·8·17·20시를 지나므로 네 번이다.
  assert.equal(changes, 4, '경계를 네 번 지난다');
});

test('배경은 계절과 시간대로 고른다 — 16장이 한 디렉터리에 있다', () => {
  const autumnDay = backgroundAt(at(13)); // at()은 2026-09-03
  assert.equal(autumnDay.id, 'bg_007');
  assert.equal(autumnDay.directory, 'bg_007_dream_forest');
  assert.equal(autumnDay.season, 'autumn');
  assert.equal(autumnDay.phase, 'day');
  assert.equal(autumnDay.metaFile, 'autumn_day.json');

  const winterNight = backgroundAt(onDate(1, 15, 22));
  assert.equal(winterNight.season, 'winter');
  assert.equal(winterNight.phase, 'night');
  assert.equal(winterNight.metaFile, 'winter_night.json');
  assert.equal(winterNight.directory, autumnDay.directory);
});

test('배경 경로는 에셋 루트 기준 상대 경로다 — 선두 슬래시는 파일 시스템 루트를 가리킨다', () => {
  const path = backgroundAssetPath('bg_002_deep_forest', 'frames/near_00.png');
  assert.equal(path, 'backgrounds/bg_002_deep_forest/frames/near_00.png');
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

/* ------------------------------------------------------------------ *
 * 창이 보여 주는 영역
 * ------------------------------------------------------------------ */

test('창은 장면 아래쪽 가운데 512x240을 1.25배로 키워 640x300에 보여 준다', () => {
  const viewport = viewportOf(forestMeta());

  assert.deepEqual(viewport, { x: 224, y: 120, width: 512, height: 240 });
  // 아래쪽을 남긴다 — 버리는 120행은 하늘이고 지면은 아래에 있다.
  assert.equal(viewport.y + viewport.height, 360, '장면 바닥이 창 바닥과 맞아야 한다');
  assert.equal(viewport.x + viewport.width, 736);
  assert.equal(viewport.width * SCENE_SCALE, VIEWPORT_WIDTH);
  assert.equal(viewport.height * SCENE_SCALE, VIEWPORT_HEIGHT);
});

test('배경이 창보다 작으면 자르지 않는다', () => {
  const small = { ...forestMeta(), width: 480, height: 200 };
  const viewport = viewportOf(small);

  assert.deepEqual(viewport, { x: 0, y: 0, width: 480, height: 200 });
});

test('여백이 홀수여도 오프셋은 정수다 — 픽셀이 반 칸 밀리면 안 된다', () => {
  const odd = { ...forestMeta(), width: 961, height: 361 };
  const viewport = viewportOf(odd);

  assert.equal(Number.isInteger(viewport.x), true);
  assert.equal(Number.isInteger(viewport.y), true);
  assert.equal(viewport.x, 224);
});

test('배회 영역은 보이는 영역 안으로 좁혀진다 — 펫이 잘린 바깥으로 걸어가면 사라진다', () => {
  const meta = { ...forestMeta(), walkArea: { x: 96, y: 316, width: 744, height: 36 } };
  const viewport = viewportOf(meta);

  const clipped = clipWalkAreaToViewport(walkAreaOf(meta), viewport);

  // 좌표는 발 위치라 스프라이트 반 폭(24)만큼 창 안쪽으로 물러선다.
  assert.deepEqual(clipped, { x: 248, y: 316, width: 464, height: 36 });
  assert.ok(clipped.x >= viewport.x, '왼쪽으로 삐져나가지 않는다');
  assert.ok(
    clipped.x + clipped.width <= viewport.x + viewport.width,
    '오른쪽으로 삐져나가지 않는다',
  );
});

test('배회 영역이 이미 창 안이면 그대로 둔다', () => {
  const viewport = viewportOf(forestMeta());
  const inside: WalkArea = { x: 300, y: 300, width: 100, height: 20 };

  assert.deepEqual(clipWalkAreaToViewport(inside, viewport), inside);
});

test('머리가 창 위로 잘리는 자리는 배회 영역에서 뺀다', () => {
  const viewport = viewportOf(forestMeta());
  // 발이 창 최상단이면 48px 스프라이트의 머리가 위로 잘린다.
  const tooHigh: WalkArea = { x: 300, y: viewport.y, width: 100, height: 200 };

  const clipped = clipWalkAreaToViewport(tooHigh, viewport);

  assert.equal(clipped.y, viewport.y + 48, '한 프레임 높이만큼 내려온다');
});

test('보이는 영역 밖에만 있는 배회 영역은 거부한다', () => {
  const viewport = viewportOf(forestMeta());
  // 잘려 나가는 왼쪽 바깥.
  const outside: WalkArea = { x: 0, y: 316, width: 200, height: 36 };

  assert.throws(() => clipWalkAreaToViewport(outside, viewport), InvalidWalkAreaError);
});

test('창 크기는 뽑기·합성의 640x420과 맞는다', () => {
  // 장면 300 + 하단 패널 120 = 420. 하단 패널 높이는 앱이 갖지만 합이 맞아야 한다.
  assert.equal(VIEWPORT_WIDTH, 640);
  assert.equal(VIEWPORT_HEIGHT + 120, 420);
});
