/** 기획서 12장 `업적과 알림` 인수 조건(ACH-001 ~ ACH-009)의 실행 증거. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, petId } from '@pet/core';
import {
  AchievementCatalog,
  type AchievementDefinition,
  achievementScreen,
  BADGE_PALETTE,
  BADGE_SIZE,
  BADGED_ACHIEVEMENT_IDS,
  badgeFor,
  bubbleMessage,
  type ClaimOutcome,
  claimRewards,
  createMetaState,
  DEFAULT_BADGE,
  domainEvent,
  evaluate,
  type EvaluationOutcome,
  eventId,
  type EventPayload,
  factSnapshot,
  FixtureCollector,
  InMemoryCollection,
  InMemoryTokenClient,
  InMemoryPetClient,
  isUnlocked,
  MASK,
  MYSTERY_BADGE,
  type MetaState,
  observedTotal,
  recordEvent,
  runAggregation,
  STUB_GROWTH_RULES,
  tokenCounts,
  uiIcons,
} from '@pet/meta';

const NOW = '2026-08-24T14:37:12+09:00';

class Harness {
  state: MetaState = createMetaState();
  catalog = AchievementCatalog.embedded();
  tokens = new InMemoryTokenClient();
  collection = new InMemoryCollection();
  /** 펫 업적의 출처. 이벤트가 아니라 `PetClient` 의 현재 보유를 관측한다. */
  pets = new InMemoryPetClient();
  rules = STUB_GROWTH_RULES;
  clock = new FixedClock(NOW);

  constructor() {
    this.tokens.setNow(this.clock.now());
  }

  send(id: string, payload: EventPayload): void {
    recordEvent(this.state, domainEvent(eventId(id), this.clock.now(), payload));
  }

  evaluate(): EvaluationOutcome {
    return evaluate(this.state, this.catalog, this.tokens, this.pets, this.rules, this.clock);
  }

  /** 사용자가 업적 칸의 `보상 받기` 를 누른다. */
  claim(id: string): ClaimOutcome {
    return claimRewards(this.state, this.catalog, this.tokens, this.collection, id);
  }

  isUnlocked(id: string): boolean {
    const entry = this.state.progress.get(id);
    return entry !== undefined && isUnlocked(entry);
  }
}

const wonBattle = (streak: number): EventPayload => ({
  eventType: 'battle.finished',
  battleId: `battle-${streak}`,
  result: 'win',
  enemyTier: 1,
  streak,
});

test('ACH-001: 22개 ID와 보상이 업적 정의와 일치한다', () => {
  const catalog = AchievementCatalog.embedded();
  assert.equal(catalog.size, 22);

  const expected = [
    'collection.first_pet',
    'collection.dex_5',
    'collection.dex_15',
    'collection.dex_complete',
    'collection.first_epic',
    'collection.fusion_5',
    'collection.fusion_50',
    'growth.level_5',
    'growth.level_10',
    'growth.level_20',
    'growth.max_level',
    'growth.first_evolution',
    'battle.first_win',
    'battle.win_50',
    'battle.win_500',
    'battle.streak_10',
    'usage.tokens_1m',
    'usage.tokens_10m',
    'usage.tokens_100m',
    'usage.active_24h',
    'hidden.three_tools_day',
    'hidden.common_fusion_epic',
  ];
  for (const id of expected) assert.ok(catalog.get(id), `${id} 정의가 없다`);

  const firstPet = catalog.get('collection.first_pet');
  // 재화는 토큰량 그대로다. `첫 만남` 보상은 뽑기 1회 값이다.
  assert.equal(firstPet?.token, 100_000);
  assert.equal(firstPet?.title, '초보 조련사');
  assert.equal(firstPet?.trophy, true);

  const win500 = catalog.get('battle.win_500');
  assert.equal(win500?.token, 3_000_000);

  // 브론즈·실버·골드 티어는 없앴다. 단계는 이름의 Ⅰ·Ⅱ·Ⅲ 과 목표값이 이미 말해 준다.
  assert.ok(
    catalog.definitions.every((definition) => !('tier' in definition)),
    '정의에 티어가 남아 있지 않다',
  );

  const tokens100m = catalog.get('usage.tokens_100m');
  assert.equal(tokens100m?.target, 100_000_000);
  assert.notEqual(tokens100m?.trophy, true, '토큰 마일스톤 Ⅲ에는 트로피가 없다');

  const hidden = catalog.definitions.filter((d) => d.hidden === true).map((d) => d.id);
  assert.deepEqual(hidden, ['hidden.three_tools_day', 'hidden.common_fusion_epic']);
});

