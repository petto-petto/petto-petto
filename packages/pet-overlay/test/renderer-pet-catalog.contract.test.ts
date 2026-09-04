import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PETS, SPRITE_META } from '../src/pets/renderer-catalog.generated.ts';

interface RendererPetJson {
  petId: string;
  slug: string;
  name: string;
  grade: string;
  stageCount: number;
}

interface MotionJson {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
}

const packageRoot = dirname(fileURLToPath(import.meta.url));
const rendererPetsRoot = join(
  packageRoot,
  '..',
  '..',
  '..',
  'apps',
  'desktop',
  'renderer',
  'assets',
  'pets',
);
const motions = ['idle', 'click', 'click2', 'attack'];

test('생성 카탈로그는 renderer 펫 JSON과 모션 메타를 그대로 반영한다', () => {
  const expectedPets: Array<{
    key: string;
    petId: string;
    slug: string;
    grade: string;
    name: string;
  }> = [];
  const expectedMeta: Record<string, unknown> = {};

  for (const gradeDirectory of directoryNames(rendererPetsRoot)) {
    for (const slug of directoryNames(join(rendererPetsRoot, gradeDirectory))) {
      const petDirectory = join(rendererPetsRoot, gradeDirectory, slug);
      const pet = readJson<RendererPetJson>(join(petDirectory, 'pet.json'));
      expectedPets.push({
        key: slug,
        petId: pet.petId,
        slug: pet.slug,
        grade: pet.grade,
        name: pet.name,
      });
      for (let stage = 1; stage <= pet.stageCount; stage += 1) {
        for (const motion of motions) {
          const metadata = readJson<MotionJson>(
            join(petDirectory, `stage${stage}`, `pet_${pet.petId}_s${stage}_${motion}.json`),
          );
          expectedMeta[`${pet.petId}:${stage}:${motion}`] = {
            fw: metadata.frameWidth,
            fh: metadata.frameHeight,
            n: metadata.frameCount,
            fps: metadata.fps,
            loop: metadata.loop,
          };
        }
      }
    }
  }

  assert.deepEqual(PETS, expectedPets);
  assert.deepEqual(SPRITE_META, expectedMeta);
});

function directoryNames(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
