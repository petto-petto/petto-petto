/** 기획서 12장 `정보`·`설정` 인수 조건(INFO-*, SET-*, META-002)의 실행 증거. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, parseLocalDate, petId, type LocalDate } from '@pet/core';
import {
  AchievementCatalog,
  createMetaState,
  FixtureCollector,
  GRASS_WEEKS,
  InMemoryCollection,
  InMemoryCurrency,
  type MetaState,
  MODEL_PREVIEW_COUNT,
  needsFirstRunCollectTab,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  performanceScreen,
  PET_SIZES,
  placePanel,
  type Rect,
  runAggregation,
  setSourceEnabled,
  settingsScreen,
  StubBattle,
  StubGacha,
  StubGrowth,
  summaryScreen,
  tokenCounts,
  usageScreen,
} from '@pet/meta';

const NOW = '2026-08-24T14:37:12+09:00';
const today = (): LocalDate => {
  const parsed = parseLocalDate('2026-08-24');
  assert.ok(parsed);
  return parsed;
};

class Harness {
  state: MetaState = createMetaState();
  catalog = AchievementCatalog.embedded();
  collector = FixtureCollector.withEmptySnapshots();
  currency = new InMemoryCurrency();
  collection = new InMemoryCollection();
  gacha = new StubGacha(12, 4);
  battle = new StubBattle(31);
  growth = new StubGrowth(18);
  clock = new FixedClock(NOW);

  constructor() {
    this.currency.setNow(this.clock.now());
  }

  run(): void {
    runAggregation(this.state, this.collector, this.currency, this.clock);
  }

  /** 기준점을 잡고, 날짜별로 사용량을 심는다. */
  seed(rows: readonly (readonly [string, string, string, number])[]): void {
    this.run();
    for (const [provider, date, model, observed] of rows) {
      this.collector.accumulate(provider as never, date, model, tokenCounts(observed));
    }
    this.run();
  }

  summary() {
    return summaryScreen(
      this.state,
      this.catalog,
      today(),
      this.collection,
      this.currency,
      this.growth,
    );
  }

  settings() {
    return settingsScreen(this.state, {}, '~/Library/…', '0.1.0');
  }
}

test('INFO-001: 요약이 프로필과 여섯 핵심 수치를 제공한다', () => {
  const harness = new Harness();
  harness.seed([['claude_code', '2026-08-24', 'claude-opus-5', 40_000]]);

  const summary = harness.summary();

  assert.equal(summary.profile.deviceLabel, '이 기기');
  assert.equal(summary.profile.petName.value, '별빛마법사');

  assert.equal(summary.totalObservedTokens, 40_000);
  assert.equal(summary.ownedPets.value, 3);
  assert.equal(summary.dexOwned.value, 3);
  assert.equal(summary.dexTotal.value, 24);

  assert.equal(summary.todayObservedTokens, 40_000);
  assert.equal(summary.todayEarnedCoins.value, 4);
  assert.equal(summary.togetherMinutes, 1);
  assert.equal(summary.togetherLabel, '1분');
  assert.equal(summary.hasNoRecords, false);
});

test('INFO-001: 사용 가능 토큰이 재화 잔액을 그대로 보여준다', () => {
  const harness = new Harness();
  harness.seed([['claude_code', '2026-08-24', 'claude-opus-5', 40_000]]);

  const summary = harness.summary();

  // 요약이 자체 계산하지 않고 재화 도메인이 소유한 잔액을 그대로 옮긴다.
  assert.equal(summary.availableTokens.value, harness.currency.balance());
});

test('INFO-007: 잔액 조회가 실패해도 요약의 나머지는 산다', () => {
  const harness = new Harness();
  harness.seed([['claude_code', '2026-08-24', 'claude-opus-5', 7_000]]);
  harness.currency.setQueryFailure(true);

  const summary = harness.summary();

  assert.ok(summary.availableTokens.error);
  assert.equal(summary.totalObservedTokens, 7_000);
  assert.equal(summary.profile.petName.value, '별빛마법사');
});

test('INFO-003: 경험치는 성장 도메인 값을 계산 없이 옮긴다', () => {
  const harness = new Harness();
  harness.run();
  harness.growth.setExperience({ level: 21, current: 340, required: 500 });

  const summary = harness.summary();

  assert.deepEqual(summary.profile.experience.value, {
    level: 21,
    current: 340,
    required: 500,
  });
});

