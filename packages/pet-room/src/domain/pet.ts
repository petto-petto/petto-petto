/**
 * 보유 펫 명부.
 *
 * ## 정본은 `PetClient`다
 *
 * 보유 펫은 공통 SQLite의 `owned_pets`가 정본이고, 뽑기·합성이 그 표에 개체를 만들고 지운다.
 * 펫룸은 그 목록을 받아 자기가 그리는 모양(`RoomCollection`)으로 바꿀 뿐 따로 저장하지 않는다.
 * 예전에는 펫룸이 `room-state.json`에 고정 시드 여섯 마리를 들고 있어서, 뽑은 펫이 펫룸에
 * 나타나지 않았다 — 명부가 둘이었다.
 *
 * `@pet/room`은 `@pet/client`를 의존하지 않는다. 받는 값의 모양만 `OwnedPetRecord`로 적어 둔다.
 *
 * ## 이 명부가 정하지 않는 것
 *
 * 레벨과 진화 단계. 그 둘의 정본은 오버레이의 성장 저장소이고, 여기 담긴 값은
 * `withPetGrowth`로 밀어 넣은 **투영**이다. 명부가 자기 레벨을 따로 올리면 오버레이가
 * 보여 주는 레벨과 갈라지고, 프로필과 화면이 서로 다른 숫자를 말하게 된다.
 */

import { petId, type PetId, type Rarity } from '@pet/core';

/** 진화 단계. 에셋 가이드 §3이 이 셋만 허용한다. */
export type PetStage = 1 | 2 | 3;

/**
 * 성장이 세는 진화 횟수. 스프라이트 `stage`와 1씩 어긋난다.
 *
 * 오버레이 성장 엔진이 쓰는 표현을 그대로 받는다. 두 표현 사이를 오갈 때 `+1`/`-1`을 손으로
 * 쓰면 한쪽을 빠뜨린다 — `stageForEvolution` 하나만 쓴다.
 */
export type EvolutionStage = 0 | 1 | 2;

/**
 * 종 메타. 에셋 폴더의 `pet.json`에서 옮겨 적은 값이다.
 *
 * 런타임에 `pet.json`을 읽지 않고 여기 두는 이유: 종 목록은 화면을 그리기 **전에**
 * 필요하고(어떤 파일을 읽을지 정하는 데 쓰인다), 파일 읽기는 렌더러의 일이라 도메인이
 * 알면 안 된다. 두 값이 어긋나면 `species.contract.test.ts`가 잡는다.
 */
export interface PetSpecies {
  /** 3자리 zero-padded. 파일명에 그대로 들어간다. */
  petId: PetId;
  /** 종 폴더명. */
  slug: string;
  /** 도감 표시용 한국어명. */
  name: string;
  rarity: Rarity;
}

/** 수록된 종. 에셋 폴더와 1:1이다. */
export const PET_SPECIES: readonly PetSpecies[] = [
  { petId: petId('001'), slug: 'acorn_squirrel', name: '도토리다람쥐', rarity: 'EPIC' },
  { petId: petId('002'), slug: 'midnight_zebra', name: '미드나잇얼룩말', rarity: 'RARE' },
  { petId: petId('003'), slug: 'mole_digger', name: '두더지', rarity: 'COMMON' },
  { petId: petId('004'), slug: 'sprout_treant', name: '새싹나무', rarity: 'COMMON' },
  { petId: petId('005'), slug: 'cheek_hamster', name: '볼주머니햄', rarity: 'RARE' },
  { petId: petId('006'), slug: 'star_wizard', name: '별빛마법사', rarity: 'EPIC' },
];

export class UnknownSpeciesError extends Error {
  constructor(value: string) {
    super(`알 수 없는 펫 종입니다: ${value}`);
    this.name = 'UnknownSpeciesError';
  }
}

export class UnknownOwnedPetError extends Error {
  constructor(value: string) {
    super(`알 수 없는 보유 펫입니다: ${value}`);
    this.name = 'UnknownOwnedPetError';
  }
}

export function speciesOf(id: PetId): PetSpecies {
  const found = PET_SPECIES.find((species) => species.petId === id);
  if (!found) throw new UnknownSpeciesError(id);
  return found;
}

