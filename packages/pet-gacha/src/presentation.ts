import { drawCost, type DrawCount, type GachaGrade } from './gacha-engine.ts';

export interface GradeBearing {
  readonly grade: GachaGrade;
}

export interface RevealCopy {
  readonly kicker: string;
  readonly heading: string;
}

const GRADE_RANK: Readonly<Record<GachaGrade, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
};

export function highestGrade(results: readonly GradeBearing[]): GachaGrade {
  const first = results[0];
  if (first === undefined) throw new Error('연출할 뽑기 결과가 없습니다.');

  return results.reduce<GachaGrade>(
    (highest, result) => (GRADE_RANK[result.grade] > GRADE_RANK[highest] ? result.grade : highest),
    first.grade,
  );
}

export function introDuration(grade: GachaGrade): number {
  switch (grade) {
    case 'common':
      return 1_800;
    case 'rare':
      return 2_400;
    case 'epic':
      return 3_200;
    default:
      return assertNever(grade);
  }
}

export function awakeningCopy(grade: GachaGrade): string {
  switch (grade) {
    case 'common':
    case 'rare':
    case 'epic':
      return '열매 속 작은 숨결이 움직입니다';
    default:
      return assertNever(grade);
  }
}

export function cardInterval(grade: GachaGrade): number {
  switch (grade) {
    case 'common':
      return 150;
    case 'rare':
      return 210;
    case 'epic':
      return 290;
    default:
      return assertNever(grade);
  }
}

export function revealCopy(grade: GachaGrade): RevealCopy {
  switch (grade) {
    case 'common':
      return { kicker: '새로운 인연', heading: '숲의 문이 열립니다' };
    case 'rare':
      return { kicker: '반짝이는 발견', heading: '푸른 룬이 깨어납니다' };
    case 'epic':
      return { kicker: '별이 선택한 인연', heading: '황금빛 숲이 응답합니다' };
    default:
      return assertNever(grade);
  }
}

export interface DrawAffordance {
  readonly affordable: boolean;
  /** 버튼 아래 보조 문구. */
  readonly label: string;
}

const tokenAmount = new Intl.NumberFormat('ko-KR');

/**
 * 잔액으로 소환 버튼을 누를 수 있는지와 보조 문구를 정한다.
 *
 * 화면이 미리 막을 뿐이고, 최종 판정은 저장 로직의 잔액 검사가 한다. 잔액이 비용과 같으면 누를 수 있다.
 */
export function drawAffordance(count: DrawCount, balance: number): DrawAffordance {
  const cost = drawCost(count);
  const costLabel = `${tokenAmount.format(cost)} 토큰`;
  const shortfall = cost - balance;
  if (shortfall > 0) {
    return { affordable: false, label: `${costLabel} · ${tokenAmount.format(shortfall)} 부족` };
  }
  return { affordable: true, label: count === 10 ? `${costLabel} · RARE 이상 보장` : costLabel };
}

export const TOKEN_HINT = 'AI 도구를 쓰면 토큰이 쌓여요.';

/** 어느 소환이든 잔액이 모자라면 토큰을 모으는 방법을 알린다. */
export function showsTokenHint(balance: number): boolean {
  return !drawAffordance(1, balance).affordable || !drawAffordance(10, balance).affordable;
}

function assertNever(value: never): never {
  throw new Error(`알 수 없는 가챠 등급: ${String(value)}`);
}

/** 결과 화면이 처음 고르는 카드. 가장 높은 등급의 첫 카드다 — 보통 가장 반가운 친구다. */
export function defaultResultIndex(results: readonly GradeBearing[]): number {
  const top = highestGrade(results);
  return results.findIndex((result) => result.grade === top);
}

export interface ResultActionsInput {
  /** 고른 결과 펫이 이미 오버레이 펫인가. 첫 펫은 뽑는 순간 오버레이 펫이 된다. */
  targetIsOverlayPet: boolean;
  /** 방금 소환한 횟수. `한 번 더`가 같은 횟수로 다시 소환한다. */
  count: DrawCount;
  balance: number;
}

export interface ResultActions {
  overlay: { label: string; primary: boolean };
  /** `펫룸에서 보기`가 금색 기본 버튼인가. */
  roomPrimary: boolean;
  again: { enabled: boolean; label: string };
}

/**
 * 결과 뒤 다음 행동(동선 2단계 D). 첫 펫이면 오버레이로 데려가는 것이 다음 할 일이고, 그 밖에는
 * 펫룸에서 새 친구를 보는 것이 다음 할 일이다.
 */
export function resultActions({
  targetIsOverlayPet,
  count,
  balance,
}: ResultActionsInput): ResultActions {
  const again = drawAffordance(count, balance);
  return {
    overlay: {
      label: targetIsOverlayPet ? '오버레이에서 만나기' : '오버레이로 지정',
      primary: targetIsOverlayPet,
    },
    roomPrimary: !targetIsOverlayPet,
    again: { enabled: again.affordable, label: again.label },
  };
}
