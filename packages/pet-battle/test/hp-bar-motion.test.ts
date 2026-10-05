import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HpBarMotion } from '../src/view/hp-bar-motion.ts';

type Input = Parameters<HpBarMotion['frame']>[0];
type Frame = ReturnType<HpBarMotion['frame']>;
const input = (nowMs: number, ratio = 1, overrides: Partial<Input> = {}): Input => ({
  key: 'pet-a:stage-1',
  resetKey: 'FIGHTING:CLOSED',
  ratio,
  nowMs,
  reducedMotion: false,
  running: false,
  ...overrides,
});
// Allow the preceding public frame shape to execute these new behavior checks as runtime RED.
const surface = (frame: Frame) => Number('surfaceMix' in frame ? frame.surfaceMix : NaN);
const edge = (frame: Frame) => Number('edgeOpacity' in frame ? frame.edgeOpacity : NaN);
const smooth = (progress: number) => progress * progress * (3 - 2 * progress);

test('HP 표시 계약은 고정 길이·차분한 색상·약한 끝점만 제공하고 이동·잔상 신호는 없다', () => {
  const frame = new HpBarMotion().frame(input(0, 0.6));
  assert.deepEqual(Object.keys(frame).sort(), [
    'animating',
    'edgeOpacity',
    'fillRatio',
    'surfaceMix',
  ]);
  assert.equal(frame.fillRatio, 0.6);
  assert.equal(surface(frame), 0);
  assert.equal(edge(frame), 0);
  assert.equal(frame.animating, false);
});

test('자동 전투 색상은 3600ms마다 연속 왕복하고 실제 HP 길이는 변하지 않는다', () => {
  const bar = new HpBarMotion();
  for (let nowMs = 0; nowMs <= 10800; nowMs += 225) {
    const frame = bar.frame(input(nowMs, 0.6, { running: true }));
    const expected = (1 - Math.cos((2 * Math.PI * nowMs) / 3600)) / 2;
    assert.equal(frame.fillRatio, 0.6);
    assert.ok(Math.abs(surface(frame) - expected) < 1e-10, `continuous color at ${nowMs}`);
    assert.ok(edge(frame) >= 0 && edge(frame) <= 0.28);
    assert.equal(frame.animating, true);
  }
  const stopped = bar.frame(input(10820, 0.6));
  assert.equal(surface(stopped), 0);
  assert.equal(edge(stopped), 0);
  assert.equal(stopped.animating, false);
});

test('반복 피격은 자동 색상 주기를 재시작하거나 가짜 HP 감소를 만들지 않는다', () => {
  const bar = new HpBarMotion();
  const baseline = new HpBarMotion();
  for (let nowMs = 0; nowMs <= 5000; nowMs += 25) {
    if (nowMs > 0 && nowMs % 250 === 0) bar.hit(nowMs);
    const frame = bar.frame(input(nowMs, 0.25, { running: true }));
    const expected = baseline.frame(input(nowMs, 0.25, { running: true }));
    assert.equal(frame.fillRatio, 0.25);
    assert.equal(surface(frame), surface(expected), 'hits do not restart the running gradient');
    assert.ok(Number.isFinite(surface(frame)));
    assert.ok(edge(frame) >= 0 && edge(frame) <= 0.28);
  }
});

test('수동 맞기는 열린 메뉴·중지 상태에서도 같은 600ms 단발성 약한 끝점 연출이다', () => {
  const normal = new HpBarMotion();
  const preview = new HpBarMotion();
  normal.frame(input(0));
  preview.frame(input(0, 1, { resetKey: 'PAUSED:ENEMY' }));
  normal.hit(10);
  preview.hit(10);
  let visible = false;
  let falling = false;
  let previous = 0;
  for (let elapsed = 0; elapsed <= 700; elapsed += 20) {
    const frame = normal.frame(input(10 + elapsed));
    assert.deepEqual(frame, preview.frame(input(10 + elapsed, 1, { resetKey: 'PAUSED:ENEMY' })));
    assert.equal(frame.fillRatio, 1);
    assert.equal(surface(frame), 0, 'a manual preview does not enable the automatic gradient');
    const opacity = edge(frame);
    assert.ok(opacity >= 0 && opacity <= 0.28);
    visible ||= opacity > 0;
    if (opacity < previous - 1e-10) falling = true;
    if (falling) assert.ok(opacity <= previous + 1e-10, 'one quiet pulse, not repeated flashing');
    previous = opacity;
    if (elapsed >= 600) {
      assert.equal(opacity, 0);
      assert.equal(frame.animating, false);
    }
  }
  assert.ok(visible, 'manual hit feedback remains visible');
});

