/**
 * 펫룸 상태의 저장 형식.
 *
 * `@pet/meta`의 스냅샷과 **같은 파일에 넣지 않는다.** 두 feature의 저장 주기와 스키마
 * 변경 이유가 다르기 때문이다. meta의 스키마를 고칠 때 보유 펫이 딸려 나가면 안 된다.
 */

import { petId } from '@pet/core';
import type { OwnedPet, RoomCollection } from '../domain/pet.ts';
import { PET_SPECIES, seedCollection } from '../domain/pet.ts';

/** 저장 파일에 실제로 쓰이는 모양. 전부 JSON 원시값이다. */
export interface RoomSnapshot {
  version: 1;
  pets: { id: string; speciesPetId: string; level: number; nickname?: string }[];
  activePetId: string;
}

/** 펫룸이 저장소에 요구하는 것. 구현은 앱이 준다. */
export interface RoomStore {
  load(): RoomSnapshot | undefined;
  save(snapshot: RoomSnapshot): void;
}

export function toSnapshot(collection: RoomCollection): RoomSnapshot {
  return {
    version: 1,
    pets: collection.pets.map((pet) => ({
      id: pet.id,
      speciesPetId: pet.speciesPetId,
      level: pet.level,
      ...(pet.nickname === undefined ? {} : { nickname: pet.nickname }),
    })),
    activePetId: collection.activePetId,
  };
}

const isKnownSpecies = (value: string): boolean =>
  PET_SPECIES.some((species) => species.petId === value);

/**
 * 스냅샷을 도메인 값으로 되돌린다.
 *
 * 저장 파일은 사용자 디스크에 있는 남의 손이 닿을 수 있는 데이터다. 모르는 종이나 빈
 * 명부가 들어와도 앱이 죽지 않고 **시드로 되돌아간다.** 여기서 던지면 사용자는 창이
 * 아예 안 뜨는 것만 보게 된다.
 */
export function fromSnapshot(snapshot: RoomSnapshot | undefined): RoomCollection {
  if (!snapshot || snapshot.version !== 1) return seedCollection();

  const pets: OwnedPet[] = [];
  for (const raw of snapshot.pets ?? []) {
    if (typeof raw?.id !== 'string' || !isKnownSpecies(raw.speciesPetId)) continue;
    if (!Number.isFinite(raw.level)) continue;
    pets.push({
      id: raw.id,
      speciesPetId: petId(raw.speciesPetId),
      level: raw.level,
      ...(raw.nickname === undefined ? {} : { nickname: raw.nickname }),
    });
  }

  if (pets.length === 0) return seedCollection();

  // 활성 펫이 명부에서 사라졌으면 첫 마리로 되돌린다. 활성 펫이 없는 상태는 없다.
  const first = pets[0];
  if (!first) return seedCollection();
  const activePetId = pets.some((pet) => pet.id === snapshot.activePetId)
    ? snapshot.activePetId
    : first.id;

  return { pets, activePetId };
}
