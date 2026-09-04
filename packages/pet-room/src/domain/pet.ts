/**
 * 보유 펫 명부.
 *
 * ## 왜 이게 `@pet/room`에 있는가
 *
 * 보유 펫은 원래 `collection` 도메인의 것이다. 그 도메인은 팀의 다른 사람이 만든다
 * (`@pet/meta`의 `testing/fakes.ts` 주석 참조). 아직 없는 도메인의 이름을 선점하지 않기
 * 위해, 펫룸이 자기가 그리는 데 필요한 만큼만 여기서 들고 있는다.
 *
 * **`collection` 담당자가 오면 이 파일이 그 패키지로 넘어간다.** 그때 펫룸은 자기
 * 포트(`RoomCollection`)만 남기고 구현을 그쪽에서 받는다.
 *
 * 그 전까지도 이것은 **테스트 대역이 아니다.** 실제로 저장되고, 실제로 활성 펫이 바뀐다.
 * `@pet/meta`가 프로덕션에서 `InMemoryCollection`을 쓰던 상태를 이걸로 대체한다.
 */

import { petId, type PetId, type Rarity } from '@pet/core';

/** 진화 단계. 에셋 가이드 §3이 이 셋만 허용한다. */
export type PetStage = 1 | 2 | 3;

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
 * 레벨 → 진화 단계. 에셋 가이드 §3.
 *
 * 경계가 10과 20이다. Lv.9는 stage1, Lv.10은 stage2.
 */
export function stageOfLevel(level: number): PetStage {
  if (level < 10) return 1;
  if (level < 20) return 2;
  return 3;
}

/** 사용자가 가진 펫 한 마리. */
export interface OwnedPet {
  /** 개체 식별자. 같은 종을 여러 마리 가질 수 있으므로 `petId`와 다르다. */
  id: string;
  speciesPetId: PetId;
  level: number;
  nickname?: string;
}

/**
 * 보유 펫 명부와 활성 펫.
 *
 * 활성 펫을 `OwnedPet.isActive` 플래그로 두지 않고 명부 바깥의 id 하나로 둔다. 플래그로
 * 두면 "둘 다 활성"이라는 표현 불가능해야 할 상태가 타입상 표현 가능해지고, 그걸 막는
 * 코드를 매번 써야 한다. id 하나면 **구조적으로 하나만 활성**이다.
 */
export interface RoomCollection {
  pets: readonly OwnedPet[];
  activePetId: string;
}

/**
 * 시드 명부.
 *
 * 획득 로직(가챠)이 아직 없어서 고정값으로 채운다. 레벨은 stage 1·2·3이 모두 화면에
 * 나오도록 고르고, 등급도 COMMON/RARE/EPIC이 전부 들어가게 섞는다. 특히 Lv.22의
 * `acorn_squirrel`과 Lv.25의 `star_wizard`는 **EPIC stage3만 캔버스가 48px**이라,
 * 프레임 크기를 32로 하드코딩한 실수가 있으면 그 두 마리만 잘려서 즉시 드러난다.
 */
export function seedCollection(): RoomCollection {
  return {
    pets: [
      { id: 'seed-001', speciesPetId: petId('003'), level: 3 },
      { id: 'seed-002', speciesPetId: petId('004'), level: 7 },
      { id: 'seed-003', speciesPetId: petId('005'), level: 12 },
      { id: 'seed-004', speciesPetId: petId('002'), level: 15 },
      { id: 'seed-005', speciesPetId: petId('001'), level: 22 },
      { id: 'seed-006', speciesPetId: petId('006'), level: 25 },
    ],
    activePetId: 'seed-006',
  };
}

export function findOwnedPet(collection: RoomCollection, ownedPetId: string): OwnedPet {
  const found = collection.pets.find((pet) => pet.id === ownedPetId);
  if (!found) throw new UnknownOwnedPetError(ownedPetId);
  return found;
}

export function activePet(collection: RoomCollection): OwnedPet {
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
    stage: stageOfLevel(pet.level),
    isActive: pet.id === collection.activePetId,
  };
}

export function roomPetViews(collection: RoomCollection): RoomPetView[] {
  return collection.pets.map((pet) => roomPetView(collection, pet));
}

/**
 * XP 바 채움 비율.
 *
 * **실제 경험치가 아니다.** 성장 로직이 아직 없어서 레벨에서 만들어 낸 표시용 값이다.
 * 이름에 `mock`을 박아 둔 것은 나중에 진짜 XP가 생겼을 때 이 호출부를 놓치지 않기
 * 위해서다.
 */
export function mockXpRatio(level: number): number {
  return (level % 10) / 10;
}
