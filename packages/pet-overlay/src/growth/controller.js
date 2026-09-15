// 성장 컨트롤러 — 세션 계산 + XP 지급
// 기획: 성장시스템.md §2~§3
import { createPet, computeXpGain, applyXp, evolve } from './engine.js';
import {
  SESSION_IDLE_TIMEOUT_SEC,
  TOKENS_PER_XP,
  SESSION_STEP_MIN,
  SESSION_STEP_BONUS,
  SESSION_BONUS_MAX,
} from './constants.js';

export class GrowthController {
  constructor(pet = createPet(), init = null) {
    this.pet = pet;
    this.sessionStartAt = null;
    this.lastEventAt = null;
    this.seen = new Set(); // eventId 중복 제거
    // 실시간(applyNow)용 토큰 누적 (저장에서 복원 가능)
    this.tokenBank = init?.tokenBank ?? 0; // 누적 raw 토큰
    this.lastBaseXp = init?.lastBaseXp ?? 0; // 지금까지 지급한 토큰XP 총량
    // 배치(ingest/flush)용
    this.pending = 0;
  }

  // 저장용 스냅샷 (세션 타이머/중복셋/pending 은 휘발 — 저장 안 함)
  snapshot() {
    return { pet: { ...this.pet }, tokenBank: this.tokenBank, lastBaseXp: this.lastBaseXp };
  }

  _touchSession(now) {
    if (this.sessionStartAt == null || now - this.lastEventAt > SESSION_IDLE_TIMEOUT_SEC * 1000) {
      this.sessionStartAt = now;
    }
    this.lastEventAt = now;
  }

  sessionSeconds(now) {
    if (this.sessionStartAt == null) return 0;
    return Math.floor((now - this.sessionStartAt) / 1000);
  }

  _sessionCoef(now) {
    const steps = Math.floor(Math.floor(this.sessionSeconds(now) / 60) / SESSION_STEP_MIN);
    return 1 + Math.min(steps * SESSION_STEP_BONUS, SESSION_BONUS_MAX);
  }

  _toNext() {
    return TOKENS_PER_XP - (this.tokenBank % TOKENS_PER_XP);
  }

  // 실시간: 이벤트 즉시 처리. 토큰을 누적하다 5,000 경계를 넘으면 그 순간 XP 지급.
  applyNow({ tokens, timestamp, eventId } = {}) {
    const now = timestamp != null ? timestamp : Date.now();
    if (eventId != null) {
      if (this.seen.has(eventId))
        return {
          tokens: 0,
          gained: 0,
          leveledUp: false,
          events: [],
          pet: this.pet,
          toNext: this._toNext(),
        };
      this.seen.add(eventId);
    }
    this._touchSession(now);
    this.tokenBank += Math.max(0, tokens || 0);

    const newBase = Math.floor(this.tokenBank / TOKENS_PER_XP);
    const deltaBase = newBase - this.lastBaseXp;
    this.lastBaseXp = newBase;
    const toNext = this._toNext();

    if (deltaBase <= 0)
      return { tokens, gained: 0, leveledUp: false, events: [], pet: this.pet, toNext };

    const gain = Math.floor(deltaBase * this._sessionCoef(now));
    const res = applyXp(this.pet, gain);
    this.pet = res.pet;
    return {
      tokens,
      gained: gain,
      leveledUp: res.leveledUp,
      events: res.events,
      pet: res.pet,
      toNext,
    };
  }

  // (배치 모드 — 테스트/대안용) usage 누적
  ingest({ tokens, timestamp, eventId } = {}) {
    const now = timestamp != null ? timestamp : Date.now();
    if (eventId != null) {
      if (this.seen.has(eventId)) return false;
      this.seen.add(eventId);
    }
    this._touchSession(now);
    this.pending += Math.max(0, tokens || 0);
    return true;
  }

  flush(now = Date.now()) {
    const tokens = this.pending;
    this.pending = 0;
    if (tokens <= 0) return null;
    const gain = computeXpGain(tokens, this.sessionSeconds(now));
    const res = applyXp(this.pet, gain);
    this.pet = res.pet;
    return { tokens, ...res };
  }

  // 전투·업적 등 외부 XP (즉시 지급)
  addExternalXp(amount, source = 'battle') {
    const res = applyXp(this.pet, amount);
    this.pet = res.pet;
    return { source, ...res };
  }

  doEvolve() {
    const res = evolve(this.pet);
    this.pet = res.pet;
    return res;
  }
}
