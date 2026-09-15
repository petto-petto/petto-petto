import type { GrowthSnapshot } from '../domain/controller.ts';
import type { PetKey } from '../domain/pets.ts';

/** 저장 구현은 앱이 소유한다. 프로토타입 localStorage를 SQLite/IPC로 바꿔도 도메인은 유지된다. */
export interface GrowthStore {
  load(): Readonly<Partial<Record<PetKey, GrowthSnapshot>>>;
  save(snapshots: Readonly<Record<PetKey, GrowthSnapshot>>): void;
}
