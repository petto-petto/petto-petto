import type { BattleLayout } from './layout.ts';

export type AmbientSide = 'PET' | 'ENEMY';

/** Flavor text only: never writes hunger, fatigue, XP, HP, or combat state. */
export const AMBIENT_MESSAGES: Record<AmbientSide, readonly string[]> = {
  PET: [
    '펫이 피곤해합니다.',
    '펫이 배가 고픕니다.',
    '펫이 귀를 쫑긋 세웁니다.',
    '펫이 꼬리를 살랑거립니다.',
    '펫이 앞발을 고쳐 디딥니다.',
    '펫이 작은 하품을 합니다.',
    '펫이 몸을 가볍게 털어냅니다.',
    '펫이 적을 빤히 바라봅니다.',
    '펫이 숨을 고릅니다.',
    '펫이 간식을 떠올립니다.',
    '펫이 기지개를 켭니다.',
    '펫이 용기를 끌어모읍니다.',
    '펫이 발끝을 톡톡 굴립니다.',
    '펫이 주위를 두리번거립니다.',
    '펫이 눈을 반짝입니다.',
    '펫이 잠깐 딴생각을 합니다.',
    '펫이 자세를 낮춥니다.',
    '펫이 씩씩하게 고개를 듭니다.',
    '펫이 응원 소리에 귀 기울입니다.',
    '펫이 다음 기회를 노립니다.',
  ],
  ENEMY: [
    '적의 점막이 부풀어오릅니다.',
    '적이 숨을 고릅니다.',
    '적이 말랑하게 출렁입니다.',
    '적이 몸을 둥글게 웅크립니다.',
    '적의 표면에 물방울이 맺힙니다.',
    '적이 조심스럽게 다가옵니다.',
    '적이 펫의 움직임을 살핍니다.',
    '적이 바닥에 착 달라붙습니다.',
    '적이 잠깐 몸을 낮춥니다.',
    '적의 몸 안에서 기포가 오릅니다.',
    '적이 느릿하게 몸을 흔듭니다.',
    '적이 눈을 가늘게 뜹니다.',
    '적이 놀라서 움찔합니다.',
    '적이 몸을 탱탱하게 만듭니다.',
    '적이 젤리처럼 흔들립니다.',
    '적이 한 박자 쉬어갑니다.',
    '적의 표면이 달빛에 반짝입니다.',
    '적이 작은 기포를 터뜨립니다.',
    '적이 주변 소리에 반응합니다.',
    '적이 다음 움직임을 준비합니다.',
  ],
};

export interface AmbientEntry {
  readonly id: number;
  readonly text: string;
}

export class AmbientLogFeed {
  readonly #side: AmbientSide;
  readonly #random: () => number;
  #entries: AmbientEntry[] = [];
  #nextAt: number | undefined;
  #sequence = 0;

  constructor(side: AmbientSide, random: () => number = Math.random) {
    this.#side = side;
    this.#random = random;
  }

  get entries(): readonly AmbientEntry[] {
    return this.#entries;
  }

  reset(): void {
    this.#entries = [];
    this.#nextAt = undefined;
  }

  tick(now: number, enabled: boolean): boolean {
    if (!enabled) {
      this.#nextAt = undefined;
      return false;
    }
    if (this.#nextAt === undefined) {
      this.#schedule(now);
      return false;
    }
    if (now < this.#nextAt) return false;
    // Exclude all currently visible lines before evicting the oldest one.
    const candidates = AMBIENT_MESSAGES[this.#side].filter(
      (text) => !this.#entries.some((entry) => entry.text === text),
    );
    const index = Math.min(candidates.length - 1, Math.floor(this.#random() * candidates.length));
    this.#entries = [
      ...this.#entries.slice(-4),
      { id: ++this.#sequence, text: candidates[index]! },
    ];
    this.#schedule(now); // No catch-up burst after a throttled or hidden window.
    return true;
  }

  #schedule(now: number): void {
    this.#nextAt = now + 10000 + Math.round(this.#random() * 10000);
  }
}

export function ambientLogLayout(battle: BattleLayout): {
  visible: boolean;
  width: number;
  height: number;
  top: number;
  petX: number;
  enemyX: number;
} {
  const gap = 20;
  const margin = 16;
  const rightEdge = battle.enemyLeft + battle.petSize;
  const width = Math.max(
    0,
    Math.min(208, battle.petLeft - gap - margin, battle.width - rightEdge - gap - margin),
  );
  const height = 216;
  return {
    visible: width >= 176 && battle.height >= battle.petSize * 2 + 32,
    width,
    height,
    top: Math.max(48, Math.min(battle.height - height - 12, battle.floor - height)),
    petX: battle.petLeft - gap - width,
    enemyX: rightEdge + gap,
  };
}
