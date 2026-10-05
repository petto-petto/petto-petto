/**
 * 화면이 부르는 핸들러. Spring MVC의 `@RestController`에 해당한다.
 *
 * ## 왜 `ipcMain`을 부르지 않는가
 *
 * 여기서 `ipcMain.handle`을 직접 부르면 이 패키지가 Electron을 의존하게 되고, 창을
 * 띄우지 않고는 테스트할 수 없어진다. 그래서 **채널 이름과 함수의 맵만 돌려주고**,
 * 그것을 `ipcMain`에 붙이는 일은 앱이 한다.
 *
 * 덕분에 meta는 자기 채널 이름과 화면 계약을 온전히 소유하면서도 프레임워크를 모른다.
 * Electron이 아닌 무언가로 바뀌어도 이 파일은 그대로다.
 *
 * 이 파일에는 규칙이 없다. 전부 도메인 함수를 부르고 결과를 그대로 돌려준다.
 */

import { PROVIDERS, isProvider, petId, providerName, type Provider } from '@pet/core';
import { domainEvent, eventId, type EventPayload } from '../events/index.ts';
import {
  CollectError,
  FixtureCollector,
  GACHA_READY_BUBBLE,
  achievementScreen,
  bubbleMessage,
  equipTitle,
  factSnapshot,
  isCategory,
  isPeriod,
  isPetSize,
  setSourceEnabled,
  settingsScreen,
  summaryScreen,
  tokenCounts,
  usageScreen,
  type AggregationRun,
  type EvaluationOutcome,
  type OwnedPet,
  type PetSummary,
} from '../index.ts';

import type { AggregationResult, MetaAppState } from './state.ts';

/**
 * meta가 앱 껍데기에 요구하는 것.
 *
 * 창을 보이고 숨기는 일, 외부 브라우저를 여는 일은 meta가 할 수 없다. 그렇다고 Electron을
 * 직접 부르면 이 패키지가 프레임워크에 묶인다. 그래서 **필요한 동작만 인터페이스로 적고**
 * 구현은 앱이 준다. 다른 도메인에 포트를 두는 것과 같은 규칙이다.
 */
/** 대역만 가진 데모 기능을 안전하게 확인한다. */
function hasFailNextGrant(value: unknown): value is { failNextGrant(): void } {
  return typeof (value as { failNextGrant?: unknown }).failNextGrant === 'function';
}

/**
 * 데모 채널이 기록을 꾸며 넣을 수 있는 수집기. 실제 `ccusage` 수집기에는 가짜 기록을 넣을
 * 방법이 없으므로, 데모 모드(`META_DEMO_USAGE=1`)가 아니면 거절한다.
 */
function demoCollector(state: MetaAppState): FixtureCollector {
  if (state.collector instanceof FixtureCollector) return state.collector;
  throw new Error('데모 수집기에서만 쓸 수 있습니다 (META_DEMO_USAGE=1)');
}

/**
 * 초상화를 찾는 데 필요한 값.
 *
 * `evolutionStage` 를 받는 이유: 예전에는 레벨에서 진화 단계를 추측했는데(10 · 20 경계), 오버레이
 * 성장 규칙의 경계는 15 · 35 라서 원래부터 어긋나 있었다. 이제 `PetClient` 가 저장된 진화 단계를
 * 주므로 추측하지 않는다.
 */
export type PortraitSource = Pick<OwnedPet, 'speciesId' | 'rarity' | 'sprite' | 'evolutionStage'>;

export interface MetaHost {
  showPanel(): void;
  hidePanel(): void;
  applyOverlayVisibility(visible: boolean): void;
  applyPetSize(petSize: string): void;
  /** 펫 창과 패널 창에 같은 이벤트를 보낸다. */
  broadcast(channel: string, payload: unknown): void;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): void;
  /**
   * 활성 펫의 초상화 주소.
   *
   * 에셋이 어디에 어떤 이름으로 놓이는지는 앱만 안다. meta 는 에셋 경로에 필요한 네 값만
   * 넘기고 주소를 받는다. 에셋이 없으면 `undefined`.
   */
  petPortrait(pet: PortraitSource): string | undefined;
}

/** 채널 이름 → 처리 함수. 앱이 이것을 자기 IPC에 붙인다. */
export type MetaHandlers = Record<string, (...args: unknown[]) => unknown>;

