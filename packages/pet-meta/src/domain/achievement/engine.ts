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

import type { CollectionPort, CurrencyPort } from '../../ports/index.ts';
import { factSnapshot, type MetaState } from '../state.ts';
import { grantTitle } from '../profile/index.ts';
import { autoPlacesTrophy, coinRewardKey, type AchievementCatalog } from './catalog.ts';
import { factValue } from './facts.ts';
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
  /** 보상이 아직 완료되지 않은 업적 ID(중복 없음). */
  pendingRewards: string[];
}

/**
 * 기획서 6.3·ACH-007: 한 묶음에서 두 개 이상 달성하면 집계 말풍선 한 번만 표시한다.
 */
export function bubbleMessage(
  outcome: EvaluationOutcome,
  catalog: AchievementCatalog,
): string | undefined {
  if (outcome.newlyUnlocked.length === 0) return undefined;
  if (outcome.newlyUnlocked.length > 1) {
    return `${outcome.newlyUnlocked.length}개 업적을 달성했어!`;
  }

  const id = outcome.newlyUnlocked[0];
  const definition = id === undefined ? undefined : catalog.get(id);
  if (!definition) return undefined;

  const reward =
    definition.coin > 0
      ? `코인 ${definition.coin}`
      : definition.title
        ? `칭호 ${definition.title}`
        : '트로피';
  return `${definition.name} 달성! ${reward}`;
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
  currency: CurrencyPort,
  collection: CollectionPort,
  clock: Clock,
): EvaluationOutcome {
  const now = clock.now().toISOString();
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

    // 기획서 7.5: 해제와 보상을 분리한다. 여기서는 지급해야 할 목록만 만들고 실제
    // 지급은 아래 정산 단계에서 한다. 지급이 실패해도 해제는 남는다.
    const records = [];
    if (definition.coin > 0) {
      records.push(createRewardRecord(definition.id, coinRewardKey(definition), 'coin'));
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

  const pendingRewards = settleRewards(state, catalog, currency, collection);
  return { newlyUnlocked, pendingRewards };
}

/**
 * 미완료 보상을 지급한다. 실패한 항목은 미완료로 남아 다음 호출에서 재시도된다(ACH-009).
 *
 * 따로 부를 수 있게 공개한 이유: 보상 실패는 판정과 무관하게 재시도돼야 한다.
 */
export function settleRewards(
  state: MetaState,
  catalog: AchievementCatalog,
  currency: CurrencyPort,
  collection: CollectionPort,
): string[] {
  const pending: string[] = [];

  for (const [achievementId, records] of state.rewards) {
    const definition = catalog.get(achievementId);
    // 정의가 사라진 업적의 보상은 건드리지 않는다. ID는 릴리스 사이에 유지되므로
    // 정상 경로에서는 일어나지 않는다.
    if (!definition) continue;

    for (const record of records) {
      if (!isRewardPending(record)) continue;

      try {
        switch (record.kind) {
          case 'coin': {
            const outcome = currency.grantOnce(record.rewardKey, definition.coin, definition.name);
            markRewardDone(
              record,
              outcome.kind === 'granted' ? `코인 ${outcome.amount}` : '이미 지급됨',
            );
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
      } catch (error) {
        markRewardFailed(record, error instanceof Error ? error.message : String(error));
      }

      if (isRewardPending(record) && !pending.includes(achievementId)) {
        pending.push(achievementId);
      }
    }
  }

  return pending;
}

/** 기획서 7.5: 사용자에게 "지급 완료"로 표시할 수 있는 시점인가. */
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
