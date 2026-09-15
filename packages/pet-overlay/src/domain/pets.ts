import { PETS, type PetDescriptor, type PetKey } from '../pets/renderer-catalog.generated.ts';

export { PETS, type PetDescriptor, type PetKey };

export type SpriteMotion = 'idle' | 'click' | 'click2' | 'attack';

export const DEFAULT_PET_KEY: PetKey = PETS[0].key;

export function petByKey(key: PetKey): PetDescriptor {
  const found = PETS.find((pet) => pet.key === key);
  if (found === undefined) throw new Error(`등록되지 않은 펫: ${key}`);
  return found;
}

/** 성장의 0/1/2 진화 단계와 에셋 디렉터리 stage1/2/3을 연결한다. */
export function stageForEvolution(evolutionStage: number): 1 | 2 | 3 {
  if (evolutionStage <= 0) return 1;
  if (evolutionStage === 1) return 2;
  return 3;
}

/** 프레임 크기는 이 경로의 JSON 메타데이터에서 읽는다. 32px로 추측하면 안 된다. */
export function spritePath(key: PetKey, stage: 1 | 2 | 3, motion: SpriteMotion): string {
  const pet = petByKey(key);
  const grade = pet.grade.toLowerCase();
  return `assets/pets/${grade}/${pet.slug}/stage${stage}/pet_${pet.petId}_s${stage}_${motion}.png`;
}

export function spriteMetaPath(key: PetKey, stage: 1 | 2 | 3, motion: SpriteMotion): string {
  return spritePath(key, stage, motion).replace(/\.png$/, '.json');
}

export interface SpriteMotionMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
}

export function frameIndex(meta: SpriteMotionMeta, elapsedMs: number): number {
  const advanced = Math.max(0, Math.floor(elapsedMs / (1_000 / meta.fps)));
  return meta.loop ? advanced % meta.frameCount : Math.min(advanced, meta.frameCount - 1);
}

/** 캔버스 크기에 맞는 정수 배율만 허용한다. */
export function integerSpriteScale(meta: SpriteMotionMeta, availablePixels: number): number {
  return Math.max(1, Math.floor(availablePixels / meta.frameWidth));
}