test('INFO-003: 최고 레벨은 남은 경험치가 없다고 알린다', () => {
  const harness = new Harness();
  harness.run();
  // 화면이 0으로 나누지 않도록, 성장 도메인은 최고 레벨에서 `required: 0`을 준다.
  harness.growth.setExperience({ level: 60, current: 0, required: 0 });

  const summary = harness.summary();

  assert.equal(summary.profile.experience.value?.required, 0);
});

test('INFO-007: 펫을 못 읽으면 경험치도 실패로 표시된다', () => {
  const harness = new Harness();
  harness.run();
  harness.collection.setQueryFailure(true);

  const summary = harness.summary();

  // 어느 펫의 경험치인지 물어볼 대상 자체가 없다. 0으로 꾸미지 않는다.
  assert.ok(summary.profile.experience.error);
});

test('INFO-001: 기록이 없는 설치는 오류가 아니라 빈 상태다', () => {
  const harness = new Harness();
  harness.run();

  const summary = harness.summary();
  assert.equal(summary.hasNoRecords, true);
  assert.equal(summary.totalObservedTokens, 0);
  assert.equal(summary.ownedPets.error, undefined);
});

test('INFO-004: 잔디가 최근 12주 고정이고 0과 값을 구분한다', () => {
  const harness = new Harness();
  harness.seed([
    ['claude_code', '2026-08-24', 'claude-opus-5', 90_000],
    ['claude_code', '2026-08-22', 'claude-opus-5', 10_000],
    ['claude_code', '2026-08-18', 'claude-opus-5', 50_000],
  ]);

  const screen = usageScreen(harness.state, today(), 'all');
  assert.equal(screen.grass.length, GRASS_WEEKS);

  const cells = screen.grass.flatMap((week) => week.cells);
  assert.equal(cells.length, 12 * 7, '12주 × 7일 = 84칸');

  const used = cells.filter((cell) => cell.observed > 0);
  assert.equal(used.length, 3);
  assert.ok(cells.every((cell) => (cell.observed === 0) === (cell.level === 0)));
  assert.ok(used.every((cell) => cell.level >= 1 && cell.level <= 4));

  const todayCell = cells.find((cell) => cell.date === '2026-08-24');
  assert.equal(todayCell?.observed, 90_000);
  assert.equal(todayCell?.future, false);
  assert.ok(
    cells.some((cell) => cell.future),
    '미래 칸이 표시된다',
  );
});

test('INFO-004: 잔디는 기간 필터를 무시한다', () => {
  const harness = new Harness();
  harness.seed([
    ['claude_code', '2026-08-24', 'claude-opus-5', 10_000],
    ['claude_code', '2026-07-01', 'claude-opus-5', 70_000],
  ]);

  const all = usageScreen(harness.state, today(), 'all');
  const todayOnly = usageScreen(harness.state, today(), 'today');

  assert.equal(all.grassObserved, todayOnly.grassObserved);
  assert.equal(all.grassObserved, 80_000);
  assert.equal(todayOnly.periodObserved, 10_000, '기간 필터는 집계에만 적용된다');
});

test('INFO-005: 기간 필터가 기획서 5.2의 범위를 쓴다', () => {
  const harness = new Harness();
  harness.seed([
    ['claude_code', '2026-08-24', 'claude-opus-5', 1], // 오늘
    ['claude_code', '2026-08-18', 'claude-opus-5', 10], // 7일 경계
    ['claude_code', '2026-08-17', 'claude-opus-5', 100], // 7일 밖, 30일 안
    ['claude_code', '2026-07-26', 'claude-opus-5', 1_000], // 30일 경계
    ['claude_code', '2026-07-25', 'claude-opus-5', 10_000], // 30일 밖
  ]);

  const observedFor = (period: 'today' | 'week' | 'month' | 'all'): number =>
    usageScreen(harness.state, today(), period).periodObserved;

  assert.equal(observedFor('today'), 1);
  assert.equal(observedFor('week'), 11, '오늘을 포함한 7개 날짜');
  assert.equal(observedFor('month'), 1_111, '오늘을 포함한 30개 날짜');
  assert.equal(observedFor('all'), 11_111);
});