/**
 * 진화 횟수 → 스프라이트 단계.
 *
 * 화면에 뜨는 단계는 **오직 이 함수**가 정한다. 레벨에서 유도하지 않는다 — 진화는 사용자가
 * 오버레이에서 명시적으로 실행하는 행동이고, 레벨이 경계를 넘었다는 것만으로 모습이 바뀌면
 * 그 행동이 의미를 잃는다.
 */
export function stageForEvolution(stage: EvolutionStage): PetStage {
  if (stage <= 0) return 1;
  if (stage === 1) return 2;
  return 3;
}

/** 사용자가 가진 펫 한 마리. */
export interface OwnedPet {
  /** 개체 식별자. 같은 종을 여러 마리 가질 수 있으므로 `petId`와 다르다. */
  id: string;
  speciesPetId: PetId;
  /** 성장 저장소의 투영. 이 명부가 직접 올리지 않는다(파일 머리말 참조). */
  level: number;
  /** 성장 저장소의 투영. 진화는 오버레이에서 명시적으로 실행된다. */
  evolutionStage: EvolutionStage;
  nickname?: string;
}

/**
 * 보유 펫 명부와 활성 펫.
 *
 * 활성 펫을 `OwnedPet.isActive` 플래그로 두지 않고 명부 바깥의 id 하나로 둔다. 플래그로
 * 두면 "둘 다 활성"이라는 표현 불가능해야 할 상태가 타입상 표현 가능해지고, 그걸 막는
 * 코드를 매번 써야 한다. id 하나면 **구조적으로 하나만 활성**이다.
 *
 * 보유 펫이 없으면 활성도 없다(`null`). 첫 실행에서는 펫이 한 마리도 없다.
 */
export interface RoomCollection {
  pets: readonly OwnedPet[];
  activePetId: string | null;
}

/** `PetClient`의 보유 개체 중 펫룸이 읽는 칸. `@pet/client`의 `OwnedPet`과 같은 이름이다. */
export interface OwnedPetRecord {
  ownedPetId: string;
  /** '001' 같은 3자리 종 id. */
  speciesId: string;
  level: number;
  evolutionStage: EvolutionStage;
  nickname: string | null;
  isActive: boolean;
}

/**
 * 보유 개체 목록을 명부로 바꾼다.
 *
 * 펫룸이 그릴 줄 모르는 종(에셋이 없는 종)은 빼고 넘어간다. 한 마리 때문에 펫룸 전체가 안
 * 열리는 것보다 낫다. 뺀 개체는 `skipped`로 돌려줘 호출한 쪽이 기록하게 한다.
 */
export function collectionFromRecords(records: readonly OwnedPetRecord[]): {
  collection: RoomCollection;
  skipped: OwnedPetRecord[];
} {
  const pets: OwnedPet[] = [];
  const skipped: OwnedPetRecord[] = [];
  for (const record of records) {
    const species = PET_SPECIES.find((candidate) => candidate.petId === record.speciesId);
    if (!species) {
      skipped.push(record);
      continue;
    }
    pets.push({
      id: record.ownedPetId,
      speciesPetId: species.petId,
      level: record.level,
      evolutionStage: record.evolutionStage,
      ...(record.nickname === null ? {} : { nickname: record.nickname }),
    });
  }
  const active = records.find(
    (record) => record.isActive && pets.some((pet) => pet.id === record.ownedPetId),
  );
  return { collection: { pets, activePetId: active?.ownedPetId ?? null }, skipped };
}

/**
 * 활성으로 세워야 할 개체. 이미 활성이 있거나 펫이 없으면 `null`이다.
 *
 * 보유 펫이 있는데 활성이 없으면 오버레이에 아무것도 안 뜬다. 첫 뽑기 직후가 정확히 그
 * 상황이라, 명부의 첫 마리를 세운다.
 */
export function activeCandidate(collection: RoomCollection): string | null {
  if (collection.activePetId !== null) return null;
  return collection.pets[0]?.id ?? null;
}

