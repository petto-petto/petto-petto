import type { GachaGrade } from './gacha-engine.ts';

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

function assertNever(value: never): never {
  throw new Error(`알 수 없는 가챠 등급: ${String(value)}`);
}
