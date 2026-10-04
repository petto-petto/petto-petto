import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  petCombatAnimation,
  petCombatPose,
  advancePetCombat,
  petCombatDecorations,
  moleSlapFrame,
} from '../src/view/pet-combat-animations.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const origin = { x: 40, y: 260 };
const target = { x: 120, y: 250 };
const mole = () => petCombatAnimation('mole_digger');
const input = (overrides: Partial<ArenaInput> = {}): ArenaInput => ({
  layout: battleLayout(636, 416),
  nowMs: 0,
  hpRatio: 1,
  enemyHeight: 80,
  theme: 'MUSHROOM_FOREST',
  key: 'owned-mole:1',
  running: true,
  petSprite: 'mole_digger',
  petFrontRatio: 0.75,
  ...overrides,
});

test('세 단계 모두 덧붙인 손 대신 원본 왼팔 픽셀만 회전하고 얼굴·몸·반대 팔을 보존한다', () => {
  // Unique opaque pixel colors make substitution, recoloring and stretching observable.
  const source = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) source.set([x, y, 127, 255], (y * 32 + x) * 4);
  for (const evolution of [0, 1, 2]) {
    const pose = petCombatPose(mole(), 1080, origin, target);
    const hand = petCombatDecorations(pose, 96);
    assert.equal(hand.handVisible, true);
    const rest = moleSlapFrame(source, evolution, 0);
    const slap = moleSlapFrame(source, evolution, 1);
    assert.equal(slap.length, 48 * 32 * 4);
    assert.notDeepEqual(slap, rest, 'actual native arm moves');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 20; x++) {
        const index = (y * 48 + x) * 4;
        assert.deepEqual(
          slap.slice(index, index + 4),
          source.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4),
        );
      }
    }
    for (let index = 0; index < slap.length; index += 4) {
      if (!slap[index + 3]) continue;
      assert.equal(slap[index + 2], 127, 'no painted replacement colors');
      assert.equal(slap[index + 3], 255, 'no antialiased or blurred pixels');
      assert.ok(
        slap[index]! < 32 && slap[index + 1]! < 32,
        'every output pixel comes from the native frame',
      );
    }
    for (let y = 0; y < 32; y++)
      assert.deepEqual(
        rest.slice(y * 48 * 4, (y * 48 + 32) * 4),
        source.slice(y * 32 * 4, (y + 1) * 32 * 4),
      );
    const atRest = petCombatDecorations(petCombatPose(mole(), 2320, origin, target), 96);
    assert.equal(atRest.handVisible, false);
  }
  const defaultHand = petCombatDecorations(
    petCombatPose(petCombatAnimation(), 250, origin, target),
    96,
  );
  assert.equal(defaultHand.handVisible, false);
});

test('손 렌더링은 잘못된 프레임·진화 단계에서 임의 팔을 만들지 않는다', () => {
  assert.throws(() => moleSlapFrame(new Uint8ClampedArray(4), 0, 1), /32/);
  const source = new Uint8ClampedArray(32 * 32 * 4);
  assert.deepEqual(moleSlapFrame(source, 99, 1), moleSlapFrame(source, 0, 1));
  assert.deepEqual(moleSlapFrame(source, 0, -1), moleSlapFrame(source, 0, 0));
  assert.deepEqual(moleSlapFrame(source, 0, 2), moleSlapFrame(source, 0, 1));
});

test('종 슬러그만 전용 동작을 선택하고 미등록 종은 현재 기본 동작을 유지한다', () => {
  assert.equal(mole().id, 'mole');
  for (const sprite of [
    undefined,
    '',
    '003',
    '두더지',
    'COMMON',
    'new_species',
    'mole_digger_fake',
  ]) {
    assert.equal(petCombatAnimation(sprite).id, 'default');
  }
  const profile = petCombatAnimation('new_species');
  assert.equal(profile.durationMs, 750);
  assert.equal(petCombatPose(profile, 250, origin, target).impact, true);
  assert.equal(petCombatPose(profile, 390, origin, target).impact, false);
  assert.deepEqual(petCombatPose(profile, 750, origin, target).position, origin);
});

test('두더지는 잠수·지하이동·앞 지면 등장·왼손 타격·지하복귀·원위치 순서다', () => {
  const samples = [130, 450, 800, 1100, 1370, 1700, 2030, 2320].map((time) =>
    petCombatPose(mole(), time, origin, target),
  );
  assert.deepEqual(
    samples.map((pose) => pose.phase),
    ['DIG', 'TUNNEL', 'EMERGE', 'SLAP', 'DIVE', 'RETURN', 'RESURFACE', 'IDLE'],
  );
  assert.equal(samples[1]!.burrow, 1);
  assert.equal(samples[5]!.burrow, 1);
  assert.deepEqual(samples[3]!.position, target, 'slap on target ground, never above enemy');
  assert.equal(samples[3]!.impact, true);
  assert.equal(samples[3]!.hand, 'LEFT');
  assert.deepEqual(samples.at(-1)!.position, origin);
  for (let time = 0; time < 2320; time += 10) {
    const pose = petCombatPose(mole(), time, origin, target);
    assert.ok(pose.position.x >= origin.x && pose.position.x <= target.x);
    assert.ok(pose.position.y >= target.y && pose.position.y <= origin.y);
    if (pose.impact) assert.equal(pose.phase, 'SLAP');
  }
});