test('INFO-006: 모델은 (도구, 원본 모델명)으로 식별되고 내림차순 정렬된다', () => {
  const harness = new Harness();
  harness.seed([
    ['claude_code', '2026-08-24', 'claude-opus-5', 900],
    ['claude_code', '2026-08-24', 'claude-sonnet-5', 800],
    ['claude_code', '2026-08-24', 'claude-haiku-4-5', 700],
    ['codex', '2026-08-24', 'gpt-5.4-codex', 600],
    ['codex', '2026-08-24', 'gpt-5.4-mini', 500],
    ['gemini_cli', '2026-08-24', 'gemini-3-pro', 400],
    // 같은 모델명이라도 도구가 다르면 다른 행이다.
    ['gemini_cli', '2026-08-24', 'claude-opus-5', 300],
    // 매핑되지 않은 새 모델도 원본 이름 그대로 나타난다.
    ['codex', '2026-08-24', 'gpt-6-preview-2027', 200],
  ]);

  const screen = usageScreen(harness.state, today(), 'all');

  assert.equal(screen.modelCount, 8);
  assert.ok(screen.modelCount > MODEL_PREVIEW_COUNT, '전체 보기가 의미 있는 상황');

  const observed = screen.models.map((row) => row.observed);
  assert.deepEqual(
    observed,
    [...observed].sort((a, b) => b - a),
  );

  const opusRows = screen.models.filter((row) => row.rawModel === 'claude-opus-5');
  assert.equal(opusRows.length, 2, '도구가 다르면 같은 모델명도 별개 행이다');

  assert.ok(screen.models.some((row) => row.rawModel === 'gpt-6-preview-2027'));
});

test('INFO-006: 수집 중지된 소스도 과거 기록과 함께 목록에 남는다', () => {
  const harness = new Harness();
  harness.seed([['codex', '2026-08-24', 'gpt-5.4-codex', 5_000]]);
  setSourceEnabled(harness.state, harness.clock, 'codex', false);

  const screen = usageScreen(harness.state, today(), 'all');
  const codex = screen.tools.find((row) => row.provider === 'codex');
  assert.ok(codex, 'Codex 행이 남아 있어야 한다');
  assert.equal(codex.observed, 5_000);
  assert.equal(codex.paused, true);
  assert.equal(codex.statusLabel, '수집 중지');
});

test('INFO-007: 타일 하나가 실패해도 나머지는 산다', () => {
  const harness = new Harness();
  harness.battle.setQueryFailure(true);

  const screen = performanceScreen(harness.gacha, harness.battle, harness.growth, harness.currency);

  assert.equal(screen.tiles.length, 6);
  const battle = screen.tiles.find((tile) => tile.key === 'battle');
  assert.equal(battle?.value.value, undefined);
  assert.equal(battle?.value.error, '전투 기록을 불러오지 못했어요');

  for (const key of ['draw', 'fusion', 'best_level', 'earned', 'spent']) {
    const tile = screen.tiles.find((entry) => entry.key === key);
    assert.equal(tile?.value.error, undefined, `${key} 타일이 함께 죽으면 안 된다`);
  }
  assert.equal(screen.ledger.error, undefined);
});

test('INFO-007: 원장 실패가 다른 타일을 막지 않는다', () => {
  const harness = new Harness();
  harness.currency.setQueryFailure(true);

  const screen = performanceScreen(harness.gacha, harness.battle, harness.growth, harness.currency);
  assert.ok(screen.ledger.error);
  assert.equal(screen.tiles.find((tile) => tile.key === 'draw')?.value.value, 12);
});

test('INFO-007: 펫 조회가 실패해도 meta가 소유한 수치는 보인다', () => {
  const harness = new Harness();
  harness.seed([['claude_code', '2026-08-24', 'claude-opus-5', 7_000]]);
  harness.collection.setQueryFailure(true);

  const summary = harness.summary();
  assert.ok(summary.profile.petName.error);
  assert.ok(summary.ownedPets.error);
  assert.equal(summary.totalObservedTokens, 7_000);
  assert.equal(summary.profile.deviceLabel, '이 기기');
});

