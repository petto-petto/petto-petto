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
  tokenRewardLabel,
  type AchievementCatalog,
  type Category,
} from '../domain/achievement/catalog.ts';
import {
  claimableRewards,
  completionRatio,
  rewardsSettled,
  unlockedCount,
} from '../domain/achievement/engine.ts';
import { isUnlocked } from '../domain/achievement/progress.ts';
import { MYSTERY_BADGE, badgeFor, type BadgePixels } from './badges.ts';
import type { MetaState } from '../domain/state.ts';

/** 잠긴 히든 업적에 쓰는 마스크. 기획서 7.1이 지정한 문자열이다. */
export const MASK = '? ? ?';

export interface AchievementRow {
  id: string;
  category: string;
  categoryLabel: string;
  name: string;
  condition: string;
  progress: number;
  target: number;
  progressLabel: string;
  unlocked: boolean;
  /**
   * 달성한 시각. 로컬 시간 `YYYY-MM-DD HH:MM`. 달성하지 않았으면 `undefined`.
   *
   * 가려진 히든 업적은 달성 전이므로 언제나 `undefined` 다.
   */
  unlockedAtLabel: string | undefined;
  hidden: boolean;
  /** 가려진 줄인가. UI가 스타일을 다르게 줄 수 있게 알려 준다. */
  masked: boolean;
  /**
   * 줄 맨 앞에 그리는 배지. 가려진 줄은 자기 배지 대신 물음표다.
   *
   * 잠긴 업적도 자기 배지를 받는다. 달성 전에는 어둡게, 달성하면 색을 넣어 그리는 것은 화면의
   * 일이다.
   */
  badge: BadgePixels;
  rewards: RewardItem[];
  /**
   * 보상을 받을 수 있는가.
   *
   * - `locked` — 아직 달성하지 않았다. 가려진 히든 줄도 이것이다.
   * - `claimable` — 달성했고 받지 않은 보상이 있다. 화면이 `보상 받기` 버튼을 그린다.
   * - `claimed` — 모두 받았다.
   */
  rewardState: RewardState;
  /** 받기에 실패한 까닭. `claimable` 일 때만 있을 수 있다. */
  rewardError: string | undefined;
}

export type RewardState = 'locked' | 'claimable' | 'claimed';

/**
 * 보상 하나. 화면이 종류마다 다르게 그릴 수 있게 종류를 달아 보낸다.
 *
 * `label` 은 눈에 보이는 글자다. 종류는 아이콘이 말해 주므로 "토큰" · "칭호" 를 되풀이하지 않고
 * 값만 둔다. `description` 은 아이콘 없이도 뜻이 통하는 온전한 문구로, 툴팁과 스크린 리더가
 * 읽는다. 가려진 히든 줄은 종류조차 알려 주지 않는다(`masked`).
 */
export interface RewardItem {
  kind: 'token' | 'title' | 'trophy' | 'masked';
  label: string;
  description: string;
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
  /** 받지 않은 보상이 남은 업적 수. 필터와 무관하게 전체에서 센다. */
  claimableCount: number;
  /** 현재 적용된 카테고리 필터. `undefined`면 전체다. */
  filter: Category | undefined;
}

/** 받다가 실패한 보상이 있으면 그 까닭. 아직 누른 적이 없거나 모두 받았으면 `undefined`. */
function rewardFailure(state: MetaState, achievementId: string): string | undefined {
  for (const record of state.rewards.get(achievementId) ?? []) {
    if (record.status === 'pending' && record.lastError !== undefined) return record.lastError;
  }
  return undefined;
}

/** ISO 시각을 사용자의 로컬 시간 `YYYY-MM-DD HH:MM` 으로 바꾼다. */
function localTimeLabel(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
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

      let rewards: RewardItem[];
      if (masked) {
        rewards = [{ kind: 'masked', label: MASK, description: MASK }];
      } else {
        rewards = [];
        if (definition.token > 0) {
          rewards.push({
            kind: 'token',
            label: definition.token.toLocaleString('ko-KR'),
            description: tokenRewardLabel(definition.token),
          });
        }
        if (definition.title !== undefined) {
          rewards.push({
            kind: 'title',
            label: definition.title,
            description: `칭호 ${definition.title}`,
          });
        }
        if (definition.trophy === true) {
          rewards.push({ kind: 'trophy', label: '트로피', description: '트로피' });
        }
      }

      return {
        id: definition.id,
        category: definition.category,
        categoryLabel: categoryName(definition.category),
        name: masked ? MASK : definition.name,
        condition: masked ? MASK : definition.condition,
        progress: masked ? 0 : current,
        target: masked ? 0 : definition.target,
        progressLabel: masked
          ? MASK
          : unlocked
            ? '달성'
            : `${current.toLocaleString('ko-KR')} / ${definition.target.toLocaleString('ko-KR')}`,
        unlocked,
        unlockedAtLabel:
          entry?.unlockedAt === undefined ? undefined : localTimeLabel(entry.unlockedAt),
        hidden: definition.hidden === true,
        masked,
        badge: masked ? MYSTERY_BADGE : badgeFor(definition.id),
        rewards,
        rewardState: !unlocked
          ? 'locked'
          : rewardsSettled(state, definition.id)
            ? 'claimed'
            : 'claimable',
        rewardError: unlocked ? rewardFailure(state, definition.id) : undefined,
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
    claimableCount: claimableRewards(state).length,
    filter,
  };
}
