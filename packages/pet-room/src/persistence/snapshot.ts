/**
 * 펫룸 상태의 저장 형식.
 *
 * `@pet/meta`의 스냅샷과 **같은 파일에 넣지 않는다.** 두 feature의 저장 주기와 스키마
 * 변경 이유가 다르기 때문이다. meta의 스키마를 고칠 때 보유 펫이 딸려 나가면 안 된다.
 *
 * ## v1 → v2
 *
 * v2에서 개체마다 `evolutionStage`가 생겼다. v1에는 레벨만 있어서 펫룸이 `stageOfLevel`로
 * 모습을 유도했는데, 오버레이는 명시적 진화 횟수로 모습을 정한다 — 같은 펫이 두 화면에서
 * 다른 단계로 보였다. 이제 진화 횟수가 정본이고, **v1 파일은 레벨에 맞는 단계로 승격한다.**
 * 승격은 값을 지어내는 것이 아니라 v1이 화면에 보여 주던 바로 그 단계를 명시화하는 것이라,
 * 사용자가 보던 모습이 그대로 유지된다.
 */

import { petId } from '@pet/core';
import type { EvolutionStage, OwnedPet, RoomCollection } from '../domain/pet.ts';
import { maxEvolutionStageAt, PET_SPECIES, seedCollection, stageOfLevel } from '../domain/pet.ts';

/** 저장 파일에 실제로 쓰이는 모양. 전부 JSON 원시값이다. */
export interface RoomSnapshot {
  version: 2;
  pets: {
    id: string;
    speciesPetId: string;
    level: number;
    evolutionStage: number;
    nickname?: string;
  }[];
  activePetId: string;
}

/** 진화 횟수가 없던 시절의 파일. 읽기만 하고 다시 쓰지 않는다. */
export interface RoomSnapshotV1 {
  version: 1;
  pets: { id: string; speciesPetId: string; level: number; nickname?: string }[];
  activePetId: string;
}

/** 디스크에서 나올 수 있는 모든 버전. */
export type StoredRoomSnapshot = RoomSnapshot | RoomSnapshotV1;

/** 펫룸이 저장소에 요구하는 것. 구현은 앱이 준다. */
export interface RoomStore {
  load(): StoredRoomSnapshot | undefined;
  save(snapshot: RoomSnapshot): void;
}

export function toSnapshot(collection: RoomCollection): RoomSnapshot {
  return {
    version: 2,
    pets: collection.pets.map((pet) => ({
      id: pet.id,
      speciesPetId: pet.speciesPetId,
      level: pet.level,
      evolutionStage: pet.evolutionStage,
      ...(pet.nickname === undefined ? {} : { nickname: pet.nickname }),
    })),
    activePetId: collection.activePetId,
  };
}

const isKnownSpecies = (value: string): boolean =>
  PET_SPECIES.some((species) => species.petId === value);

/** 어느 버전에서 읽었든 한 마리는 이만큼으로 보인다. */
interface RawPet {
  id: string;
  speciesPetId: string;
  level: number;
  evolutionStage?: number;
  nickname?: string;
}

/**
 * 레벨로 쓸 수 있는 값인가.
 *
 * `Number.isFinite`만으로는 부족하다. 0·음수·소수가 통과하면 성장 저장소의
 * `CHECK (level >= 1)`에 걸려 **앱 시작이 통째로 실패한다** — 저장 파일 하나 때문에 창이
 * 아예 안 뜨는 상황을 막자는 이 함수의 목적과 정반대가 된다.
 */
function isUsableLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * 진화 횟수를 정한다. v1 파일과 손상된 값에는 레벨에서 유도한 값을 쓰되 **게이트를 넘지
 * 않게 자른다.**
 *
 * 자르지 않으면 v1 의 Lv.10~14 · Lv.20~34 구간이 성장 엔진은 결코 만들 수 없는 진화 횟수를
 * 물려받고, 그 펫은 다음 게이트가 밀리거나 최종 단계로 **영구히 잠긴다.** 실제로 v1
 * 시드에서는 여섯 마리 중 셋이, 그중 하나가 활성 펫이 그렇게 됐다.
 *
 * 대가는 v1 의 Lv.20~34 펫이 3단계에서 2단계 모습으로 한 번 내려가는 것이다. v1 에는 명시적
 * 진화가 아예 없었으므로 그 3단계는 사용자가 **얻어낸 것이 아니라** 레벨에서 그려 주던
 * 표시였고, 그 표시 규칙은 이 변경으로 없어졌다. 모습 한 번과 진화 영구 잠금을 맞바꾸지
 * 않는다.
 */
function evolutionStageOf(raw: unknown, level: number): EvolutionStage {
  if (raw === 0 || raw === 1 || raw === 2) return raw;
  const derived = (stageOfLevel(level) - 1) as EvolutionStage;
  return Math.min(derived, maxEvolutionStageAt(level)) as EvolutionStage;
}

function collectionOf(raw: readonly RawPet[], activePetId: string): RoomCollection {
  const pets: OwnedPet[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry?.id !== 'string' || !isKnownSpecies(entry.speciesPetId)) continue;
    if (!isUsableLevel(entry.level)) continue;
    pets.push({
      id: entry.id,
      speciesPetId: petId(entry.speciesPetId),
      level: entry.level,
      evolutionStage: evolutionStageOf(entry.evolutionStage, entry.level),
      ...(entry.nickname === undefined ? {} : { nickname: entry.nickname }),
    });
  }

  if (pets.length === 0) return seedCollection();

  // 활성 펫이 명부에서 사라졌으면 첫 마리로 되돌린다. 활성 펫이 없는 상태는 없다.
  const first = pets[0];
  if (!first) return seedCollection();
  return {
    pets,
    activePetId: pets.some((pet) => pet.id === activePetId) ? activePetId : first.id,
  };
}

/**
 * 스냅샷을 도메인 값으로 되돌린다.
 *
 * 저장 파일은 사용자 디스크에 있는 남의 손이 닿을 수 있는 데이터다. 모르는 종이나 빈
 * 명부가 들어와도 앱이 죽지 않고 **시드로 되돌아간다.** 여기서 던지면 사용자는 창이
 * 아예 안 뜨는 것만 보게 된다.
 *
 * v1 은 진화 횟수 칸이 없을 뿐 나머지 모양이 같아서 같은 경로로 읽는다. 빠진 칸은
 * `evolutionStageOf`가 레벨에서 채운다.
 */
export function fromSnapshot(snapshot: StoredRoomSnapshot | undefined): RoomCollection {
  if (!snapshot) return seedCollection();

  // 버전을 소진해 둔다. 새 버전을 추가하면 여기가 타입 오류가 나서 조용히 빠지지 않는다.
  switch (snapshot.version) {
    case 1:
    case 2:
      return collectionOf(snapshot.pets, snapshot.activePetId);
    default: {
      const exhaustive: never = snapshot;
      void exhaustive;
      return seedCollection();
    }
  }
}