/** 집계·판정 후 렌더러에 알릴 내용. */
export interface TickReport {
  activityMinuteAdded: boolean;
  /** 소스별 결과를 사람이 읽을 수 있는 짧은 문장으로. */
  sourceNotes: string[];
  /**
   * 수집에 실패한 소스와 사용자 문구(`Codex: 집계 오류`). `갱신` 버튼이 실패를 성공처럼 보이지
   * 않게 쓴다. 기록 없음(`not_found`)은 그 도구를 쓰지 않는 정상 상태라 넣지 않는다.
   */
  failures: string[];
  /** 기획서 6.3·ACH-007의 말풍선 문구. 표시할 것이 없으면 `undefined`. */
  bubble: string | undefined;
  newlyUnlocked: string[];
}

function providerFromKey(value: unknown): Provider {
  if (typeof value === 'string' && isProvider(value)) return value;
  throw new Error(`알 수 없는 수집 소스: ${String(value)}`);
}

function describe(run: AggregationRun): string[] {
  return run.outcomes.map((outcome) => {
    const name = PROVIDERS.includes(outcome.provider) ? outcome.provider : outcome.provider;
    let detail: string;
    switch (outcome.result.kind) {
      case 'baseline_captured':
        detail = '기준점을 잡았어요 (앱을 켜기 전 기록은 제외)';
        break;
      case 'applied':
        // 화면의 다른 숫자와 같은 기준 — 재화로 쌓인 양을 말한다.
        detail = `토큰 +${outcome.result.rewardTokens}`;
        break;
      case 'no_change':
        detail = '변화 없음';
        break;
      case 'duplicate':
        detail = '이미 처리한 증가분';
        break;
      case 'rebased':
        detail = '기록이 줄어 기준점을 다시 잡았어요';
        break;
      case 'skipped':
        detail = '수집 중지';
        break;
      case 'failed':
        detail = outcome.result.error.userMessage();
        break;
    }
    return `${name}: ${detail}`;
  });
}

function failuresOf(run: AggregationRun): string[] {
  return run.outcomes.flatMap((outcome) =>
    outcome.result.kind === 'failed' && outcome.result.error.kind !== 'not_found'
      ? [`${providerName(outcome.provider)}: ${outcome.result.error.userMessage()}`]
      : [],
  );
}

/**
 * 한 번의 집계 뒤에 펫이 할 말. 할 말이 없으면 `undefined`.
 *
 * 기획서 6.3 / ACH-008: 오버레이가 숨겨졌거나 해당 알림이 꺼져 있으면 말풍선을 표시하지 않는다.
 * 판정과 보상은 이미 끝났으므로 여기서 억제하는 것은 표시뿐이고, 억제한 것은 나중에 재생하지
 * 않는다.
 *
 * 업적 달성과 뽑기 가능이 같은 집계에서 함께 일어나면 한 말풍선에 이어 붙인다. 업적 보상이 곧
 * 뽑기 비용을 넘기는 경우가 흔해서(`첫 만남`), 하나만 고르면 다른 하나는 영영 표시되지 않는다.
 */
