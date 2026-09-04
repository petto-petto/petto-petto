export interface CombineAnimationLock {
  tryStart(): boolean;
  finish(): void;
}

/** 렌더러가 합성 연출 중 중복 차감을 요청하지 않도록 막는 작은 상태 잠금. */
export function createCombineAnimationLock(): CombineAnimationLock {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}
