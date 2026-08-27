/**
 * 렌더러가 부르는 IPC 핸들러. Spring MVC의 `@RestController`에 해당한다.
 *
 * 이 파일에는 규칙이 없다. 전부 `@pet/meta`의 함수를 부르고 결과를 그대로 돌려준다.
 * 규칙이 여기 들어오기 시작하면 창을 띄우지 않고는 테스트할 수 없게 되므로,
 * "얇게 유지한다"가 이 계층의 유일한 규칙이다.
 */

import { ipcMain, shell } from 'electron';

import {
  PROVIDERS,
  domainEvent,
  eventId,
  isProvider,
  petId,
  type EventPayload,
  type Provider,
} from '@pet/core';
import {
  CollectError,
  achievementScreen,
  bubbleMessage,
  equipTitle,
  factSnapshot,
  generateTrainerName,
  isCategory,
  isPeriod,
  isPetSize,
  performanceScreen,
  renameTrainer,
  setSourceEnabled,
  settingsScreen,
  summaryScreen,
  tokenCounts,
  usageScreen,
  type AggregationRun,
  type EvaluationOutcome,
} from '@pet/meta';

import type { AppState } from './composition.ts';
import {
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  hidePanel,
  showPanel,
} from './windows.ts';

/** 집계·판정 후 렌더러에 알릴 내용. */
export interface TickReport {
  activityMinuteAdded: boolean;
  /** 소스별 결과를 사람이 읽을 수 있는 짧은 문장으로. */
  sourceNotes: string[];
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
        detail = '기준점을 잡았어요 (설치 전 기록은 제외)';
        break;
      case 'applied':
        detail = `관측 토큰 +${outcome.result.observedDelta}`;
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

function report(state: AppState, run: AggregationRun, outcome: EvaluationOutcome): TickReport {
  // 기획서 6.3 / ACH-008: 오버레이가 숨겨졌거나 알림이 꺼져 있으면 말풍선을 표시하지
  // 않는다. 판정과 보상은 이미 끝났으므로 여기서 억제하는 것은 표시뿐이다.
  const allowed = state.meta.settings.notifyAchievement && state.meta.settings.overlayVisible;
  const bubble = allowed ? bubbleMessage(outcome, state.catalog) : undefined;

  const tick: TickReport = {
    activityMinuteAdded: run.activityMinuteAdded,
    sourceNotes: describe(run),
    bubble,
    newlyUnlocked: outcome.newlyUnlocked,
  };

  // 말풍선은 펫 창이 그린다. 패널이 아니라 펫이 알림 표면이기 때문이다(기획서 6.3).
  broadcast('usage:aggregated', { activityMinuteAdded: tick.activityMinuteAdded, bubble });
  return tick;
}

/** 모든 IPC 핸들러를 등록한다. */
export function registerHandlers(state: AppState): void {
  const handle = (channel: string, listener: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => listener(...args));
  };

  /* ---------- 조회 ---------- */

  handle('info:summary', () =>
    summaryScreen(state.meta, state.catalog, state.today(), state.collection, state.currency),
  );

  handle('info:usage', (period) =>
    usageScreen(
      state.meta,
      state.today(),
      typeof period === 'string' && isPeriod(period) ? period : 'all',
    ),
  );

