// 성장 시스템 기준값 (기획: 성장시스템.md §2)
export const TOKENS_PER_XP = 5000;        // 토큰 5,000 = XP 1
export const SESSION_STEP_MIN = 30;       // 세션 보너스 1스텝 = 30분
export const SESSION_STEP_BONUS = 0.05;   // 스텝당 +5%
export const SESSION_BONUS_MAX = 0.30;    // 세션 보너스 상한 +30%
export const SESSION_IDLE_TIMEOUT_SEC = 1800; // 30분 무사용 시 세션 종료

// 배치 윈도우(tumbling): 이 단위로 XP 1회 지급/토스트.
// 기획 기준값은 5000ms이나, 프로토타입 체감 반영을 위해 1000ms로 단축(설정으로 분리).
export const BATCH_WINDOW_MS = 1000;

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 50;
export const EVOLUTION_LEVELS = [15, 35];