export function findOwnedPet(collection: RoomCollection, ownedPetId: string): OwnedPet {
  const found = collection.pets.find((pet) => pet.id === ownedPetId);
  if (!found) throw new UnknownOwnedPetError(ownedPetId);
  return found;
}

export function activePet(collection: RoomCollection): OwnedPet | null {
  if (collection.activePetId === null) return null;
  return findOwnedPet(collection, collection.activePetId);
}

/**
 * 활성 펫을 바꾼다. 명부에 없는 id면 던진다.
 *
 * 새 객체를 돌려준다 — 호출한 쪽이 제자리에서 고치고 저장을 잊는 일을 막는다.
 */
export function withActivePet(collection: RoomCollection, ownedPetId: string): RoomCollection {
  findOwnedPet(collection, ownedPetId);
  return { pets: collection.pets, activePetId: ownedPetId };
}

/** 한 개체의 성장값. 정본은 오버레이의 성장 저장소다. */
export interface PetGrowth {
  level: number;
  evolutionStage: EvolutionStage;
}

/**
 * 성장 저장소가 말하는 레벨·진화 단계를 명부에 투영한다.
 *
 * 명부에 없는 개체는 무시하고, 성장 기록이 없는 개체는 그대로 둔다. 성장이 한 방향으로만
 * 흐르므로(성장 저장소 → 명부) 두 값이 경쟁하지 않는다.
 */
export function withPetGrowth(
  collection: RoomCollection,
  growth: ReadonlyMap<string, PetGrowth>,
): RoomCollection {
  return {
    pets: collection.pets.map((pet) => {
      const next = growth.get(pet.id);
      if (next === undefined) return pet;
      if (next.level === pet.level && next.evolutionStage === pet.evolutionStage) return pet;
      return { ...pet, level: next.level, evolutionStage: next.evolutionStage };
    }),
    activePetId: collection.activePetId,
  };
}

/**
 * 성장 저장소가 개체를 처음 받아들일 때 필요한 정보.
 *
 * `petKey`는 종 `slug`다 — 오버레이 카탈로그의 펫 key와 **같은 값**이라 변환 표가 필요 없다
 * (`renderer-catalog.generated.ts` 참조). 두 값이 갈라지면
 * `renderer-pet-catalog.contract.test.ts`가 잡는다.
 */
export interface PetGrowthSeed {
  ownedPetId: string;
  petKey: string;
  displayName: string;
  level: number;
  evolutionStage: EvolutionStage;
}

export function growthSeeds(collection: RoomCollection): PetGrowthSeed[] {
  return collection.pets.map((pet) => {
    const species = speciesOf(pet.speciesPetId);
    return {
      ownedPetId: pet.id,
      petKey: species.slug,
      displayName: pet.nickname ?? species.name,
      level: pet.level,
      evolutionStage: pet.evolutionStage,
    };
  });
}

/** 도감 진행도. 보유한 **종**의 수이지 마리 수가 아니다(에셋 가이드 §9). */
export function discoveredSpeciesCount(collection: RoomCollection): number {
  return new Set(collection.pets.map((pet) => pet.speciesPetId)).size;
}

/** 펫룸이 그리는 데 필요한 한 마리분 정보. 종 메타를 이미 합쳐 둔 것. */
export interface RoomPetView {
  ownedPetId: string;
  petId: PetId;
  slug: string;
  name: string;
  rarity: Rarity;
  level: number;
  stage: PetStage;
  isActive: boolean;
}

export function roomPetView(collection: RoomCollection, pet: OwnedPet): RoomPetView {
  const species = speciesOf(pet.speciesPetId);
  return {
    ownedPetId: pet.id,
    petId: species.petId,
    slug: species.slug,
    name: pet.nickname ?? species.name,
    rarity: species.rarity,
    level: pet.level,
    // 레벨이 아니라 진화 횟수가 모습을 정한다(`stageForEvolution` 주석 참조).
    stage: stageForEvolution(pet.evolutionStage),
    isActive: pet.id === collection.activePetId,
  };
}

export function roomPetViews(collection: RoomCollection): RoomPetView[] {
  return collection.pets.map((pet) => roomPetView(collection, pet));
}
