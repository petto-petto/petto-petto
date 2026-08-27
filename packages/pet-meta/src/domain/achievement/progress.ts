/**
 * 업적 진행·해제 상태와 보상 기록.
 *
 * 기획서 7.5의 핵심 결정: **해제 상태와 보상 완료 상태를 분리한다.** 코인 지급이
 * 실패했다고 업적을 다시 잠그면 사용자는 달성했던 업적이 사라지는 것을 본다. 대신
 * 해제는 그대로 두고 보상만 미완료로 남겨 재시도한다.
 */

/** 기획서 10장의 `achievement_progress`. */
export interface AchievementProgress {
  achievementId: string;
  /** `min(현재 사실, 목표)`. 기획서 7.1에 따라 감소하지 않는다. */
  progress: number;
  /** ISO 8601. 해제되지 않았으면 `undefined`. */
  unlockedAt: string | undefined;
}

export function createProgress(achievementId: string): AchievementProgress {
  return { achievementId, progress: 0, unlockedAt: undefined };
}

export const isUnlocked = (entry: AchievementProgress): boolean => entry.unlockedAt !== undefined;

/** 진행률을 올린다. 낮은 값이 들어와도 내려가지 않는다. */
export function raiseProgress(entry: AchievementProgress, value: number): void {
  entry.progress = Math.max(entry.progress, value);
}

/** 보상 종류. 기획서 7.2는 코인·칭호·트로피 셋을 정의한다. */
export type RewardKind = 'coin' | 'title' | 'trophy';

const REWARD_NAMES: Record<RewardKind, string> = {
  coin: '코인',
  title: '칭호',
  trophy: '트로피',
};

export const rewardKindName = (kind: RewardKind): string => REWARD_NAMES[kind];

/** 보상 처리 상태. `pending`은 재시도 대상이다. */
export type RewardStatus = 'pending' | 'done';

/** 기획서 10장의 `achievement_reward`. */
export interface RewardRecord {
  achievementId: string;
  /** 멱등 키. 코인은 `achievement:<id>`다(기획서 9.5). */
  rewardKey: string;
  kind: RewardKind;
  status: RewardStatus;
  attempts: number;
  /** 사용자에게 보여줄 짧은 실패 원인. */
  lastError: string | undefined;
  /** 지급 결과 설명. 예: 트로피가 룸에 놓였는지 보관함에 갔는지. */
  detail: string | undefined;
}

export function createRewardRecord(
  achievementId: string,
  rewardKey: string,
  kind: RewardKind,
): RewardRecord {
  return {
    achievementId,
    rewardKey,
    kind,
    status: 'pending',
    attempts: 0,
    lastError: undefined,
    detail: undefined,
  };
}

export function markRewardDone(record: RewardRecord, detail: string | undefined): void {
  record.status = 'done';
  record.lastError = undefined;
  record.detail = detail;
  record.attempts += 1;
}

export function markRewardFailed(record: RewardRecord, error: string): void {
  record.status = 'pending';
  record.lastError = error;
  record.attempts += 1;
}

export const isRewardPending = (record: RewardRecord): boolean => record.status === 'pending';