test('느린 프레임도 잠수·등장·타격을 건너뛰지 않고 단 한 번 피격한다', () => {
  for (const delta of [16, 200, 1000]) {
    let elapsed = 0,
      hits = 0,
      previous = false;
    const phases = new Set<string>();
    while (elapsed < mole().durationMs) {
      const pose = petCombatPose(mole(), elapsed, origin, target);
      phases.add(pose.phase);
      if (pose.impact && !previous) hits++;
      previous = pose.impact;
      elapsed = advancePetCombat(mole(), elapsed, delta);
    }
    assert.equal(hits, 1);
    for (const phase of ['DIG', 'TUNNEL', 'EMERGE', 'SLAP', 'DIVE', 'RETURN', 'RESURFACE'])
      assert.ok(phases.has(phase), `${delta}ms misses ${phase}`);
  }
});

test('모션 감소는 제자리·지면 위를 유지하고 손 타격 신호만 남긴다', () => {
  let hit = false;
  for (let time = 0; time < mole().durationMs; time += 20) {
    const pose = petCombatPose(mole(), time, origin, target, true);
    assert.deepEqual(pose.position, origin);
    assert.equal(pose.burrow, 0);
    assert.equal(pose.dust, 0);
    hit ||= pose.impact;
  }
  assert.ok(hit);
});

test('자동 두더지는 복귀 후에만 적 공격을 허용하고 여러 번 반복한다', () => {
  const arena = new ArenaDirector(() => 0.35);
  let cycleOrigin: { x: number; y: number } | undefined;
  let previousTurn: string | null = null,
    impacts = 0,
    previousImpact = false;
  for (let nowMs = 0; nowMs < 35000; nowMs += 20) {
    const frame = arena.frame(input({ nowMs }));
    if (frame.attackTurn === 'PET' && previousTurn !== 'PET') cycleOrigin = frame.world.pet;
    if (frame.attackTurn === 'ENEMY' && previousTurn === 'PET')
      assert.deepEqual(frame.world.pet, cycleOrigin, 'return to cycle origin before enemy turn');
    if (frame.petImpact) {
      assert.equal(frame.attackTurn, 'PET');
      assert.equal(frame.petAnimation.phase, 'SLAP');
      assert.equal(frame.world.pet.y, frame.world.enemy.y, 'emerge on enemy ground lane');
      assert.equal(frame.petHit || frame.enemyImpact, false);
    }
    if (frame.petImpact && !previousImpact) impacts++;
    previousImpact = frame.petImpact;
    previousTurn = frame.attackTurn;
  }
  assert.ok(impacts >= 2);
});

test('수동 공격은 정지·메뉴 상태에서도 같은 동작 한 번만 완주한다', () => {
  const arena = new ArenaDirector(() => 0.35);
  const options = input({ running: false, menuOpen: true });
  const initial = arena.frame(options);
  let hits = 0,
    previous = false,
    returned = false;
  for (let nowMs = 20; nowMs < 6000; nowMs += 20) {
    const frame = arena.frame({ ...options, nowMs, manualAttack: 1 });
    if (frame.petImpact && !previous) hits++;
    previous = frame.petImpact;
    assert.equal(frame.enemyImpact, false, 'manual preview never invokes enemy turn');
    if (!frame.previewing) {
      returned = true;
      assert.deepEqual(frame.world.pet, initial.world.pet);
    }
  }
  assert.equal(hits, 1);
  assert.ok(returned);
});

test('잠수 중 STOP·메뉴·정복·선택 변경·숨김은 지면에서 취소하며 뒤늦은 타격이 없다', () => {
  for (const change of [
    { running: false },
    { menuOpen: true },
    { hpRatio: 0 },
    { key: 'other:1', petSprite: 'new_pet' },
    { suspended: true },
  ]) {
    const arena = new ArenaDirector(() => 0.35);
    let at = 0;
    for (let nowMs = 0; nowMs < 30000; nowMs += 20) {
      const frame = arena.frame(input({ nowMs }));
      if (frame.petAnimation.phase === 'TUNNEL') {
        at = nowMs;
        break;
      }
    }
    assert.ok(at);
    for (let delta = 20; delta <= 200; delta += 20) {
      const frame = arena.frame(input({ nowMs: at + delta, ...change }));
      assert.equal(frame.petAnimation.burrow, 0);
      assert.equal(frame.petAnimation.dust, 0);
      assert.equal(frame.petAnimation.hand, null);
      assert.equal(frame.petImpact, false);
    }
  }
});

test('잠수·타격·복귀 중 리사이즈도 몸통 간격·화면 경계·96px 크기를 지킨다', () => {
  for (const phase of ['DIG', 'TUNNEL', 'EMERGE', 'SLAP', 'DIVE', 'RETURN', 'RESURFACE']) {
    for (const size of [
      [356, 176],
      [636, 416],
      [956, 536],
    ]) {
      const arena = new ArenaDirector(() => 0.35);
      let resized = false;
      for (let nowMs = 0; nowMs < 16000; nowMs += 40) {
        const layout: ReturnType<typeof battleLayout> = resized
          ? battleLayout(size[0]!, size[1]!)
          : battleLayout(636, 416);
        const frame = arena.frame(input({ nowMs, layout }));
        if (frame.petAnimation.phase === phase) resized = true;
        assert.equal(layout.petSize, 96);
        for (const [pose, width] of [
          [frame.pet, 96],
          [frame.enemy, 128],
        ] as const) {
          assert.ok(pose.x >= 0 && pose.x + width <= layout.width, `${phase} horizontal bound`);
          assert.ok(pose.y - width * pose.scaleY >= 0 && pose.y <= layout.height);
        }
        assert.ok(frame.world.enemy.x - frame.world.pet.x >= frame.minimumSeparation - 0.01);
      }
      assert.ok(resized, `reached ${phase}`);
    }
  }
});