test('INFO-003: 프로필 펫이 현재 오버레이 펫을 따라간다', () => {
  const harness = new Harness();
  harness.run();

  harness.collection.setOverlayPet({
    petId: petId('pet-777'),
    name: '레몬',
    level: 21,
    rarity: 'EPIC',
    sprite: 'bird',
  });

  const summary = harness.summary();
  assert.equal(summary.profile.petName.value, '레몬');
  assert.equal(summary.profile.petLevel.value, 21);
});

test('INFO-008: 어느 화면에도 USD 비용이 존재하지 않는다', () => {
  const harness = new Harness();
  harness.seed([['claude_code', '2026-08-24', 'claude-opus-5', 123_456]]);

  const payloads: readonly (readonly [string, unknown])[] = [
    ['요약', harness.summary()],
    ['사용량', usageScreen(harness.state, today(), 'all')],
    ['실적', performanceScreen(harness.gacha, harness.battle, harness.growth, harness.currency)],
  ];

  for (const [name, payload] of payloads) {
    const lowered = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ['usd', 'cost', 'dollar', '$']) {
      assert.ok(!lowered.includes(forbidden), `${name} 화면에 비용 필드(${forbidden})가 있다`);
    }
  }
});

test('SET-001: 소스가 하나도 발견되지 않았을 때만 수집 탭이 열린다', () => {
  const harness = new Harness();
  harness.collector = FixtureCollector.withNoSources();
  harness.run();

  const screen = harness.settings();
  assert.equal(screen.openCollectTab, true);
  assert.ok(screen.collect.every((card) => card.statusLabel === '기록을 찾을 수 없음'));

  harness.collector.setSnapshot({ provider: 'codex', rows: new Map() });
  harness.run();
  assert.equal(harness.settings().openCollectTab, false);
  assert.equal(needsFirstRunCollectTab(harness.state), false);
});

test('SET-002: 각 수집 카드가 상태·위치·마지막 정상 시각·토글을 표시한다', () => {
  const harness = new Harness();
  harness.run();

  const screen = harness.settings();
  assert.equal(screen.collect.length, 3);
  assert.deepEqual(
    screen.collect.map((card) => card.provider),
    ['claude_code', 'codex', 'gemini_cli'],
    '기획서 6.1: 항상 같은 순서',
  );

  const claude = screen.collect[0];
  assert.equal(claude?.providerLabel, 'Claude Code');
  assert.equal(claude?.statusLabel, '수집 중');
  assert.equal(claude?.defaultLocation, '~/.claude/projects');
  assert.notEqual(claude?.lastSuccessLabel, '없음');
  assert.equal(claude?.enabled, true);
  assert.equal(claude?.lastError, undefined);
});

test('SET-004 / SET-009: 제외한 기능은 응답에 흔적조차 없다', () => {
  const harness = new Harness();
  harness.run();
  const payload = JSON.stringify(harness.settings()).toLowerCase();

  for (const forbidden of [
    'custom_path',
    'custompath',
    'click_through',
    'clickthrough',
    'focus_mode',
    'quiet_hours',
    'backup',
    'restore',
    'reset',
    'export',
    'import',
    'preview',
  ]) {
    assert.ok(!payload.includes(forbidden), `제외한 기능의 필드(${forbidden})가 있다`);
  }
});

test('SET-005: 펫 크기를 바꿔도 패널 크기는 그대로다', () => {
  const harness = new Harness();
  harness.run();

  for (const size of PET_SIZES) {
    harness.state.settings.petSize = size;
    const screen = harness.settings();
    assert.equal(screen.display.petSize, size);
    assert.equal(screen.display.panelWidth, PANEL_WIDTH);
    assert.equal(screen.display.panelHeight, PANEL_HEIGHT);
  }
});

test('SET-006: 자동 실행은 기본 꺼짐이고 미구현임을 표시한다', () => {
  const harness = new Harness();
  harness.run();
  const screen = harness.settings();
  assert.equal(screen.display.autostart, false);
  assert.ok(screen.display.autostartNote);
});

