interface HpBarInput {
  key: string | null;
  resetKey: string;
  ratio: number;
  nowMs: number;
  reducedMotion: boolean;
  running: boolean;
}

export interface HpBarFrame {
  fillRatio: number;
  surfaceMix: number;
  edgeOpacity: number;
  animating: boolean;
}

/** Presentation only: never feeds the displayed ratio back into HP, XP or conquest. */
export class HpBarMotion {
  private identity: string | null | undefined;
  private resetKey = '';
  private ratio = 0;
  private lastNow = 0;
  private enabled = false;
  private pulseAt: number | undefined;
  private loopAt: number | undefined;
  private drop: { at: number; fill: number } | undefined;

  cancel(): void {
    this.pulseAt = undefined;
    this.loopAt = undefined;
    this.drop = undefined;
  }

  hit(nowMs: number): void {
    // Impacts only pulse a tiny endpoint; never restart the gradient or subtract HP.
    if (!this.enabled || this.ratio <= 0 || this.drop || !Number.isFinite(nowMs)) return;
    this.pulseAt = nowMs;
  }

  frame(input: HpBarInput): HpBarFrame {
    const now = Number.isFinite(input.nowMs) ? input.nowMs : this.lastNow;
    const ratio = Number.isFinite(input.ratio) ? clamp(input.ratio) : 0;
    const reset =
      this.identity !== input.key ||
      this.resetKey !== input.resetKey ||
      input.key === null ||
      input.reducedMotion ||
      now < this.lastNow ||
      now - this.lastNow > 1500;
    if (reset || ratio > this.ratio) {
      this.cancel();
    } else if (ratio < this.ratio) {
      // Sample against the PREVIOUS target before installing the newest XP snapshot.
      const current = this.sample(now);
      this.pulseAt = undefined;
      this.drop = {
        at: now,
        fill: Math.max(ratio, current.fillRatio),
      };
    }
    this.identity = input.key;
    this.resetKey = input.resetKey;
    this.enabled = input.key !== null && !input.reducedMotion && ratio > 0;
    if (!input.running || !this.enabled) this.loopAt = undefined;
    else this.loopAt ??= now;
    this.ratio = ratio;
    this.lastNow = now;
    return this.sample(now);
  }

  private sample(now: number): HpBarFrame {
    let fillRatio = this.ratio;
    if (this.drop) {
      const age = Math.max(0, now - this.drop.at);
      if (age < 700) {
        fillRatio = this.ratio + (this.drop.fill - this.ratio) * (1 - smooth(age / 700));
      } else this.drop = undefined;
    }
    let edgeOpacity = 0;
    if (this.pulseAt !== undefined) {
      const age = Math.max(0, now - this.pulseAt);
      if (age < 600) edgeOpacity = 0.28 * Math.sin((Math.PI * age) / 600) ** 2;
      else this.pulseAt = undefined;
    }
    let surfaceMix = 0;
    if (this.loopAt !== undefined) {
      const age = Math.max(0, now - this.loopAt);
      surfaceMix = colorCycle(age, 3600);
      edgeOpacity = Math.max(edgeOpacity, 0.1 + 0.18 * colorCycle(age, 1800));
    }
    return {
      fillRatio,
      surfaceMix,
      edgeOpacity,
      animating: this.drop !== undefined || this.pulseAt !== undefined || this.loopAt !== undefined,
    };
  }
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const p = clamp(value);
  return p * p * (3 - 2 * p);
};
const colorCycle = (age: number, period: number) =>
  (1 - Math.cos((2 * Math.PI * age) / period)) / 2;
