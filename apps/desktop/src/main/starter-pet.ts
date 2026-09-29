/**
 * 임시 초기 펫 지급.
 *
 * ## 왜 필요한가
 *
 * `PetClient` 는 종류 6종만 등록하고 **개체는 주지 않는다**(`docs/pet-client-handoff.md`).
 * 그래서 새 설치에는 보유 펫이 0마리, 활성 펫이 `null` 이다. 오버레이가 그릴 대상도,
 * meta 정보 화면이 읽을 펫도 없다.
 *
 * ## 임시인 이유
 *
 * 초기 지급은 기획 결정이다 — 설치할 때 한 마리를 주는지, 첫 뽑기로만 얻는지, 어떤 등급을
 * 주는지가 정해지지 않았다. 그때까지 COMMON 한 종을 무작위로 한 마리 준다.
 * **규칙이 정해지면 이 파일을 지운다.**
 */

import type { PetClient } from '@pet/client';

/** 0 이상 `count` 미만의 정수를 고른다. 테스트가 결과를 고정할 수 있도록 주입받는다. */
export type PickIndex = (count: number) => number;

export type StarterPetOutcome =
  | { kind: 'granted'; ownedPetId: string; speciesId: string }
  | { kind: 'activated'; ownedPetId: string }
  | { kind: 'already_ready' }
  | { kind: 'no_species' };

/**
 * 보유 펫이 없으면 한 마리를 지급하고, 있는데 활성 펫만 없으면 첫 개체를 활성화한다.
 *
 * 두 경우를 함께 다루는 이유: 뽑기로 받은 개체는 비활성 상태로 생기므로, 지급만으로는
 * 활성 펫이 `null` 인 상태가 그대로 남는다. 오버레이에는 둘 다 "그릴 펫이 없음"이다.
 */
export function ensureStarterPet(pets: PetClient, pick: PickIndex): StarterPetOutcome {
  if (pets.countOwnedPets() === 0) {
    const candidates = pets.listSpecies('COMMON');
    if (candidates.length === 0) return { kind: 'no_species' };
    const species = candidates[clampIndex(pick(candidates.length), candidates.length)];
    if (!species) return { kind: 'no_species' };

    const [granted] = pets.createOwnedPets([species.speciesId]);
    if (!granted) return { kind: 'no_species' };
    pets.setActivePet(granted.ownedPetId);
    return { kind: 'granted', ownedPetId: granted.ownedPetId, speciesId: species.speciesId };
  }

  if (pets.getActivePet() !== null) return { kind: 'already_ready' };

  const [first] = pets.listOwnedPets();
  if (!first) return { kind: 'already_ready' };
  pets.setActivePet(first.ownedPetId);
  return { kind: 'activated', ownedPetId: first.ownedPetId };
}

/** 주입된 함수가 범위를 벗어난 값을 줘도 목록 밖을 가리키지 않게 한다. */
function clampIndex(value: number, count: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return value >= count ? count - 1 : value;
}
