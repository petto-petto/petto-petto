import { GrowthController, type GrowthResult, type GrowthSnapshot, type UsageInput } from '../domain/controller.ts';
import { createGrowthPet } from '../domain/growth.ts';
import { PETS, type PetKey } from '../domain/pets.ts';
import type { GrowthStore } from '../ports/index.ts';

/** 펫별 독립 성장 상태를 소유하는 앱 조립체. Electron과 렌더러에는 의존하지 않는다. */
export class OverlayGrowthState {
  readonly #controllers = new Map<PetKey, GrowthController>();
  readonly #store: GrowthStore;

  constructor(store: GrowthStore) {
    this.#store = store;
    const stored = store.load();
    for (const descriptor of PETS) {
      this.#controllers.set(
        descriptor.key,
        new GrowthController(createGrowthPet(descriptor.key, descriptor.name), stored[descriptor.key]),
      );
    }
  }

  growthFor(key: PetKey): GrowthController {
    const controller = this.#controllers.get(key);
    if (controller === undefined) throw new Error(`등록되지 않은 펫: ${key}`);
    return controller;
  }

  applyUsage(key: PetKey, input: UsageInput): GrowthResult {
    const result = this.growthFor(key).applyUsage(input);
    this.persist();
    return result;
  }

  addExternalXp(key: PetKey, amount: number): GrowthResult {
    const result = this.growthFor(key).addExternalXp(amount);
    this.persist();
    return result;
  }

  evolve(key: PetKey): ReturnType<GrowthController['evolve']> {
    const result = this.growthFor(key).evolve();
    this.persist();
    return result;
  }

  persist(): void {
    const snapshots = {} as Record<PetKey, GrowthSnapshot>;
    for (const descriptor of PETS) snapshots[descriptor.key] = this.growthFor(descriptor.key).snapshot();
    this.#store.save(snapshots);
  }
}