test('SET-008: 주소가 비어 있는 후원 버튼은 준비 중이며 비활성이다', () => {
  const harness = new Harness();
  harness.run();

  const empty = settingsScreen(harness.state, {}, '~/Library/…', '0.1.0');
  assert.equal(empty.misc.sponsors.length, 2);
  for (const button of empty.misc.sponsors) {
    assert.equal(button.enabled, false);
    assert.equal(button.note, '준비 중');
    assert.equal(button.url, undefined);
  }

  const partial = settingsScreen(
    harness.state,
    { githubSponsors: 'https://github.com/sponsors/example', buyMeACoffee: '   ' },
    '~/Library/…',
    '0.1.0',
  );
  assert.equal(partial.misc.sponsors[0]?.enabled, true);
  assert.equal(
    partial.misc.sponsors[1]?.enabled,
    false,
    '공백만 있는 주소는 비어 있는 것으로 본다',
  );
});

/* ---------- META-002: 패널 배치 ---------- */

const workArea = (): Rect => ({ x: 0, y: 25, width: 1920, height: 1055 });

function assertInside(placement: { x: number; y: number }, area: Rect): void {
  assert.ok(placement.x >= area.x, '왼쪽 경계를 넘었다');
  assert.ok(placement.x + PANEL_WIDTH <= area.x + area.width, '오른쪽 경계를 넘었다');
  assert.ok(placement.y >= area.y, '위쪽 경계를 넘었다');
  assert.ok(placement.y + PANEL_HEIGHT <= area.y + area.height, '아래쪽 경계를 넘었다');
}

test('META-002: 펫이 오른쪽이면 패널이 왼쪽에 붙는다', () => {
  const placement = placePanel({ x: 1600, y: 500, width: 128, height: 128 }, workArea());
  assert.equal(placement.side, 'left');
  assert.equal(placement.x, 1600 - 12 - PANEL_WIDTH);
  assertInside(placement, workArea());
});

test('META-002: 펫이 왼쪽이면 패널이 오른쪽에 붙는다', () => {
  const placement = placePanel({ x: 120, y: 500, width: 128, height: 128 }, workArea());
  assert.equal(placement.side, 'right');
  assert.equal(placement.x, 120 + 128 + 12);
  assertInside(placement, workArea());
});

test('META-002: 좌우가 모두 부족하면 위쪽에 놓는다', () => {
  const narrow: Rect = { x: 0, y: 0, width: 600, height: 1000 };
  const placement = placePanel({ x: 230, y: 700, width: 128, height: 128 }, narrow);
  assert.equal(placement.side, 'above');
  assertInside(placement, narrow);
});

test('META-002: 펫이 화면 끝에 있어도 작업 영역 안으로 보정된다', () => {
  const bottom = placePanel({ x: 1600, y: 1040, width: 128, height: 128 }, workArea());
  assertInside(bottom, workArea());

  const top = placePanel({ x: 1600, y: 0, width: 128, height: 128 }, workArea());
  assert.ok(top.y >= 25, '메뉴 바 아래로 보정된다');
  assertInside(top, workArea());
});

test('META-002: 두 번째 모니터의 오프셋 좌표에서도 그 모니터 안에 있다', () => {
  const second: Rect = { x: 1920, y: 0, width: 1440, height: 900 };
  const placement = placePanel({ x: 3200, y: 400, width: 128, height: 128 }, second);
  assert.equal(placement.side, 'left');
  assertInside(placement, second);
  assert.ok(placement.x >= 1920, '첫 번째 모니터로 넘어가면 안 된다');
});

test('META-002: 선호한 쪽이 실패하면 반대쪽도 반드시 실패한다', () => {
  // 기획서 4.2는 "펫이 오른쪽이면 왼쪽" 다음에 "좌우가 모두 부족하면 위쪽"을 둔다.
  // 먼 쪽을 먼저 고르는 규칙 자체가 "먼 쪽에 공간이 더 많다"를 뜻하므로, 선호한 쪽이
  // 실패하면 반대쪽도 실패한다. 즉 실제로 발동하는 대체 위치는 위쪽 하나뿐이다.
  for (const width of [600, 900, 1280, 1920, 3440]) {
    const area: Rect = { x: 0, y: 0, width, height: 1000 };
    for (let petX = 0; petX < width - 128; petX += 37) {
      const pet: Rect = { x: petX, y: 400, width: 128, height: 128 };
      const placement = placePanel(pet, area);
      assertInside(placement, area);

      if (placement.side === 'above') {
        assert.ok(pet.x - 12 - PANEL_WIDTH < area.x);
        assert.ok(pet.x + pet.width + 12 + PANEL_WIDTH > area.x + area.width);
      }
    }
  }
});