test('ACH-001: 알 수 없는 사실 키를 참조하는 정의는 거부된다', () => {
  assert.throws(
    () =>
      AchievementCatalog.fromDefinitions([
        {
          id: 'test.bogus',
          category: 'usage',
          name: '테스트',
          condition: '테스트',
          fact: '존재하지_않는_사실',
          target: 1,
          token: 0,
        } as AchievementDefinition,
      ]),
    /알 수 없는 사실 키/,
  );
});

test('ACH-002: 잠긴 히든 업적이 아무것도 노출하지 않는다', () => {
  const harness = new Harness();
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const hidden = screen.rows.find((row) => row.id === 'hidden.three_tools_day');
  assert.ok(hidden);
  assert.equal(hidden.name, MASK);
  assert.equal(hidden.condition, MASK);
  assert.equal(hidden.progressLabel, MASK);
  assert.deepEqual(hidden.rewards, [{ kind: 'masked', label: MASK, description: MASK }]);
  assert.equal(hidden.target, 0, '목표값도 노출하지 않는다');
  assert.equal(hidden.unlockedAtLabel, undefined);
  assert.equal(hidden.masked, true);

  // 실제 이름과 보상 문자열이 응답 어디에도 실려 나가지 않아야 한다.
  const json = JSON.stringify(screen);
  assert.ok(!json.includes('세 도구의 조련사'));
  assert.ok(!json.includes('기적의 연금술사'));

  const normal = screen.rows.find((row) => row.id === 'battle.win_50');
  assert.equal(normal?.name, '백전노장 Ⅰ');
  assert.equal(normal?.progressLabel, '0 / 50');
  assert.equal(normal?.masked, false);
});

test('ACH-002: 달성한 히든 업적은 실제 값을 공개한다', () => {
  const harness = new Harness();
  harness.send('fusion-1', {
    eventType: 'fusion.completed',
    fusionId: 'f-1',
    resultPetId: petId('pet-epic'),
    resultRarity: 'EPIC',
  });
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const hidden = screen.rows.find((row) => row.id === 'hidden.common_fusion_epic');
  assert.equal(hidden?.name, '연금술의 기적');
  assert.equal(hidden?.unlocked, true);
  assert.equal(hidden?.masked, false);
  assert.ok(
    hidden?.rewards.some((reward) => reward.kind === 'title' && reward.label === '기적의 연금술사'),
  );
});

test('연금술의 기적은 합성 결과가 에픽일 때만 열린다', () => {
  // 현재 합성은 같은 등급 10마리로 한 단계 위를 만든다. 에픽이 나오는 경로는 레어 합성뿐이다.
  const harness = new Harness();
  harness.send('fusion-rare', {
    eventType: 'fusion.completed',
    fusionId: 'f-rare',
    resultPetId: petId('pet-rare'),
    resultRarity: 'RARE',
  });
  harness.evaluate();

  assert.equal(harness.state.eventFacts.fusionCount, 1);
  assert.equal(harness.state.eventFacts.fusionEpic, 0);
  assert.ok(
    !harness.isUnlocked('hidden.common_fusion_epic'),
    '레어를 얻은 합성으로는 열리지 않는다',
  );

  harness.send('fusion-epic', {
    eventType: 'fusion.completed',
    fusionId: 'f-epic',
    resultPetId: petId('pet-epic'),
    resultRarity: 'EPIC',
  });
  harness.evaluate();

  assert.equal(harness.state.eventFacts.fusionCount, 2);
  assert.equal(harness.state.eventFacts.fusionEpic, 1);
  assert.ok(harness.isUnlocked('hidden.common_fusion_epic'));
});

