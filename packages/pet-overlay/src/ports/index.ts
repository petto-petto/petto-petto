import type { GrowthSnapshot } from '../domain/controller.ts';
import type { PetKey } from '../domain/pets.ts';

/** 저장 구현은 앱이 소유한다. 프로토타입 localStorage를 SQLite/IPC로 바꿔도 도메인은 유지된다. */
export interface GrowthStore {
  load(): Readonly<Partial<Record<PetKey, GrowthSnapshot>>>;
  save(snapshots: Readonly<Record<PetKey, GrowthSnapshot>>): void;
}

/** 다른 기능이 개체별로 읽는 저장 성장 정본. 없는 ID는 아직 성장 기록이 없다. */
export interface OwnedPetGrowthSnapshot {
  level: number;
  totalXp: number;
  evolutionStage: 0 | 1 | 2;
}

/** 성장 데이터 소유자가 제공하는 읽기 Port. 저장 실패는 예외로 전달한다. */
export interface GrowthReadClient {
  readOwnedPetGrowth(ownedPetIds: readonly string[]): ReadonlyMap<string, OwnedPetGrowthSnapshot>;
}