export function tickBubble(
  state: MetaAppState,
  outcome: EvaluationOutcome,
  gachaReady: boolean,
): string | undefined {
  const settings = state.meta.settings;
  if (!settings.overlayVisible) return undefined;
  const parts = [
    settings.notifyAchievement ? bubbleMessage(outcome, state.catalog) : undefined,
    gachaReady && settings.notifyGachaReady ? GACHA_READY_BUBBLE : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

function report(
  state: MetaAppState,
  host: MetaHost,
  { run, outcome, gachaReady }: AggregationResult,
): TickReport {
  const bubble = tickBubble(state, outcome, gachaReady);

  const tick: TickReport = {
    activityMinuteAdded: run.activityMinuteAdded,
    sourceNotes: describe(run),
    failures: failuresOf(run),
    bubble,
    newlyUnlocked: outcome.newlyUnlocked,
  };

  // 말풍선은 펫 창이 그린다. 패널이 아니라 펫이 알림 표면이기 때문이다(기획서 6.3).
  host.broadcast('usage:aggregated', { activityMinuteAdded: tick.activityMinuteAdded, bubble });
  return tick;
}

/**
 * meta의 모든 핸들러를 만든다.
 *
 * 채널 이름이 이 파일에 모여 있다는 점이 중요하다. meta가 자기 화면 계약을 온전히
 * 소유하고, 앱은 그 목록을 그대로 등록만 한다.
 */
export function metaHandlers(state: MetaAppState, host: MetaHost): MetaHandlers {
  const handlers: MetaHandlers = {};
  const handle = (channel: string, listener: (...args: unknown[]) => unknown): void => {
    handlers[channel] = listener;
  };

  /* ---------- 조회 ---------- */

  handle('info:summary', () =>
    summaryScreen(
      state.meta,
      state.catalog,
      state.today(),
      state.pets,
      state.tokens,
      state.growthRules,
      state.gacha,
    ),
  );

  /*
   * 프로필 초상화. 뷰 모델에 넣지 않고 별도 채널로 둔 이유: 주소는 앱의 에셋 배치에
   * 딸린 값이라 순수한 `view/`가 만들 수 없다. 요약 모델은 규칙만 담는다.
   */
  handle('info:pet-portrait', () => {
    try {
      const active = state.pets.getActivePet();
      // 고른 펫이 없으면 그릴 초상화도 없다. 오류가 아니다.
      return active === null ? undefined : host.petPortrait(active);
    } catch {
      // 펫 조회가 실패하면 초상화도 없다. 요약의 나머지는 이 실패와 무관하다.
      return undefined;
    }
  });

  handle('info:usage', (period) =>
    usageScreen(
      state.meta,
      state.today(),
      typeof period === 'string' && isPeriod(period) ? period : 'all',
    ),
  );

  handle('settings:view', () =>
    settingsScreen(state.meta, state.sponsors, state.dataLocation, state.version),
  );

  handle('achievements:view', (category) => {
    // 기획서 4.2: 필터는 현재 실행 중에만 기억한다.
    if (category === 'all') {
      state.achievementFilter = undefined;
    } else if (typeof category === 'string' && isCategory(category)) {
      state.achievementFilter = category;
    }
    return achievementScreen(state.meta, state.catalog, state.achievementFilter);
  });

  handle('pet:overlay', () => state.collection.overlayPet());

  /* ---------- 수집 ---------- */

  // 켜고 끈 소스 하나만 다시 본다. 끌 때는 수집기를 실행하지 않고, 켤 때는 그 소스만 새로 읽어
  // 기준점을 잡는다(8.2·8.4). 다른 소스의 수집을 기다리게 하지 않는다.
  handle('collect:toggle', async (provider, enabled) => {
    const target = providerFromKey(provider);
    setSourceEnabled(state.meta, state.clock, target, enabled === true);
    const result = await state.rescan(target);
    state.persist();
    return report(state, host, result);
  });

  handle('collect:rescan', async (provider) => {
    const result = await state.rescan(providerFromKey(provider));
    state.persist();
    return report(state, host, result);
  });

  // 사용량 화면의 `갱신` 버튼. 1분 주기와 같은 경로다(COLLECT-003).
  handle('collect:now', async () => {
    const result = await state.aggregate();
    state.persist();
    return report(state, host, result);
  });

  /* ---------- 설정 ---------- */

  handle('settings:display', (key, value) => {
    switch (key) {
      case 'overlay_visible': {
        state.meta.settings.overlayVisible = value === true;
        host.applyOverlayVisibility(state.meta.settings.overlayVisible);
        break;
      }
      case 'pet_size': {
        if (typeof value !== 'string' || !isPetSize(value)) throw new Error('알 수 없는 펫 크기');
        state.meta.settings.petSize = value;
        host.applyPetSize(value);
        break;
      }
      case 'autostart': {
        // 기획서 SET-006: 사용자가 켤 때만 등록한다. 프로토타입은 실제 OS 등록을 하지
        // 않으므로 값만 보관하고 화면에 그 사실을 표시한다.
        state.meta.settings.autostart = value === true;
        break;
      }
      default:
        throw new Error(`알 수 없는 설정: ${String(key)}`);
    }
    state.persist();
  });

  handle('settings:notification', (key, value) => {
    switch (key) {
      case 'levelup':
        state.meta.settings.notifyLevelup = value === true;
        break;
      case 'achievement':
        state.meta.settings.notifyAchievement = value === true;
        break;
      case 'gacha_ready':
        state.meta.settings.notifyGachaReady = value === true;
        break;
      default:
        throw new Error(`알 수 없는 알림: ${String(key)}`);
    }
    state.persist();
  });

  /* ---------- 프로필 ---------- */

  handle('profile:equip-title', (title) => {
    const equipped = equipTitle(state.meta.profile, typeof title === 'string' ? title : undefined);
    if (!equipped) throw new Error('보유하지 않은 칭호입니다');
    state.persist();
  });

  /* ---------- 창 ---------- */

  handle('panel:open', (screenName) => {
    state.panelScreen = typeof screenName === 'string' ? screenName : 'info';
    host.showPanel();
    // 기획서 4.2: 정보와 설정은 패널을 다시 열 때 기본 서브탭으로 진입한다.
    host.broadcast('panel:show', state.panelScreen);
  });

  handle('panel:close', () => host.hidePanel());
  handle('panel:current', () => state.panelScreen);

  handle('shell:open-external', async (url) => {
    // 후원 주소와 저장소 링크만 외부 브라우저로 연다.
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('https 주소만 열 수 있습니다');
    }
    await host.openExternal(url);
  });

  handle('shell:reveal-data', () => {
    host.revealPath(state.dataLocation);
  });

  /* ---------- 진단 ---------- */

  handle('debug:log', (message) => {
    console.log(`[UI] ${String(message)}`);
  });

  handle('debug:selftest-enabled', () => process.env['META_PROTO_SELFTEST'] !== undefined);

  /* ---------- 시연 (프로토타입 전용) ---------- */
  //
  // 다른 도메인이 아직 없어서 `pet.acquired`, `battle.finished` 같은 이벤트를 발행해 줄
  // 주체가 없다. 업적 판정이 실제로 도는 것을 보여주려면 손으로 넣을 수밖에 없다.

  handle('demo:event', (kind) => {
    const unique = Date.now();
    const facts = factSnapshot(state.meta);

    let payload: EventPayload;
    switch (kind) {
      case 'fusion_miracle':
        payload = {
          eventType: 'fusion.completed',
          fusionId: `fusion-${unique}`,
          resultPetId: petId(`pet-${unique}`),
          resultRarity: 'EPIC',
        };
        break;
      case 'battle_win':
        payload = {
          eventType: 'battle.finished',
          battleId: `battle-${unique}`,
          result: 'win',
          enemyTier: 1,
          streak: facts.battle_wins + 1,
        };
        break;
      default:
        throw new Error(`알 수 없는 시연 이벤트: ${String(kind)}`);
    }

    const outcome = state.ingestEvent(
      domainEvent(eventId(`demo-${unique}`), state.clock.now(), payload),
    );
    state.persist();
    const bubble = bubbleMessage(outcome, state.catalog);
    host.broadcast('usage:aggregated', { activityMinuteAdded: false, bubble });
    return {
      activityMinuteAdded: false,
      sourceNotes: [],
      failures: [],
      bubble,
      newlyUnlocked: outcome.newlyUnlocked,
    };
  });

  handle('demo:usage', async (provider) => {
    const collector = demoCollector(state);
    const target = providerFromKey(provider);
    const model =
      target === 'claude_code'
        ? 'claude-opus-5'
        : target === 'codex'
          ? 'gpt-5.4-codex'
          : 'gemini-3-pro';
    collector.accumulate(
      target,
      state.today(),
      model,
      tokenCounts(120_000, 60_000, 90_000, 230_000),
    );
    const result = await state.aggregate();
    state.persist();
    return report(state, host, result);
  });

  handle('demo:fail-next-reward', () => {
    /*
     * 데모 전용 표면이다. 포트에 넣지 않은 이유: 실제 재화 구현이 "다음 지급을 실패시키는"
     * 기능을 가질 이유가 없다. 대역이 가진 기능일 때만 부른다.
     */
    const tokens: unknown = state.tokens;
    if (hasFailNextGrant(tokens)) tokens.failNextGrant();
  });

  handle('demo:break-source', async (provider) => {
    demoCollector(state).setError(providerFromKey(provider), new CollectError('execution_failed'));
    const result = await state.aggregate();
    state.persist();
    return report(state, host, result);
  });

  return handlers;
}