test('명시적 STOP 취소는 이미 멈춘 상태의 수동 연출도 즉시 없앤다', () => {
  const bar = new HpBarMotion();
  bar.frame(input(0));
  bar.hit(10);
  assert.equal(bar.frame(input(100)).animating, true);
  bar.cancel();
  const stopped = bar.frame(input(110));
  assert.equal(stopped.animating, false);
  assert.equal(edge(stopped), 0);
  assert.equal(surface(stopped), 0);
});

test('실제 HP 감소는 5단계 점프 없이 현재 표시값에서 700ms 연속 부드럽게 내려간다', () => {
  const bar = new HpBarMotion();
  bar.frame(input(0));
  const started = bar.frame(input(10, 0.2));
  assert.equal(started.fillRatio, 1);
  let previous = 1;
  const widths = new Set<number>();
  for (let elapsed = 16; elapsed < 700; elapsed += 16) {
    const frame = bar.frame(input(10 + elapsed, 0.2));
    assert.ok(frame.fillRatio < previous, `no 16ms plateau at ${elapsed}`);
    assert.ok(frame.fillRatio > 0.2);
    assert.ok(Math.abs(frame.fillRatio - (1 - 0.8 * smooth(elapsed / 700))) < 1e-10);
    widths.add(frame.fillRatio);
    previous = frame.fillRatio;
  }
  assert.ok(widths.size > 8, 'not a five-step width animation');
  const settled = bar.frame(input(710, 0.2));
  assert.equal(settled.fillRatio, 0.2);
  assert.equal(settled.animating, false);
});

test('같은 적의 실제 0 HP도 즉시 정복 사실과 별개로 표시 길이는 700ms 안에 0으로 수렴한다', () => {
  const bar = new HpBarMotion();
  bar.frame(input(0, 0.6, { running: true }));
  const truth = Object.freeze(input(10, 0, { running: true }));
  assert.equal(bar.frame(truth).fillRatio, 0.6);
  const middle = bar.frame(input(360, 0, { running: true }));
  assert.ok(Math.abs(middle.fillRatio - 0.3) < 1e-10);
  const settled = bar.frame(input(710, 0, { running: true }));
  assert.equal(settled.fillRatio, 0);
  assert.equal(settled.animating, false);
  assert.equal(surface(settled), 0);
  assert.equal(edge(settled), 0);
  assert.equal(truth.ratio, 0, 'the presentation never writes back HP or conquest');
});

test('감소가 끝나기 직전 새 XP 목표가 와도 현재 표시 지점에서 재시작하고 튀거나 넘지 않는다', () => {
  const bar = new HpBarMotion();
  const baseline = new HpBarMotion();
  for (const motion of [bar, baseline]) {
    motion.frame(input(0));
    motion.frame(input(10, 0.6));
    motion.frame(input(660, 0.6));
  }
  const displayed = baseline.frame(input(670, 0.6)).fillRatio;
  const retargeted = bar.frame(input(670, 0.2));
  assert.equal(
    retargeted.fillRatio,
    displayed,
    'retarget from the old curve sampled at the same instant',
  );
  let previous = displayed;
  for (let nowMs = 686; nowMs < 1370; nowMs += 16) {
    const frame = bar.frame(input(nowMs, 0.2));
    assert.ok(frame.fillRatio < previous && frame.fillRatio > 0.2);
    previous = frame.fillRatio;
  }
  assert.equal(bar.frame(input(1370, 0.2)).fillRatio, 0.2);
});

