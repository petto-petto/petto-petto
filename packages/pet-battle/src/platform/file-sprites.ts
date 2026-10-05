import type { PetSpecies } from '@pet/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BattlePet } from '../contracts.ts';
import type { BattlePetSprites, BattleSpritePort } from '../ports/sprites.ts';

/** Reads original shared assets at a host-injected root; never copies or modifies them. */
export class FileBattleSpriteAdapter implements BattleSpritePort {
  readonly #root: string;
  readonly #species: readonly PetSpecies[];
  readonly #cache = new Map<string, BattlePetSprites>();

  constructor(petAssetsDir: string, species: readonly PetSpecies[]) {
    this.#root = petAssetsDir;
    this.#species = species.map((entry) => ({ ...entry }));
  }

  resolve(pet: BattlePet): BattlePetSprites {
    const entry = this.#species.find((s) => s.sprite === pet.sprite && s.rarity === pet.rarity);
    if (
      !entry ||
      !/^[a-z0-9_]+$/.test(entry.sprite) ||
      !/^\d+$/.test(entry.speciesId) ||
      !['COMMON', 'RARE', 'EPIC'].includes(entry.rarity) ||
      ![0, 1, 2].includes(pet.evolutionStage)
    ) {
      throw new Error(`공통 펫 에셋 식별자를 확인할 수 없습니다: ${pet.sprite}`);
    }
    const stage = pet.evolutionStage + 1;
    const key = `${entry.speciesId}:${stage}`;
    let sprite = this.#cache.get(key);
    if (!sprite) {
      const load = (motion: 'idle' | 'attack') => {
        const base = join(
          this.#root,
          entry.rarity.toLowerCase(),
          entry.sprite,
          `stage${stage}`,
          `pet_${entry.speciesId}_s${stage}_${motion}`,
        );
        const meta: unknown = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
        if (
          typeof meta !== 'object' ||
          meta === null ||
          !('frameCount' in meta) ||
          typeof meta.frameCount !== 'number' ||
          !Number.isInteger(meta.frameCount) ||
          meta.frameCount < 1
        ) {
          throw new Error('펫 프레임 메타가 올바르지 않습니다');
        }
        return { asset: pathToFileURL(`${base}.png`).href, frameCount: meta.frameCount };
      };
      sprite = { idle: load('idle'), attack: load('attack') };
      this.#cache.set(key, sprite);
    }
    return { idle: { ...sprite.idle }, attack: { ...sprite.attack } };
  }
}
