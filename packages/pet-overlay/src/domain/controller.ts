import {
  TOKENS_PER_XP,
  applyXp,
  evolve,
  requiredXp,
  type GrowthEvent,
  type GrowthPet,
} from './growth.ts';

export interface GrowthSnapshot {
  pet: GrowthPet;
  /** 지금까지 관측한 input + output 토큰. 캐시 토큰은 호출자가 제외한다. */
  tokenBank: number;
  /** tokenBank 중 XP로 이미 확정한 전체 단위 수. */
  creditedXpUnits: number;
}

export interface UsageInput {
  /** input_tokens + output_tokens만 전달한다. */
  tokens: number;
  /** 같은 이벤트는 한 번만 처리한다. 저장소가 보장하는 안정적인 식별자를 권장한다. */
  eventId?: string;
}

export interface GrowthView {
  pet: GrowthPet;
  /** 토큰 잔여분까지 XP 바에 반영한 0..1 진행도. */
  levelProgress: number;
  tokensUntilNextXp: number;
}

export interface GrowthResult {
  view: GrowthView;
  gainedXp: number;
  events: readonly GrowthEvent[];
}

export class GrowthController {
  #pet: GrowthPet;
  #tokenBank: number;
  #creditedXpUnits: number;
  readonly #seenEventIds = new Set<string>();

  constructor(pet: GrowthPet, snapshot?: GrowthSnapshot) {
    this.#pet = snapshot ? { ...snapshot.pet } : { ...pet };
    this.#tokenBank = Math.max(0, Math.floor(snapshot?.tokenBank ?? 0));
    this.#creditedXpUnits = Math.max(0, Math.floor(snapshot?.creditedXpUnits ?? 0));
  }

  snapshot(): GrowthSnapshot {
    return {
      pet: { ...this.#pet },
      tokenBank: this.#tokenBank,
      creditedXpUnits: this.#creditedXpUnits,
    };
  }

  view(): GrowthView {
    const remainder = this.#tokenBank % TOKENS_PER_XP;
    const fractionalXp = remainder / TOKENS_PER_XP;
    const progress =
      this.#pet.level >= 50
        ? 1
        : Math.min(1, (this.#pet.xpIntoLevel + fractionalXp) / requiredXp(this.#pet.level));
    return {
      pet: { ...this.#pet },
      levelProgress: progress,
      tokensUntilNextXp: TOKENS_PER_XP - remainder,
    };
  }

  applyUsage(input: UsageInput): GrowthResult {
    if (input.eventId !== undefined) {
      if (this.#seenEventIds.has(input.eventId)) return this.#result(0, []);
      this.#seenEventIds.add(input.eventId);
    }

    this.#tokenBank += Math.max(0, Math.floor(input.tokens));
    const totalUnits = Math.floor(this.#tokenBank / TOKENS_PER_XP);
    const gainedXp = totalUnits - this.#creditedXpUnits;
    this.#creditedXpUnits = totalUnits;
    if (gainedXp <= 0) return this.#result(0, []);

    const applied = applyXp(this.#pet, gainedXp);
    this.#pet = applied.pet;
    return this.#result(applied.gainedXp, applied.events);
  }

  addExternalXp(amount: number): GrowthResult {
    const applied = applyXp(this.#pet, amount);
    this.#pet = applied.pet;
    return this.#result(applied.gainedXp, applied.events);
  }

  evolve(): GrowthResult & { evolved: boolean } {
    const result = evolve(this.#pet);
    this.#pet = result.pet;
    return { ...this.#result(0, result.events), evolved: result.evolved };
  }

  #result(gainedXp: number, events: readonly GrowthEvent[]): GrowthResult {
    return { view: this.view(), gainedXp, events };
  }
}