  handle('info:performance', () =>
    performanceScreen(state.gacha, state.battle, state.growth, state.currency),
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

  handle('collect:toggle', (provider, enabled) => {
    setSourceEnabled(state.meta, state.clock, providerFromKey(provider), enabled === true);
    const { run, outcome } = state.aggregate();
    state.persist();
    return report(state, run, outcome);
  });

  handle('collect:rescan', (provider) => {
    const { run, outcome } = state.rescan(providerFromKey(provider));
    state.persist();
    return report(state, run, outcome);
  });

  handle('collect:now', () => {
    const { run, outcome } = state.aggregate();
    state.persist();
    return report(state, run, outcome);
  });

  /* ---------- 설정 ---------- */

  handle('settings:display', (key, value) => {
    switch (key) {
      case 'overlay_visible': {
        state.meta.settings.overlayVisible = value === true;
        applyOverlayVisibility(state.meta.settings.overlayVisible);
        break;
      }
      case 'pet_size': {
        if (typeof value !== 'string' || !isPetSize(value)) throw new Error('알 수 없는 펫 크기');
        state.meta.settings.petSize = value;
        applyPetSize(value);
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

  handle('profile:rename', (name) => {
    renameTrainer(state.meta.profile, String(name));
    state.persist();
    return state.meta.profile.displayName;
  });

  handle('profile:regenerate', () => {
    state.meta.profile.displayName = generateTrainerName(Date.now() % 2_147_483_647);
    state.persist();
    return state.meta.profile.displayName;
  });

  handle('profile:equip-title', (title) => {
    const equipped = equipTitle(state.meta.profile, typeof title === 'string' ? title : undefined);
    if (!equipped) throw new Error('보유하지 않은 칭호입니다');
    state.persist();
  });

  /* ---------- 창 ---------- */

  handle('panel:open', (screenName) => {
    state.panelScreen = typeof screenName === 'string' ? screenName : 'info';
    showPanel();
    // 기획서 4.2: 정보와 설정은 패널을 다시 열 때 기본 서브탭으로 진입한다.
    broadcast('panel:show', state.panelScreen);
  });

  handle('panel:close', () => hidePanel());
  handle('panel:current', () => state.panelScreen);

  handle('shell:open-external', async (url) => {
    // 후원 주소와 저장소 링크만 외부 브라우저로 연다.
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('https 주소만 열 수 있습니다');
    }
    await shell.openExternal(url);
  });

  handle('shell:reveal-data', () => {
    shell.showItemInFolder(state.dataLocation);
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
      case 'pet_common':
        payload = {
          eventType: 'pet.acquired',
          petId: petId(`pet-${unique}`),
          rarity: 'COMMON',
          source: 'gacha',
        };
        break;
      case 'pet_epic':
        payload = {
          eventType: 'pet.acquired',
          petId: petId(`pet-${unique}`),
          rarity: 'EPIC',
          source: 'gacha',
        };
        break;
      case 'fusion_miracle':
        payload = {
          eventType: 'fusion.completed',
          fusionId: `fusion-${unique}`,
          parentRarities: ['COMMON', 'COMMON'],
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
      case 'levelup': {
        const level = Math.max(facts.max_pet_level, 1);
        payload = {
          eventType: 'pet.levelup',
          petId: petId('pet-001'),
          previousLevel: level,
          level: level + 1,
          maxLevel: 50,
        };
        break;
      }
      case 'dex_complete':
        payload = { eventType: 'dex.updated', ownedSpecies: 24, totalSpecies: 24 };
        break;
      default:
        throw new Error(`알 수 없는 시연 이벤트: ${String(kind)}`);
    }

    const outcome = state.ingestEvent(
      domainEvent(eventId(`demo-${unique}`), state.clock.now(), payload),
    );
    state.persist();
    const bubble = bubbleMessage(outcome, state.catalog);
    broadcast('usage:aggregated', { activityMinuteAdded: false, bubble });
    return {
      activityMinuteAdded: false,
      sourceNotes: [],
      bubble,
      newlyUnlocked: outcome.newlyUnlocked,
    };
  });

  handle('demo:usage', (provider) => {
    const target = providerFromKey(provider);
    const model =
      target === 'claude_code'
        ? 'claude-opus-5'
        : target === 'codex'
          ? 'gpt-5.4-codex'
          : 'gemini-3-pro';
    state.collector.accumulate(
      target,
      state.today(),
      model,
      tokenCounts(120_000, 60_000, 90_000, 230_000),
    );
    const { run, outcome } = state.aggregate();
    state.persist();
    return report(state, run, outcome);
  });

  handle('demo:fail-next-reward', () => state.currency.failNextGrant());

  handle('demo:break-source', (provider) => {
    state.collector.setError(providerFromKey(provider), new CollectError('execution_failed'));
    const { run, outcome } = state.aggregate();
    state.persist();
    return report(state, run, outcome);
  });
}