test('80ms마다 XP가 갱신되고 피격되어도 표시 HP는 역행·가짜 감소 없이 마지막 목표에 도달한다', () => {
  const bar = new HpBarMotion();
  bar.frame(input(0));
  let target = 1;
  let previous = 1;
  for (let nowMs = 16; nowMs <= 1440; nowMs += 16) {
    if (nowMs % 80 === 0) target = Math.max(0.1, target - 0.05);
    if (nowMs % 160 === 0) bar.hit(nowMs);
    const frame = bar.frame(input(nowMs, target));
    assert.ok(frame.fillRatio <= previous + 1e-10);
    assert.ok(frame.fillRatio >= target);
    assert.ok(
      previous - frame.fillRatio < 0.04,
      'frequent retargeting cannot jump to a distant target',
    );
    previous = frame.fillRatio;
  }
  assert.equal(bar.frame(input(2140, target)).fillRatio, target);
});

test('STOP 장식이 없어도 새 실제 XP 감소는 보간하고 HP 증가는 즉시 사실값으로 맞춘다', () => {
  const bar = new HpBarMotion();
  bar.frame(input(0, 0.8));
  bar.frame(input(10, 0.2));
  const decreasing = bar.frame(input(360, 0.2));
  assert.ok(decreasing.fillRatio > 0.2 && decreasing.fillRatio < 0.8);
  assert.equal(surface(decreasing), 0);
  assert.equal(edge(decreasing), 0);
  assert.equal(
    bar.frame(input(380, 0.4)).fillRatio,
    0.4,
    'increase compares authoritative targets, not the displayed value',
  );
});

test('아주 낮은 양의 HP는 장식으로 0이 되지 않고 입력은 수정되지 않는다', () => {
  for (const ratio of [0.001, 0.01, 0.25, 0.6, 1]) {
    const bar = new HpBarMotion();
    const first = Object.freeze(input(0, ratio, { running: true }));
    bar.frame(first);
    bar.hit(10);
    for (let nowMs = 10; nowMs <= 900; nowMs += 10) {
      const frame = bar.frame(Object.freeze(input(nowMs, ratio, { running: true })));
      assert.equal(frame.fillRatio, ratio);
      assert.ok(surface(frame) >= 0 && surface(frame) <= 1);
      assert.ok(edge(frame) >= 0 && edge(frame) <= 0.28);
    }
    assert.equal(first.ratio, ratio);
  }
});

test('resetKey·새 적·펫 없음·모션 감소·역행 시간·긴 숨김 복귀는 현재 사실값에 즉시 맞춘다', () => {
  const resets: Partial<Input>[] = [
    { resetKey: 'PAUSED:CLOSED' },
    { resetKey: 'FIGHTING:PET' },
    { key: 'pet-b:stage-2' },
    { key: null },
    { reducedMotion: true },
    { nowMs: 10000 },
    { nowMs: -1 },
  ];
  for (const reset of resets) {
    const bar = new HpBarMotion();
    bar.frame(input(0, 0.8));
    bar.frame(input(10, 0.4));
    assert.ok(bar.frame(input(110, 0.4)).fillRatio > 0.4);
    const frame = bar.frame(input(220, 0.4, reset));
    assert.equal(frame.fillRatio, 0.4);
    assert.equal(frame.animating, false);
    assert.equal(surface(frame), 0);
    assert.equal(edge(frame), 0);
  }
});

test('초기화 전·펫 없음·모션 감소·실제 0 HP의 타격은 효과를 만들지 않는다', () => {
  const uninitialized = new HpBarMotion();
  uninitialized.hit(0);
  assert.equal(uninitialized.frame(input(10)).animating, false);
  for (const overrides of [{ key: null }, { reducedMotion: true }, { ratio: 0 }]) {
    const bar = new HpBarMotion();
    bar.frame(input(10, 1, overrides));
    bar.hit(20);
    const frame = bar.frame(input(100, 1, overrides));
    assert.equal(frame.animating, false);
    assert.equal(surface(frame), 0);
    assert.equal(edge(frame), 0);
  }
});

test('비정상 HP 입력은 0~1로 정규화하고 비정상 타격 시간은 무시한다', () => {
  for (const [ratio, expected] of [
    [-1, 0],
    [2, 1],
    [NaN, 0],
    [Infinity, 0],
  ] as const) {
    const bar = new HpBarMotion();
    const frame = bar.frame(input(0, ratio));
    assert.equal(frame.fillRatio, expected);
    bar.hit(NaN);
    bar.hit(Infinity);
    assert.equal(bar.frame(input(100, ratio)).animating, false);
  }
});
