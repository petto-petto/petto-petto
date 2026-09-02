import type { GrowthView } from '../domain/controller.ts';
import { petByKey, stageForEvolution, spritePath, type PetKey } from '../domain/pets.ts';

/** 렌더러가 필요한 오버레이 값. 실제 DOM/Canvas/Electron 구현은 이 패키지 밖 어댑터가 맡는다. */
export interface OverlayView {
  petKey: PetKey;
  name: string;
  level: number;
  levelProgress: number;
  tokensUntilNextXp: number;
  evolutionAvailable: boolean;
  stage: 1 | 2 | 3;
  idleSpritePath: string;
}

export function overlayView(petKey: PetKey, growth: GrowthView): OverlayView {
  const descriptor = petByKey(petKey);
  const stage = stageForEvolution(growth.pet.evolutionStage);
  return {
    petKey,
    name: descriptor.name,
    level: growth.pet.level,
    levelProgress: growth.levelProgress,
    tokensUntilNextXp: growth.tokensUntilNextXp,
    evolutionAvailable: growth.pet.evolutionAvailable,
    stage,
    idleSpritePath: spritePath(petKey, stage, 'idle'),
  };
}
