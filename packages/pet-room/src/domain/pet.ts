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
 *
 * ## 이 명부가 정하는 것과 정하지 않는 것
 *
 * **정한다** — 누가 있는지(개체와 종), 어느 개체가 활성인지.
 *
 * **정하지 않는다** — 레벨과 진화 단계. 그 둘의 정본은 오버레이의 성장 저장소이고, 여기
 * 담긴 값은 `withPetGrowth`로 밀어 넣은 **투영**이다. 명부가 자기 레벨을 따로 올리면
 * 오버레이가 보여 주는 레벨과 갈라지고, 프로필과 화면이 서로 다른 숫자를 말하게 된다.
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

/**
 * 진화 게이트 — 이 레벨을 넘겨야 다음 진화를 **실행할 수 있다.**
 *
 * 성장 엔진(`@pet/main-overlay`의 `growth/constants.js`)이 소유한 규칙을 옮겨 적은 것이다.
 * 명부는 성장 저장소에 시드·이관값을 건네야 하는데 그때 다른 눈금을 쓰면 성장 엔진이 결코
 * 만들 수 없는 값이 정본에 깔린다 — 실제로 그렇게 활성 펫이 최종 단계로 시작해 진화가
 * 영구히 잠겼다. 두 값이 갈라지면 `pet.contract.test.ts`가 잡는다.
 */
export const EVOLUTION_LEVELS: readonly number[] = [15, 35];

/** 이 레벨에서 성장 엔진이 허용하는 **최대** 진화 횟수. 넘긴 게이트 수와 같다. */
export function maxEvolutionStageAt(level: number): EvolutionStage {
  return EVOLUTION_LEVELS.filter((gate) => level >= gate).length as EvolutionStage;
}

/**
 * 레벨 → 진화 단계. 에셋 가이드 §3.
 *
 * **이관 전용이다.** 진화 횟수 칸이 없던 v1 저장 파일이 화면에 내던 단계를 되살릴 때만
 * 쓴다. 시드는 이 함수를 쓰지 않는다 — 경계가 10/20 이라 성장 게이트(15/35)와 눈금이 달라서,
 * 시드에 쓰면 성장 엔진이 만들 수 없는 진화 횟수가 깔린다(`seedCollection` 주석 참조).
 *
 * 화면에 그릴 단계도 이 함수가 정하지 않는다. `stageForEvolution`이 정한다.
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
 */
export interface RoomCollection {
  pets: readonly OwnedPet[];
  activePetId: string;
}

/**
 * 시드 명부.
 *
 * 획득 로직(가챠)이 아직 없어서 고정값으로 채운다. 이 목록이 만족해야 하는 것 셋:
 *
 * 1. **stage 1·2·3이 모두 화면에 난다.** 특히 EPIC stage3만 캔버스가 48px이라, 프레임
 *    크기를 32로 하드코딩한 실수가 있으면 그 펫만 잘려서 즉시 드러난다.
 * 2. **등급 COMMON·RARE·EPIC이 모두 들어간다.**
 * 3. **진화 횟수가 성장 엔진의 게이트와 어긋나지 않는다.** 진화는 레벨이 게이트를 넘었을
 *    때 사용자가 **실행해야** 일어나므로, 넘긴 게이트 수보다 많이 진화한 상태는 성장
 *    엔진이 만들 수 없는 값이다. 그런 값을 시드로 깔면 그 펫은 진화가 영영 잠긴다.
 *
 * 그래서 진화 횟수를 레벨에서 유도하지 않고 **직접 적는다.** `stageOfLevel`(10/20 경계)로
 * 유도하면 성장 게이트(15/35)와 눈금이 달라 3번이 깨진다 — 실제로 활성 펫이 최종 단계로
 * 시작해 진화 버튼이 영구히 비활성이었다.
 *
 * 활성 펫(`seed-006`)은 게이트를 막 넘긴 채 아직 진화하지 않은 상태로 둔다. 앱을 처음 켜면
 * 진화가 **가능한** 펫이 오버레이에 떠 있어서, 그 기능이 있다는 것이 보인다.
 */
export function seedCollection(): RoomCollection {
  const seed = (
    id: string,
    species: string,
    level: number,
    evolutionStage: EvolutionStage,
  ): OwnedPet => ({
    id,
    speciesPetId: petId(species),
    level,
    evolutionStage,
  });

  return {
    pets: [
      seed('seed-001', '003', 3, 0),
      seed('seed-002', '004', 7, 0),
      seed('seed-003', '005', 20, 1),
      seed('seed-004', '002', 28, 1),
      seed('seed-005', '001', 40, 2),
      // 게이트(Lv.15)는 넘겼지만 아직 진화하지 않았다 → 첫 실행에서 진화가 가능하다.
      seed('seed-006', '006', 16, 0),
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

/**
 * XP 바 채움 비율.
 *
 * **실제 경험치가 아니다.** 펫룸은 성장 저장소를 읽지 않으므로 레벨에서 만들어 낸 표시용
 * 값이다. 이름에 `mock`을 박아 둔 것은 진짜 XP를 붙일 때 이 호출부를 놓치지 않기 위해서다.
 */
export function mockXpRatio(level: number): number {
  return (level % 10) / 10;
}
