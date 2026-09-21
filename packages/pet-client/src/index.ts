import type { Rarity } from '@pet/core';

export type { Rarity } from '@pet/core';

/** 배포 시 등록되는 펫 종류. speciesId는 '001' 같은 에셋 ID다. */
export interface PetSpecies {
  speciesId: string;
  name: string;
  rarity: Rarity;
  /** 기존 에셋 폴더 식별자. 예: acorn_squirrel. */
  sprite: string;
}

/** 성장 기능이 계산한 저장 값. 계산 규칙은 PetClient가 소유하지 않는다. */
export interface PetGrowth {
  level: number;
  totalXp: number;
  xpIntoLevel: number;
  /** 에셋 stage 1/2/3에 각각 대응한다. */
  evolutionStage: 0 | 1 | 2;
}

/** 같은 종류라도 개체별 ownedPetId와 성장 값을 갖는다. 표시명은 nickname ?? name. */
export interface OwnedPet extends PetSpecies, PetGrowth {
  ownedPetId: string;
  nickname: string | null;
  isActive: boolean;
}

/**
 * 소비 기능에 주입하는 공통 펫 API. SQLite/Electron에 의존하지 않는다.
 * 저장·조회 실패와 없는 개체에 대한 명령은 예외를 던진다.
 * 현재 구현은 동기식이며, 비어 있는 정상 목록은 []를 반환한다.
 */
export interface PetClient {
  listSpecies(rarity?: Rarity): PetSpecies[];
  countSpecies(rarity?: Rarity): number;
  listOwnedPets(speciesId?: string): OwnedPet[];
  getOwnedPet(ownedPetId: string): OwnedPet;
  countOwnedPets(): number;
  /** 현재 보유 종류 수. 과거 발견 수가 아니다. */
  countOwnedSpecies(): number;
  /** 현재 보유 개체의 최고 레벨. 보유 개체가 없으면 0. */
  getHighestLevel(): number;
  /** 활성 선택이 없을 때만 null. 저장소 오류는 예외다. */
  getActivePet(): OwnedPet | null;
  /** 중복 종류 허용. 초기 상태로 생성하며 여러 마리도 전부 저장 또는 전부 취소한다. */
  createOwnedPets(speciesIds: readonly string[]): OwnedPet[];
  /** 앞뒤 공백 제거 후 빈 별명은 null로 저장한다. */
  updateNickname(ownedPetId: string, nickname: string | null): OwnedPet;
  updateGrowth(ownedPetId: string, growth: PetGrowth): OwnedPet;
  setActivePet(ownedPetId: string): OwnedPet;
  /**
   * 합성 기능이 결정한 결과를 저장한다. 재료 삭제와 결과 생성은 원자적이다.
   * 빈 재료·중복 개체 ID·없는 개체·활성 개체는 거부한다.
   * 재료 수/등급/확률/비용은 호출자가 검사한다. 결과는 초기 상태의 비활성 개체다.
   */
  replaceOwnedPets(materialOwnedPetIds: readonly string[], resultSpeciesId: string): OwnedPet;
}

/** AI 도구 토큰 사용량 인터페이스. 구현은 apps/desktop 이 주입한다. */
export * from './token.ts';
