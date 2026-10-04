import type { BattleLayout } from './layout.ts';

export type AmbientSide = 'PET' | 'ENEMY';

/** Flavor text only: never writes hunger, fatigue, XP, HP, or combat state. */
export const AMBIENT_MESSAGES: Record<AmbientSide, readonly string[]> = {
  PET: [
    '조금 피곤하네. 그래도 힘내자!',
    '꼬르륵… 끝나면 간식 먹자.',
    '쫑긋(간지러운 귀 긁음)',
    '살랑살랑. 기분은 좋아!',
    '발을 딱! 다시 준비됐어.',
    '하아암… 나 안 졸았어!',
    '부르르! 정신 차려야지.',
    '너, 빈틈이 보이는데?',
    '후우. 숨 좀 고르고.',
    '오늘 간식은 뭘까?',
    '쭈욱! 몸이 좀 풀리네.',
    '할 수 있어. 나를 믿어!',
    '톡톡. 다음은 내 차례야.',
    '방금 저쪽에서 무슨 소리 났지?',
    '반짝! 좋은 생각이 났어.',
    '앗, 잠깐 딴생각했네.',
    '쉿. 살금살금 가 볼까?',
    '아직 멀쩡해. 더 할 수 있어!',
    '친구들이 응원해주고 있어.',
    '지금이야? 조금만 더 기다리자.',
  ],
  ENEMY: [
    '빵빵! 나 더 커 보이지?',
    '후우… 잠깐 숨 좀 돌리자.',
    '말랑말랑. 원래 이런 몸이야.',
    '동그랗게 숨으면 안 보이려나?',
    '촉촉. 오늘 수분은 충분해.',
    '살금살금… 조금만 가까이.',
    '어디로 가는지 다 보고 있어.',
    '착! 바닥이 은근 편하네.',
    '납작! 이러면 피할 수 있겠지?',
    '보글보글. 속이 간질간질해.',
    '흔들흔들. 아직 여유 있어.',
    '으음… 수상한데?',
    '앗 깜짝이야! 놀랐잖아.',
    '탱글! 이번엔 튕겨 낼 거야.',
    '출렁출렁. 젤리 아니거든?',
    '잠깐만. 한 박자 쉬고 가자.',
    '반짝반짝. 달빛 좋아.',
    '뽁! 기포 하나 날아갔다.',
    '응? 누가 날 부른 것 같은데.',
    '다음엔 내가 먼저 갈 거야.',
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

export function ambientLogLayout(
  battle: BattleLayout,
  _hasDefeatedSpectators = false,
): {
  visible: boolean;
  width: number;
  height: number;
  top: number;
  petX: number;
  enemyX: number;
} {
  const margin = 16;
  const width = Math.max(0, Math.min(240, (battle.width - margin * 2 - 40) / 2));
  return {
    visible: battle.width >= 540 && battle.height >= 416,
    width,
    height: Math.max(0, Math.min(260, battle.height - 60)),
    top: 48,
    petX: margin,
    enemyX: battle.width - margin - width,
  };
}
