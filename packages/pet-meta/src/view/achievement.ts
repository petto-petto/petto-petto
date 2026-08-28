/**
 * 업적 화면의 표시 모델.
 *
 * 히든 마스킹을 화면(렌더러)이 아니라 여기서 하는 이유: 마스킹을 UI에 맡기면 **잠긴 히든
 * 업적의 이름과 조건이 IPC 응답에 그대로 실려 나간다.** 개발자 도구를 열면 보인다.
 * 기획서 ACH-002가 요구하는 것은 "화면에 안 보이는 것"이 아니라 "공개하지 않는 것"이므로,
 * 가려야 할 값은 애초에 경계를 넘지 않게 한다.
 */

import {
  categoryName,
  tierName,
  type AchievementCatalog,
  type Category,
} from '../domain/achievement/catalog.ts';
import { completionRatio, rewardsSettled, unlockedCount } from '../domain/achievement/engine.ts';
import { isUnlocked } from '../domain/achievement/progress.ts';
import type { MetaState } from '../domain/state.ts';

/** 잠긴 히든 업적에 쓰는 마스크. 기획서 7.1이 지정한 문자열이다. */
export const MASK = '? ? ?';

export interface AchievementRow {
  id: string;
  category: string;
  categoryLabel: string;
  name: string;
  condition: string;
  tier: string | undefined;
  progress: number;
  target: number;
  progressLabel: string;
  unlocked: boolean;
  hidden: boolean;
  /** 가려진 줄인가. UI가 스타일을 다르게 줄 수 있게 알려 준다. */
  masked: boolean;
  rewards: string[];
  /** 기획서 7.5: 보상이 아직 완료되지 않았다. */
  rewardPending: boolean;
}

export interface TitleRow {
  name: string;
  equipped: boolean;
}

export interface AchievementScreen {
  rows: AchievementRow[];
  unlocked: number;
  total: number;
  completionPercent: number;
  titles: TitleRow[];
  equippedTitle: string | undefined;
  /** 현재 적용된 카테고리 필터. `undefined`면 전체다. */
  filter: Category | undefined;
}

/**
 * 업적 화면 모델을 만든다.
 *
 * `filter`가 `undefined`면 전체를 보여준다. 기획서 4.2: 필터는 현재 실행 중에만 기억하고
 * 앱을 다시 시작하면 `전체`로 돌아가므로, 저장 상태가 아니라 인자로 받는다.
 */
export function achievementScreen(
  state: MetaState,
  catalog: AchievementCatalog,
  filter: Category | undefined,
): AchievementScreen {
  const rows: AchievementRow[] = catalog.definitions
    .filter((definition) => filter === undefined || definition.category === filter)
    .map((definition) => {
      const entry = state.progress.get(definition.id);
      const unlocked = entry !== undefined && isUnlocked(entry);
      const current = entry?.progress ?? 0;

      // 히든이면서 아직 잠겼을 때만 가린다. 달성한 히든은 실제 값을 공개한다.
      const masked = definition.hidden === true && !unlocked;

      let rewards: string[];
      if (masked) {
        rewards = [MASK];
      } else {
        rewards = [];
        if (definition.coin > 0) rewards.push(`코인 ${definition.coin}`);
        if (definition.title !== undefined) rewards.push(`칭호 ${definition.title}`);
        if (definition.trophy === true) rewards.push('트로피');
      }

      return {
        id: definition.id,
        category: definition.category,
        categoryLabel: categoryName(definition.category),
        name: masked ? MASK : definition.name,
        condition: masked ? MASK : definition.condition,
        tier: masked || definition.tier === undefined ? undefined : tierName(definition.tier),
        progress: masked ? 0 : current,
        target: masked ? 0 : definition.target,
        progressLabel: masked ? MASK : unlocked ? '달성' : `${current} / ${definition.target}`,
        unlocked,
        hidden: definition.hidden === true,
        masked,
        rewards,
        rewardPending: unlocked && !rewardsSettled(state, definition.id),
      };
    });

  return {
    rows,
    unlocked: unlockedCount(state),
    total: catalog.size,
    completionPercent: Math.round(completionRatio(state, catalog) * 100),
    titles: state.profile.ownedTitles.map((title) => ({
      name: title,
      equipped: state.profile.equippedTitle === title,
    })),
    equippedTitle: state.profile.equippedTitle,
    filter,
  };
}
