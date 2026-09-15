// 성장 엔진 — 프레임워크 비의존, node/브라우저 공용
// 기획: 성장시스템.md (XP 환산, 레벨 곡선, 순차 진화)
import {
  TOKENS_PER_XP,
  SESSION_STEP_MIN,
  SESSION_STEP_BONUS,
  SESSION_BONUS_MAX,
  LEVEL_MIN,
  LEVEL_MAX,
  EVOLUTION_LEVELS,
} from './constants.js';

// 레벨 k -> k+1 에 필요한 XP (완만한 곡선)
export function requiredXp(level) {
  return 10 + Math.floor(level / 2);
}

// 다음 진화에 필요한 레벨 (없으면 null). 진화는 순차: stage 0 -> Lv.15, stage 1 -> Lv.35
export function nextEvolutionLevel(stage) {
  return stage < EVOLUTION_LEVELS.length ? EVOLUTION_LEVELS[stage] : null;
}
export function isEvolutionAvailable(pet) {
  const nl = nextEvolutionLevel(pet.evolutionStage);
  return nl != null && pet.level >= nl;
}

export function createPet(id = 'pet-001', name = 'MOCHI') {
  return {
    id,
    name,
    level: LEVEL_MIN,
    xpIntoLevel: 0,
    totalXp: 0,
    evolutionStage: 0,
    evolutionAvailable: false,
  };
}

// 획득 XP = floor(토큰XP × 세션계수)
export function computeXpGain(tokens, sessionSeconds) {
  const tokenXp = Math.floor((tokens || 0) / TOKENS_PER_XP);
  const steps = Math.floor(Math.floor((sessionSeconds || 0) / 60) / SESSION_STEP_MIN);
  const sessionCoef = 1 + Math.min(steps * SESSION_STEP_BONUS, SESSION_BONUS_MAX);
  return Math.floor(tokenXp * sessionCoef);
}

// pet 에 gain XP 적용 (불변 스타일). 이벤트 목록도 반환.
export function applyXp(pet, gain) {
  const events = [];
  if (!gain || gain <= 0) return { pet, gained: 0, leveledUp: false, events };

  const p = { ...pet };
  const availBefore = isEvolutionAvailable(p);
  p.totalXp += gain;
  let leveledUp = false;

  if (p.level < LEVEL_MAX) {
    p.xpIntoLevel += gain;
    while (p.level < LEVEL_MAX) {
      const req = requiredXp(p.level);
      if (p.xpIntoLevel >= req) {
        p.xpIntoLevel -= req;
        p.level += 1;
        leveledUp = true;
      } else break;
    }
    if (p.level >= LEVEL_MAX) p.xpIntoLevel = 0; // 만렙: 레벨 내 XP 고정
  }

  p.evolutionAvailable = isEvolutionAvailable(p);

  events.unshift({ type: 'xp', amount: gain, level: p.level });
  if (leveledUp) events.push({ type: 'levelup', level: p.level, isMax: p.level >= LEVEL_MAX });
  // 순차 진화: 한 번의 지급으로는 현재 stage 문턱 1개만 새로 열린다
  if (!availBefore && p.evolutionAvailable) {
    events.push({ type: 'evolution-available', level: nextEvolutionLevel(pet.evolutionStage) });
  }
  return { pet: p, gained: gain, leveledUp, events };
}

// 사용자가 진화 실행 (기획: 자동 아님). 다음 문턱이 이미 충족이면 계속 available.
export function evolve(pet) {
  if (!isEvolutionAvailable(pet)) return { pet, evolved: false };
  const p = { ...pet, evolutionStage: pet.evolutionStage + 1 };
  p.evolutionAvailable = isEvolutionAvailable(p);
  return { pet: p, evolved: true };
}
