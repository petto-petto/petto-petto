import { PETS, SPRITE_META } from './renderer-catalog.generated.ts';

export { PETS, SPRITE_META };
export type { PetDescriptor, PetKey } from './renderer-catalog.generated.ts';

export const DEFAULT_PET_KEY = PETS[0].key;
export const MOTIONS = ['idle', 'click', 'click2', 'attack'] as const;

export function getPet(key: string) {
  return PETS.find((pet) => pet.key === key) ?? PETS[0];
}

export function stageForEvolution(evolutionStage: number): 1 | 2 | 3 {
  return Math.min(3, Math.max(1, evolutionStage + 1)) as 1 | 2 | 3;
}

export function spritePng(
  pet: (typeof PETS)[number],
  stage: number,
  motion: (typeof MOTIONS)[number],
): string {
  return `pets/${pet.grade.toLowerCase()}/${pet.slug}/stage${stage}/pet_${pet.petId}_s${stage}_${motion}.png`;
}

export function randomClick(): 'click' | 'click2' {
  return Math.random() < 0.5 ? 'click' : 'click2';
}
