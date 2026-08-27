/**
 * 업적 정의 로딩. 기획서 7.1: "업적 정의와 밸런스 값은 코드 분기 대신 버전 관리되는
 * 설정으로 제공한다."
 */

import definitionFile from './achievements.json' with { type: 'json' };
import { isFactKey } from './facts.ts';

/** 업적 카테고리. 업적 화면의 필터 값이기도 하다. */
export type Category = 'collection' | 'growth' | 'battle' | 'usage' | 'hidden';

export const CATEGORIES: readonly Category[] = [
  'collection',
  'growth',
  'battle',
  'usage',
  'hidden',
];

const CATEGORY_NAMES: Record<Category, string> = {
  collection: '수집',
  growth: '성장',
  battle: '전투',
  usage: '사용량',
  hidden: '히든',
};

export const categoryName = (category: Category): string => CATEGORY_NAMES[category];

export const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

/** 단계형 업적의 티어. */
export type Tier = 'bronze' | 'silver' | 'gold';

const TIER_NAMES: Record<Tier, string> = { bronze: '브론즈', silver: '실버', gold: '골드' };

export const tierName = (tier: Tier): string => TIER_NAMES[tier];

/**
 * 업적 하나의 정의. 기획서 10장의 `achievement_definition`.
 *
 * 모든 업적이 `fact` + `target` 한 가지 모양으로 표현된다는 점이 이 설계의 핵심이다.
 * "첫 펫 획득"도 `first_pet >= 1`이고 "전투 500승"도 `battle_wins >= 500`이다.
 * 덕분에 판정 코드에 업적별 분기가 존재하지 않는다.
 */
export interface AchievementDefinition {
  /** 릴리스 사이에 절대 바뀌지 않는 값(기획서 9.3). 이름은 바꿔도 이것은 유지한다. */
  id: string;
  category: Category;
  name: string;
  condition: string;
  /** 판정 기준이 되는 사실 키. */
  fact: string;
  /** 사실이 이 값 이상이면 달성이다. */
  target: number;
  tier?: Tier;
  coin: number;
  title?: string;
  trophy?: boolean;
  /** 기획서 7.1: 히든은 달성 전까지 이름·조건·진행률·보상을 모두 가린다. */
  hidden?: boolean;
}

/** 코인 보상의 멱등 키(기획서 9.5). */
export const coinRewardKey = (definition: AchievementDefinition): string =>
  `achievement:${definition.id}`;

/** 기획서 7.4: `첫 만남` 트로피만 룸의 첫 빈자리에 자동 배치한다. */
export const autoPlacesTrophy = (definition: AchievementDefinition): boolean =>
  definition.id === 'collection.first_pet';

export class CatalogError extends Error {
  override readonly name = 'CatalogError';
}

/**
 * 정의가 실제로 판정 가능한지 확인한다.
 *
 * 특히 사실 키 검사가 중요하다. 새 업적을 추가할 때 사실 투영을 같이 넣지 않으면
 * "영원히 달성 불가능한 업적"이 조용히 생기는데, 이 검사가 그것을 로딩 실패로 바꾼다.
 */
export function validateCatalog(definitions: readonly AchievementDefinition[]): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) {
      throw new CatalogError(`업적 ID가 중복됨: ${definition.id}`);
    }
    seen.add(definition.id);

    if (!isFactKey(definition.fact)) {
      throw new CatalogError(
        `업적 ${definition.id}이 알 수 없는 사실 키 ${definition.fact}를 참조함`,
      );
    }
    if (definition.target <= 0) {
      throw new CatalogError(`업적 ${definition.id}의 목표값이 0 이하임`);
    }
  }
}

export class AchievementCatalog {
  readonly definitions: readonly AchievementDefinition[];

  constructor(definitions: readonly AchievementDefinition[]) {
    validateCatalog(definitions);
    this.definitions = definitions;
  }

  /** 패키지에 포함된 정의를 읽는다. */
  static embedded(): AchievementCatalog {
    return new AchievementCatalog(definitionFile.achievements as AchievementDefinition[]);
  }

  /** 파싱된 JSON에서 만든다. 소급 판정 테스트가 정의를 늘려 볼 때 쓴다. */
  static fromDefinitions(definitions: readonly AchievementDefinition[]): AchievementCatalog {
    return new AchievementCatalog(definitions);
  }

  get size(): number {
    return this.definitions.length;
  }

  get(id: string): AchievementDefinition | undefined {
    return this.definitions.find((definition) => definition.id === id);
  }
}