test('업적 줄에 티어는 없고, 달성한 업적은 달성 시각을 보여준다', () => {
  const harness = new Harness();
  harness.pets.give('003');
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  assert.ok(
    screen.rows.every((row) => !('tier' in row)),
    '화면 모델에 티어가 없다',
  );

  // 시각은 시스템 로컬 시간으로 표시한다. 테스트 머신의 시간대에 기대지 않도록 같은 방식으로 만든다.
  const at = new Date(NOW);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const expected =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`;

  const achieved = screen.rows.find((row) => row.id === 'collection.first_pet');
  assert.equal(achieved?.unlocked, true);
  assert.equal(achieved?.unlockedAtLabel, expected);

  const locked = screen.rows.find((row) => row.id === 'collection.dex_5');
  assert.equal(locked?.unlocked, false);
  assert.equal(locked?.unlockedAtLabel, undefined, '달성하지 않은 업적에는 시각이 없다');
});

test('진행률의 큰 수는 자릿수를 끊어 적는다', () => {
  const harness = new Harness();
  harness.tokens.grantOnce('usage:test', 800_000, '사용량 보상');
  harness.evaluate();

  const row = achievementScreen(harness.state, harness.catalog, undefined).rows.find(
    (candidate) => candidate.id === 'usage.tokens_1m',
  );

  assert.equal(row?.progressLabel, '800,000 / 1,000,000');
});

test('업적마다 자기 배지가 있고 모양이 서로 다르다', () => {
  const ids = AchievementCatalog.embedded().definitions.map((definition) => definition.id);
  assert.deepEqual(
    [...BADGED_ACHIEVEMENT_IDS].sort(),
    [...ids].sort(),
    '업적 정의와 배지가 일대일이다',
  );

  const seen = new Set<string>();
  for (const id of ids) {
    const badge = badgeFor(id);
    assert.equal(badge.length, BADGE_SIZE, `${id}: 16줄이어야 한다`);
    for (const line of badge) {
      assert.equal(line.length, BADGE_SIZE, `${id}: 한 줄이 16글자여야 한다`);
      for (const pixel of line) {
        assert.ok(pixel === '.' || pixel in BADGE_PALETTE, `${id}: 팔레트에 없는 글자 ${pixel}`);
      }
    }
    assert.ok(
      badge.some((line) => /[^.]/.test(line)),
      `${id}: 빈 그림이 아니다`,
    );

    const drawing = badge.join('\n');
    assert.ok(!seen.has(drawing), `${id}: 다른 업적과 같은 그림이다`);
    seen.add(drawing);
  }
  assert.ok(!seen.has(MYSTERY_BADGE.join('\n')), '물음표는 어느 업적의 배지와도 다르다');
});

test('가려진 히든 업적은 자기 배지 대신 물음표를 내보내고, 달성하면 자기 배지를 보여준다', () => {
  const harness = new Harness();
  const hiddenId = 'hidden.common_fusion_epic';
  const rowOf = () =>
    achievementScreen(harness.state, harness.catalog, undefined).rows.find(
      (row) => row.id === hiddenId,
    );

  harness.evaluate();
  const masked = rowOf();
  assert.equal(masked?.masked, true);
  assert.deepEqual(masked?.badge, MYSTERY_BADGE, '그림이 조건을 미리 알려 주면 안 된다');

  harness.send('fusion-epic', {
    eventType: 'fusion.completed',
    fusionId: 'f-epic',
    resultPetId: petId('pet-epic'),
    resultRarity: 'EPIC',
  });
  harness.evaluate();
  const revealed = rowOf();
  assert.equal(revealed?.unlocked, true);
  assert.deepEqual(revealed?.badge, badgeFor(hiddenId));

  // 잠겨 있어도 히든이 아닌 업적은 자기 배지를 내보낸다. 어둡게 그리는 것은 화면의 일이다.
  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  const locked = screen.rows.find((row) => row.id === 'battle.win_50');
  assert.equal(locked?.unlocked, false);
  assert.deepEqual(locked?.badge, badgeFor('battle.win_50'));
});

test('배지를 아직 그리지 않은 업적은 기본 배지로 보인다', () => {
  const harness = new Harness();
  harness.catalog = AchievementCatalog.fromDefinitions([
    ...AchievementCatalog.embedded().definitions,
    {
      id: 'battle.win_30',
      category: 'battle',
      name: '삼십 고개',
      condition: '전투 30승',
      fact: 'battle_wins',
      target: 30,
      token: 55,
    },
  ]);

  const row = achievementScreen(harness.state, harness.catalog, undefined).rows.find(
    (candidate) => candidate.id === 'battle.win_30',
  );

  assert.deepEqual(row?.badge, DEFAULT_BADGE);
});

test('ACH-003: 같은 이벤트와 같은 업적을 반복해도 해제와 보상이 한 번뿐이다', () => {
  // 같은 이벤트: 전투 이벤트로 확인한다. 판정은 하지 않는다 — 판정하면 `첫 승리` 가 함께
  // 열려 아래의 “업적 하나 → 지급 한 번” 확인과 섞인다.
  const replay = new Harness();
  for (let index = 0; index < 5; index += 1) {
    replay.send('battle-1', wonBattle(1));
  }
  assert.equal(replay.state.processedEvents.size, 1, '같은 eventId는 한 번만 반영된다');
  assert.equal(replay.state.eventFacts.battleWins, 1, '같은 전투는 한 번만 센다');

  // 같은 업적: 펫 업적은 이벤트가 아니라 보유 관측으로 열린다. 같은 보유를 여러 번 관측해도
  // 해제와 보상은 한 번이다.
  const harness = new Harness();
  harness.pets.give('003');
  const first = harness.evaluate();
  assert.ok(first.newlyUnlocked.includes('collection.first_pet'));

  for (let index = 0; index < 4; index += 1) {
    assert.deepEqual(
      harness.evaluate().newlyUnlocked,
      [],
      '이미 해제된 업적이 다시 해제되면 안 된다',
    );
  }

  // 달성만으로는 보상이 들어오지 않는다. 사용자가 받기를 눌러야 한다.
  assert.equal(harness.tokens.grantedKeyCount, 0, '판정은 보상을 지급하지 않는다');
  assert.equal(harness.collection.trophies.length, 0);

  assert.deepEqual(harness.claim('collection.first_pet'), { claimed: true, error: undefined });
  assert.deepEqual(harness.claim('collection.first_pet'), { claimed: true, error: undefined });

  assert.equal(harness.tokens.grantedAmount('achievement:collection.first_pet'), 100_000);
  assert.equal(harness.tokens.grantedKeyCount, 1, '두 번 눌러도 한 번만 지급된다');
  assert.equal(harness.collection.trophies.length, 1, '트로피도 한 번만 지급된다');
  assert.deepEqual(harness.state.profile.ownedTitles, ['초보 조련사']);
});

test('ACH-004: 새로 추가한 정의가 기존 사실로 소급 판정된다', () => {
  const harness = new Harness();

  // 연승 없이 37승. 연승이 쌓이면 `무패` 보상(1,200,000)이 누적 토큰 100만을 넘겨 토큰 마일스톤이
  // 함께 열리는데, 여기서는 새 정의 하나만 소급되는 것을 본다.
  for (let index = 1; index <= 37; index += 1) {
    harness.send(`battle-${index}`, wonBattle(1));
  }
  harness.evaluate();
  assert.ok(harness.isUnlocked('battle.first_win'));
  assert.ok(!harness.isUnlocked('battle.win_50'));

  // 앱 업데이트로 "전투 30승" 업적이 새로 추가됐다고 하자.
  harness.catalog = AchievementCatalog.fromDefinitions([
    ...AchievementCatalog.embedded().definitions,
    {
      id: 'battle.win_30',
      category: 'battle',
      name: '삼십 고개',
      condition: '전투 30승',
      fact: 'battle_wins',
      target: 30,
      token: 55,
    },
  ]);

  // 과거 이벤트를 다시 재생하지 않고, 같은 판정 함수를 한 번 부르면 끝이다.
  const outcome = harness.evaluate();

  assert.deepEqual(outcome.newlyUnlocked, ['battle.win_30']);
  harness.claim('battle.win_30');
  assert.equal(
    harness.tokens.grantedAmount('achievement:battle.win_30'),
    55,
    '소급 판정으로 열린 업적도 일반 달성과 똑같이 보상을 받는다',
  );

  // 완료율의 분모가 늘어난 정의 수를 따라간다(기획서 7.1).
  assert.equal(achievementScreen(harness.state, harness.catalog, undefined).total, 23);
});

test('ACH-005: 첫 칭호만 자동 장착된다', () => {
  const harness = new Harness();

  harness.pets.give('003');
  harness.evaluate();
  assert.equal(harness.state.profile.equippedTitle, undefined, '받기 전에는 칭호가 없다');
  harness.claim('collection.first_pet');
  assert.equal(harness.state.profile.equippedTitle, '초보 조련사');

  harness.pets.give('006');
  harness.evaluate();
  assert.ok(harness.isUnlocked('collection.first_epic'));
  harness.claim('collection.first_epic');
  assert.equal(
    harness.state.profile.equippedTitle,
    '초보 조련사',
    '두 번째 칭호가 장착값을 덮어쓰면 안 된다',
  );
  assert.equal(harness.state.profile.ownedTitles.length, 2);
});

test('ACH-006: 첫 만남 트로피만 자동 배치된다', () => {
  const harness = new Harness();
  harness.collection.setRoomSlots(5);

  harness.pets.give('003');
  // 트로피가 있는 다른 업적. 도감 완성은 등록된 종이 여섯뿐이라 이 테스트에서 닿을 수 없다.
  harness.pets.give('004', { level: STUB_GROWTH_RULES.maxLevel });
  harness.evaluate();
  harness.claim('collection.first_pet');
  harness.claim('growth.max_level');

  const trophies = harness.collection.trophies;
  assert.equal(
    trophies.find(
      (t: { achievementId: string; placement: string }) =>
        t.achievementId === 'collection.first_pet',
    )?.placement,
    'room',
  );
  assert.equal(
    trophies.find(
      (t: { achievementId: string; placement: string }) => t.achievementId === 'growth.max_level',
    )?.placement,
    'storage',
    '나머지 트로피는 보관함으로 간다',
  );
});

test('ACH-006: 자동 배치 실패가 트로피 지급 실패로 이어지지 않는다', () => {
  const harness = new Harness();
  harness.collection.setRoomSlots(0);

  harness.pets.give('003');
  harness.evaluate();
  assert.equal(harness.claim('collection.first_pet').claimed, true);

  assert.equal(harness.collection.trophies.length, 1);
  assert.equal(harness.collection.trophies[0]?.placement, 'storage');
  assert.ok(harness.isUnlocked('collection.first_pet'));
});

test('ACH-007: 한 개는 상세 말풍선, 여러 개는 집계 말풍선', () => {
  const harness = new Harness();

  harness.pets.give('003');
  const single = harness.evaluate();
  // 보상은 아직 받지 않았다. 말풍선은 받으러 오라고 알린다.
  assert.equal(bubbleMessage(single, harness.catalog), '첫 만남 달성! 보상을 받아 가!');

  for (let index = 1; index <= 50; index += 1) {
    harness.send(`battle-${index}`, wonBattle(index));
  }
  const many = harness.evaluate();
  assert.ok(many.newlyUnlocked.length >= 2);
  assert.equal(
    bubbleMessage(many, harness.catalog),
    `${many.newlyUnlocked.length}개 업적을 달성했어! 보상을 받아 가!`,
  );
});

test('ACH-009: 보상 받기가 실패하면 받을 보상으로 남고, 다시 누르면 같은 멱등 키로 지급된다', () => {
  const harness = new Harness();
  harness.pets.give('003');
  const outcome = harness.evaluate();

  assert.ok(harness.isUnlocked('collection.first_pet'), '해제는 됐다');
  assert.deepEqual(outcome.claimableRewards, ['collection.first_pet']);
  const rowOf = () =>
    achievementScreen(harness.state, harness.catalog, undefined).rows.find(
      (row) => row.id === 'collection.first_pet',
    );
  assert.equal(rowOf()?.rewardState, 'claimable');
  assert.equal(rowOf()?.rewardError, undefined);

  harness.tokens.failNextGrant();
  const failed = harness.claim('collection.first_pet');
  assert.equal(failed.claimed, false);
  assert.equal(failed.error, '재화 지급에 실패했어요');
  assert.equal(harness.tokens.grantedKeyCount, 0);
  assert.ok(harness.isUnlocked('collection.first_pet'), '지급에 실패해도 달성은 그대로다');
  assert.equal(rowOf()?.rewardState, 'claimable', '여전히 받을 수 있다');
  assert.equal(rowOf()?.rewardError, '재화 지급에 실패했어요');

  assert.deepEqual(harness.claim('collection.first_pet'), { claimed: true, error: undefined });
  assert.equal(harness.tokens.grantedAmount('achievement:collection.first_pet'), 100_000);
  assert.equal(rowOf()?.rewardState, 'claimed');
  assert.equal(rowOf()?.rewardError, undefined);

  harness.claim('collection.first_pet');
  assert.equal(harness.tokens.grantedKeyCount, 1, '다시 눌러도 중복 지급되지 않는다');
});

test('달성하지 않았거나 없는 업적의 보상은 받을 수 없다', () => {
  const harness = new Harness();
  harness.evaluate();

  const locked = harness.claim('battle.win_50');
  assert.equal(locked.claimed, false);
  assert.ok(locked.error);

  const unknown = harness.claim('no.such.achievement');
  assert.equal(unknown.claimed, false);
  assert.ok(unknown.error);

  assert.equal(harness.tokens.grantedKeyCount, 0);
  assert.equal(harness.collection.trophies.length, 0);
});

test('보상은 종류를 달고 나간다 — 화면이 토큰 · 칭호 · 트로피를 다르게 그린다', () => {
  const harness = new Harness();
  const screen = achievementScreen(harness.state, harness.catalog, undefined);

  // 눈에 보이는 글자(label)는 짧게, 무엇인지는 설명(description)에 온전히 둔다. 아이콘이 종류를
  // 말해 주므로 "토큰" · "칭호" 라는 말을 글자에서 되풀이하지 않는다.
  assert.deepEqual(screen.rows.find((row) => row.id === 'collection.first_pet')?.rewards, [
    { kind: 'token', label: '100,000', description: '토큰 100,000' },
    { kind: 'title', label: '초보 조련사', description: '칭호 초보 조련사' },
    { kind: 'trophy', label: '트로피', description: '트로피' },
  ]);
  assert.deepEqual(screen.rows.find((row) => row.id === 'collection.dex_5')?.rewards, [
    { kind: 'token', label: '300,000', description: '토큰 300,000' },
  ]);
});

test('화면 공용 아이콘 — 종류마다 8×8 이고, 칭호는 토큰과 헷갈리지 않게 금색을 쓰지 않는다', () => {
  const icons = uiIcons();
  assert.deepEqual(icons.palette, BADGE_PALETTE, '배지와 같은 팔레트를 쓴다');
  assert.deepEqual(Object.keys(icons.rewards).sort(), ['title', 'token', 'trophy']);

  const drawings = new Set<string>();
  for (const icon of Object.values(icons.rewards)) {
    assert.equal(icon.length, 8);
    for (const line of icon) {
      assert.equal(line.length, 8);
      for (const pixel of line) assert.ok(pixel === '.' || pixel in BADGE_PALETTE);
    }
    drawings.add(icon.join('\n'));
  }
  assert.equal(drawings.size, 3, '세 아이콘이 서로 다르다');

  // 토큰은 금색 동전이다. 칭호까지 금색 동그라미면 둘이 같은 것으로 읽힌다.
  assert.ok(icons.rewards.token.join('').includes('y'), '토큰은 금색이다');
  assert.ok(!icons.rewards.title.join('').includes('y'), '칭호는 금색을 쓰지 않는다');
});

test('업적 화면은 줄마다 보상 상태를 알려 주고 받을 보상 수를 센다', () => {
  const harness = new Harness();
  harness.pets.give('003');
  harness.pets.give('006');
  harness.evaluate();

  const before = achievementScreen(harness.state, harness.catalog, undefined);
  const state = (screen: typeof before, id: string) =>
    screen.rows.find((row) => row.id === id)?.rewardState;
  assert.equal(state(before, 'collection.first_pet'), 'claimable');
  assert.equal(state(before, 'collection.first_epic'), 'claimable');
  assert.equal(state(before, 'battle.win_50'), 'locked');
  assert.equal(state(before, 'hidden.three_tools_day'), 'locked', '가려진 줄도 잠김이다');
  assert.equal(before.claimableCount, 2);

  harness.claim('collection.first_pet');
  const after = achievementScreen(harness.state, harness.catalog, undefined);
  assert.equal(state(after, 'collection.first_pet'), 'claimed');
  assert.equal(after.claimableCount, 1);
  // 필터를 걸어도 받을 보상 수는 전체 기준이다. 다른 탭에 남은 보상을 놓치지 않게 한다.
  assert.equal(achievementScreen(harness.state, harness.catalog, 'battle').claimableCount, 1);
});

test('사용량 업적이 수집 파이프라인 결과로 판정된다', () => {
  const harness = new Harness();
  const collector = FixtureCollector.withEmptySnapshots();
  runAggregation(harness.state, collector, harness.tokens, harness.clock);

  for (const [provider, model] of [
    ['claude_code', 'claude-opus-5'],
    ['codex', 'gpt-5.4-codex'],
    ['gemini_cli', 'gemini-3-pro'],
  ] as const) {
    collector.accumulate(
      provider,
      '2026-08-24',
      model,
      tokenCounts(200_000, 100_000, 50_000, 50_000),
    );
  }
  runAggregation(harness.state, collector, harness.tokens, harness.clock);

  assert.equal(observedTotal(harness.state), 1_200_000);

  const outcome = harness.evaluate();
  assert.ok(outcome.newlyUnlocked.includes('usage.tokens_1m'));
  assert.ok(
    outcome.newlyUnlocked.includes('hidden.three_tools_day'),
    '세 도구의 조련사가 달성되어야 한다',
  );
});

test('토큰 마일스톤은 누적 토큰으로 판정한다 — 재화가 되지 않는 사용량은 세지 않는다', () => {
  const harness = new Harness();
  const collector = FixtureCollector.withEmptySnapshots();
  const use = (input: number, cacheRead: number): void => {
    collector.accumulate(
      'claude_code',
      '2026-08-24',
      'claude-opus-5',
      tokenCounts(input, 0, 0, cacheRead),
    );
    runAggregation(harness.state, collector, harness.tokens, harness.clock);
  };
  runAggregation(harness.state, collector, harness.tokens, harness.clock);

  // 관측으로는 510만이지만 쌓인 토큰은 10만이다.
  use(100_000, 5_000_000);
  harness.evaluate();
  assert.ok(!harness.isUnlocked('usage.tokens_1m'), '캐시 읽기로는 마일스톤이 열리지 않는다');
  assert.equal(harness.state.progress.get('usage.tokens_1m')?.progress, 100_000);

  use(900_000, 0);
  const outcome = harness.evaluate();
  assert.deepEqual(outcome.newlyUnlocked, ['usage.tokens_1m']);
  assert.equal(harness.tokens.balance(), 1_000_000, '보상은 받기 전까지 들어오지 않는다');

  // 받은 업적 보상도 쌓은 토큰이다. 받은 뒤의 판정에서 누적에 들어간다.
  harness.claim('usage.tokens_1m');
  assert.equal(harness.tokens.balance(), 1_200_000, '마일스톤 Ⅰ 보상 200,000');
  harness.evaluate();
  assert.equal(harness.state.progress.get('usage.tokens_10m')?.progress, 1_200_000);
});

test('업적 보상만으로도 누적 토큰이 목표에 닿으면 토큰 마일스톤이 열린다', () => {
  // 누적 토큰은 화면에 보이는 그 숫자다. 어디서 쌓였는지를 가리지 않는다.
  const harness = new Harness();
  for (let index = 1; index <= 10; index += 1) {
    harness.send(`battle-${index}`, wonBattle(index));
  }

  const first = harness.evaluate();
  assert.ok(first.newlyUnlocked.includes('battle.streak_10'), '무패 — 보상 1,200,000');
  assert.deepEqual(harness.evaluate().newlyUnlocked, [], '받지 않은 보상은 누적에 들지 않는다');

  harness.claim('battle.streak_10');
  const afterClaim = harness.evaluate();
  assert.deepEqual(afterClaim.newlyUnlocked, ['usage.tokens_1m']);
});

test('누적 토큰을 읽지 못한 판정은 마일스톤 진행을 그대로 둔다', () => {
  const harness = new Harness();
  harness.tokens.grantOnce('usage:test', 400_000, '사용량 보상');
  harness.evaluate();
  assert.equal(harness.state.progress.get('usage.tokens_1m')?.progress, 400_000);

  harness.tokens.grantOnce('usage:test-2', 100_000, '사용량 보상');
  harness.tokens.setQueryFailure(true);
  harness.pets.give('003');
  const outcome = harness.evaluate();

  assert.equal(harness.state.progress.get('usage.tokens_1m')?.progress, 400_000);
  assert.ok(outcome.newlyUnlocked.includes('collection.first_pet'), '다른 업적 판정은 계속된다');
});

test('진행률은 소스가 rebase돼도 감소하지 않는다', () => {
  const harness = new Harness();
  const collector = FixtureCollector.withEmptySnapshots();
  runAggregation(harness.state, collector, harness.tokens, harness.clock);

  collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokenCounts(300_000, 200_000));
  runAggregation(harness.state, collector, harness.tokens, harness.clock);
  harness.evaluate();
  const before = harness.state.progress.get('usage.tokens_1m')?.progress;
  assert.equal(before, 500_000);

  collector.setSnapshot({ provider: 'claude_code', rows: new Map() });
  runAggregation(harness.state, collector, harness.tokens, harness.clock);
  harness.evaluate();

  assert.equal(harness.state.progress.get('usage.tokens_1m')?.progress, before);
});

test('카테고리 필터는 그 카테고리만 고르고 완료율 분모는 전체다', () => {
  const harness = new Harness();
  harness.evaluate();
  const screen = achievementScreen(harness.state, harness.catalog, 'battle');
  assert.equal(screen.rows.length, 4);
  assert.ok(screen.rows.every((row) => row.category === 'battle'));
  assert.equal(screen.total, 22, '완료율 분모는 필터와 무관하게 전체다');
});

test('완료율 분모에 히든 업적이 포함된다', () => {
  const harness = new Harness();
  harness.pets.give('003');
  harness.evaluate();

  const screen = achievementScreen(harness.state, harness.catalog, undefined);
  assert.equal(screen.total, 22);
  assert.equal(screen.unlocked, 1);
  assert.equal(screen.completionPercent, 5); // 1/22 = 4.5% → 5%
});

test('사실이 감소하지 않는다', () => {
  const harness = new Harness();
  const veteran = harness.pets.give('003', { level: 20 });
  harness.pets.give('004', { level: 3 });
  harness.evaluate();
  assert.equal(
    factSnapshot(harness.state).max_pet_level,
    20,
    '다른 펫의 낮은 레벨이 최고값을 낮추면 안 된다',
  );

  // 최고 레벨 펫을 잃어도 관측한 최고치는 남는다(기획서 9.4).
  harness.pets.remove(veteran.ownedPetId);
  harness.evaluate();
  assert.equal(factSnapshot(harness.state).max_pet_level, 20);
  assert.equal(factSnapshot(harness.state).max_level_reached, 0);
});
