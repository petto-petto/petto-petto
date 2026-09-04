import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, '..');
const rendererPetsDirectory = resolve(packageRoot, '../../apps/desktop/renderer/assets/pets');
const outputPath = join(packageRoot, 'src/pets/renderer-catalog.generated.ts');
const motions = ['idle', 'click', 'click2', 'attack'];

const pets = [];
const spriteMeta = {};

for (const gradeDirectory of directoryNames(rendererPetsDirectory)) {
  const grade = gradeDirectory.toUpperCase();
  for (const slug of directoryNames(join(rendererPetsDirectory, gradeDirectory))) {
    const petDirectory = join(rendererPetsDirectory, gradeDirectory, slug);
    const descriptor = readJson(join(petDirectory, 'pet.json'));
    const petId = requiredString(descriptor.petId, `${slug}.petId`);
    const name = requiredString(descriptor.name, `${slug}.name`);
    const declaredGrade = requiredString(descriptor.grade, `${slug}.grade`);
    const stageCount = requiredInteger(descriptor.stageCount, `${slug}.stageCount`);
    if (declaredGrade !== grade) throw new Error(`${slug}의 grade 디렉터리와 pet.json이 다릅니다.`);

    pets.push({ key: slug, petId, slug, grade, name });
    for (let stage = 1; stage <= stageCount; stage += 1) {
      for (const motion of motions) {
        const filename = `pet_${petId}_s${stage}_${motion}.json`;
        const metadata = readJson(join(petDirectory, `stage${stage}`, filename));
        spriteMeta[`${petId}:${stage}:${motion}`] = {
          fw: requiredInteger(metadata.frameWidth, `${filename}.frameWidth`),
          fh: requiredInteger(metadata.frameHeight, `${filename}.frameHeight`),
          n: requiredInteger(metadata.frameCount, `${filename}.frameCount`),
          fps: requiredInteger(metadata.fps, `${filename}.fps`),
          loop: requiredBoolean(metadata.loop, `${filename}.loop`),
        };
      }
    }
  }
}

if (pets.length === 0) throw new Error('renderer 펫 에셋을 찾지 못했습니다.');

const rawSource =
  `// AUTO-GENERATED from apps/desktop/renderer/assets/pets. Do not edit manually.\n\n` +
  `export const PETS = ${JSON.stringify(pets, null, 2)} as const;\n\n` +
  `export const SPRITE_META = ${JSON.stringify(spriteMeta, null, 2)} as const;\n\n` +
  `export type PetKey = (typeof PETS)[number]['key'];\n` +
  `export type PetDescriptor = (typeof PETS)[number];\n`;

const source = await format(rawSource, {
  parser: 'typescript',
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
});
writeFileSync(outputPath, source);

function directoryNames(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`객체 JSON이 필요합니다: ${path}`);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`문자열이 필요합니다: ${name}`);
  return value;
}

function requiredInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`양의 정수가 필요합니다: ${name}`);
  return value;
}

function requiredBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`boolean이 필요합니다: ${name}`);
  return value;
}
