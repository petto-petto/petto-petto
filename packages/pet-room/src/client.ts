import type { OwnedPet, PetClient, PetSpecies, Rarity } from '@pet/client';
import type { RoomPetView } from './domain/pet.ts';

/** 펫룸이 현재 표시하는 명부와 오버레이 지정 개체의 읽기 전용 스냅샷. */
export interface RoomSelectionSnapshot {
  readonly pets: readonly RoomPetView[];
  readonly activePetId: string | null;
}

export interface RoomSelectionClient {
  getSnapshot(): RoomSelectionSnapshot;
}

/** 저장 방식은 소유자에게 남기고, 매 조회마다 최신 룸 선택을 전달한다. */
export class RoomSelectionAdapter implements RoomSelectionClient {
  readonly #readPets: () => readonly RoomPetView[];

  constructor(readPets: () => readonly RoomPetView[]) {
    this.#readPets = readPets;
  }

  getSnapshot(): RoomSelectionSnapshot {
    const pets = this.#readPets().map((pet) => ({ ...pet }));
    if (new Set(pets.map((pet) => pet.ownedPetId)).size !== pets.length) {
      throw new Error('펫룸 개체 ID가 중복되었습니다');
    }
    const active = pets.filter((pet) => pet.isActive);
    if (active.length > 1) throw new Error('펫룸 활성 펫은 한 마리여야 합니다');
    return { pets, activePetId: active[0]?.ownedPetId ?? null };
  }
}

/**
 * 공통 펫 소유자가 공개한 조회 계약의 부분집합.
 * 펫룸 JSON 선택·저장을 연결하거나 성장 값을 추정하지 않는다.
 */
export type RoomPetReadClient = Pick<
  PetClient,
  'getActivePet' | 'listOwnedPets' | 'listSpecies' | 'readOwnedPetGrowth'
>;

/** 공통 활성 펫·성장 스냅샷을 그대로 전달하는 읽기 전용 Adapter. */
export class PetClientRoomAdapter implements RoomPetReadClient {
  readonly #pets: RoomPetReadClient;

  constructor(pets: RoomPetReadClient) {
    this.#pets = pets;
  }

  getActivePet(): OwnedPet | null {
    return this.#pets.getActivePet();
  }

  listOwnedPets(speciesId?: string): OwnedPet[] {
    return this.#pets.listOwnedPets(speciesId);
  }

  listSpecies(rarity?: Rarity): PetSpecies[] {
    return this.#pets.listSpecies(rarity);
  }

  readOwnedPetGrowth(ownedPetIds: readonly string[]) {
    return this.#pets.readOwnedPetGrowth(ownedPetIds);
  }
}
