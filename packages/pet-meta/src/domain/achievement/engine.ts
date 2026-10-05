/**
 * 업적 판정 엔진. 기획서 7장·9장의 판정과 보상 규칙이 여기 있다.
 *
 * ## 판정 코드에 업적별 분기가 없다
 *
 * 모든 업적이 `(사실, 목표)` 한 가지 모양이므로, 판정은 22개 정의를 순회하며
 * `현재 사실 >= 목표`를 보는 것으로 끝난다. "첫 펫 획득"과 "전투 500승"이 같은 코드
 * 경로를 지난다.
 *
 * 그래서 **소급 판정(ACH-004)이 별도 기능이 아니다.** 새 정의를 추가하고 같은 함수를
 * 다시 부르면 그게 소급 판정이다. 과거 이벤트를 다시 재생할 필요가 없다.
 */

import type { Clock } from '@pet/core';

import type { CollectionPort, GrowthRules, PetClient, TokenPort } from '../../ports/index.ts';
import { factSnapshot, type MetaState } from '../state.ts';
import { grantTitle } from '../profile/index.ts';
import {
  autoPlacesTrophy,
  tokenRewardKey,
  tokenRewardLabel,
  type AchievementCatalog,
} from './catalog.ts';
import { factValue, tryObserveEarnedTokens, tryObservePets } from './facts.ts';
import {
  createProgress,
  createRewardRecord,
  isRewardPending,
  isUnlocked,
  markRewardDone,
  markRewardFailed,
  raiseProgress,
} from './progress.ts';

export interface EvaluationOutcome {
  /** 이번 판정에서 새로 해제된 업적 ID. */
  newlyUnlocked: string[];
  /** 달성했지만 아직 보상을 받지 않은 업적 ID(중복 없음). */
  claimableRewards: string[];
}

/**
 * 기획서 6.3·ACH-007: 한 묶음에서 두 개 이상 달성하면 집계 말풍선 한 번만 표시한다.
 *
 * 보상은 사용자가 업적 칸에서 직접 받는다. 그래서 말풍선은 무엇을 받았는지가 아니라 받으러
 * 오라고 말한다.
 */
export function bubbleMessage(
  outcome: EvaluationOutcome,
  catalog: AchievementCatalog,
): string | undefined {
  if (outcome.newlyUnlocked.length === 0) return undefined;
  if (outcome.newlyUnlocked.length > 1) {
    return `${outcome.newlyUnlocked.length}개 업적을 달성했어! 보상을 받아 가!`;
  }

  const id = outcome.newlyUnlocked[0];
  const definition = id === undefined ? undefined : catalog.get(id);
  if (!definition) return undefined;
  return `${definition.name} 달성! 보상을 받아 가!`;
}

/**
 * 현재 사실로 전체 업적을 판정한다.
 *
 * 매번 22개를 모두 훑는다. 22개는 훑어도 공짜이고, "이벤트 종류에 따라 관련 업적만 검사"
 * 하는 최적화는 새 업적을 추가할 때 매핑을 빠뜨리는 버그를 만든다.
 */
export function evaluate(
  state: MetaState,
  catalog: AchievementCatalog,
  tokens: Pick<TokenPort, 'earnedSince'>,
  pets: PetClient,
  rules: GrowthRules,
  clock: Clock,
): EvaluationOutcome {
  const now = clock.now().toISOString();
  // 판정마다 현재 보유를 한 번 관측한다. 이벤트가 없어졌으니 펫 사실을 올릴 곳이 여기뿐이다.
  // 읽지 못하면 사실을 그대로 두고 나머지 판정을 계속한다(INFO-007).
  tryObservePets(state.eventFacts, pets, rules);
  // 누적 토큰도 같은 식으로 관측한다. 달성한 업적의 보상은 사용자가 받기 전까지 원장에 없으므로
  // 받은 뒤의 판정부터 누적에 들어간다.
  tryObserveEarnedTokens(state.eventFacts, tokens);
  const facts = factSnapshot(state);
  const newlyUnlocked: string[] = [];

  for (const definition of catalog.definitions) {
    const value = factValue(facts, definition.fact);
    const entry = state.progress.get(definition.id) ?? createProgress(definition.id);
    state.progress.set(definition.id, entry);

    // 기획서 7.1: 진행률은 감소하지 않는다.
    raiseProgress(entry, Math.min(value, definition.target));

    if (isUnlocked(entry) || value < definition.target) continue;

    entry.unlockedAt = now;
    newlyUnlocked.push(definition.id);

    // 기획서 7.5: 해제와 보상을 분리한다. 여기서는 받을 보상의 목록만 만든다. 지급은 사용자가
    // 업적 칸에서 `보상 받기` 를 누를 때 한다(`claimRewards`). 판정은 아무것도 지급하지 않는다.
    const records = [];
    if (definition.token > 0) {
      records.push(createRewardRecord(definition.id, tokenRewardKey(definition), 'token'));
    }
    if (definition.title !== undefined) {
      records.push(
        createRewardRecord(definition.id, `achievement-title:${definition.id}`, 'title'),
      );
    }
    if (definition.trophy === true) {
      records.push(
        createRewardRecord(definition.id, `achievement-trophy:${definition.id}`, 'trophy'),
      );
    }
    if (records.length > 0) state.rewards.set(definition.id, records);
  }

  return { newlyUnlocked, claimableRewards: claimableRewards(state) };
}

/** 달성했지만 아직 받지 않은 보상이 남은 업적 ID. */
export function claimableRewards(state: MetaState): string[] {
  const claimable: string[] = [];
  for (const [achievementId, records] of state.rewards) {
    if (records.some(isRewardPending)) claimable.push(achievementId);
  }
  return claimable;
}

/** 보상 받기의 결과. */
export interface ClaimOutcome {
  /** 이 업적의 보상을 모두 받았는가. 이미 받은 업적을 다시 눌러도 참이다. */
  claimed: boolean;
  /** 받지 못한 까닭. 사용자에게 그대로 보여 준다. */
  error: string | undefined;
}

/**
 * 달성한 업적 하나의 보상을 지급한다. 사용자가 업적 칸의 `보상 받기` 를 눌렀을 때 부른다.
 *
 * 보상 종류마다 따로 지급하고 따로 기록한다. 토큰 지급이 실패해도 칭호는 받고, 실패한 것만
 * 받을 보상으로 남아 다시 누르면 **같은 멱등 키**로 지급된다(ACH-009). 그래서 몇 번을 눌러도
 * 한 번만 들어온다.
 *
 * 달성하지 않은 업적과 정의가 없는 업적은 거절한다. 렌더러가 보낸 id 를 믿지 않는다.
 */
export function claimRewards(
  state: MetaState,
  catalog: AchievementCatalog,
  tokens: Pick<TokenPort, 'grantOnce'>,
  collection: CollectionPort,
  achievementId: string,
): ClaimOutcome {
  const definition = catalog.get(achievementId);
  if (!definition) return { claimed: false, error: '알 수 없는 업적이에요' };
  const entry = state.progress.get(achievementId);
  if (entry === undefined || !isUnlocked(entry)) {
    return { claimed: false, error: '아직 달성하지 않은 업적이에요' };
  }

  let error: string | undefined;
  for (const record of state.rewards.get(achievementId) ?? []) {
    if (!isRewardPending(record)) continue;

    try {
      switch (record.kind) {
        case 'token': {
          const granted = tokens.grantOnce(record.rewardKey, definition.token, definition.name);
          markRewardDone(record, granted ? tokenRewardLabel(definition.token) : '이미 지급됨');
          break;
        }
        case 'title': {
          // 칭호는 meta가 소유하는 상태라 외부 실패가 없다.
          if (definition.title !== undefined) {
            grantTitle(state.profile, definition.title);
            markRewardDone(record, definition.title);
          } else {
            markRewardDone(record, undefined);
          }
          break;
        }
        case 'trophy': {
          // 기획서 7.4: 자동 배치 실패가 트로피 지급 실패로 이어져서는 안 된다.
          // 그래서 배치 위치는 결과값이고, 실패는 포트 오류일 때만이다.
          const placement = collection.grantTrophy(achievementId, autoPlacesTrophy(definition));
          markRewardDone(record, placement === 'room' ? '룸에 배치' : '보관함에 지급');
          break;
        }
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      markRewardFailed(record, message);
      error ??= message;
    }
  }

  return { claimed: rewardsSettled(state, achievementId), error };
}

/** 이 업적의 보상을 모두 받았는가. 받을 보상이 애초에 없는 업적도 참이다. */
export function rewardsSettled(state: MetaState, achievementId: string): boolean {
  const records = state.rewards.get(achievementId);
  if (!records) return true;
  return records.every((record) => !isRewardPending(record));
}

/** 해제한 업적 수. */
export function unlockedCount(state: MetaState): number {
  let count = 0;
  for (const entry of state.progress.values()) {
    if (isUnlocked(entry)) count += 1;
  }
  return count;
}

/** 완료율. 기획서 7.1: 분모는 히든을 포함한 전체 업적 수다. */
export function completionRatio(state: MetaState, catalog: AchievementCatalog): number {
  if (catalog.size === 0) return 0;
  return unlockedCount(state) / catalog.size;
}
