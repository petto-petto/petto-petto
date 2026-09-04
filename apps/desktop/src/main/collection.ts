/**
 * `@pet/room` → `@pet/meta`의 `CollectionPort` 어댑터.
 *
 * ## 왜 앱에 있는가
 *
 * `CollectionPort`는 **meta가 요구하는 인터페이스**이고(`@pet/meta`의 `ports/index.ts`
 * 참조), `@pet/room`은 그 인터페이스를 알지 못한다. 둘 다 상대를 모르는 채로 두고,
 * 잇는 일은 앱이 한다. 그래야 `@pet/room`이 meta를 의존하지 않는다.
 *
 * ## 이 파일이 대체하는 것
 *
 * 그 전까지 `MetaAppState`는 **테스트 대역인 `InMemoryCollection`을 프로덕션에서 그대로
 * 쓰고 있었다.** 오버레이 펫이 star_wizard Lv.21로 고정, 보유 펫 수가 상수 3, 도감이
 * 3/24로 박혀 있었다. 이제 실제 명부에서 나온다.
 *
 * 규칙은 한 줄도 여기 없다 — 전부 `@pet/room`의 도메인 함수를 부르고 모양만 바꾼다.
 */

import type { CollectionPort, DexProgress, PetSummary, TrophyPlacement } from '@pet/meta';
import { activePet, discoveredSpeciesCount, speciesOf, type RoomCollection } from '@pet/room';

/**
 * 도감 슬롯 수.
 *
 * 기획서 MVP 목표 종 수다. 지금 수록된 종(6)보다 크고, 미확보 칸은 도감 화면이 실루엣으로
 * 채운다. 수록 종 수로 계산하면 "다 모았다"가 항상 참이 되어 진행도가 의미를 잃는다.
 */
export const PET_DEX_SLOT_COUNT = 20;

/**
 * 명부를 들고 meta의 조회에 답한다.
 *
 * 명부 자체는 `RoomState`가 소유하고, 여기서는 **읽기만** 한다. 활성 펫이 바뀌면
 * `RoomState`가 `update`로 새 명부를 밀어 넣는다 — 두 곳이 각자 명부를 들고 있으면
 * 진실의 원천이 둘로 쪼개진다.
 */
export class RoomCollectionPort implements CollectionPort {
  #collection: RoomCollection;
  /** 룸의 남은 빈자리 수. 트로피 배치는 아직 도메인이 없어 여기서 센다. */
  #roomSlots = 1;
  #trophies: { achievementId: string; placement: TrophyPlacement }[] = [];

  constructor(collection: RoomCollection) {
    this.#collection = collection;
  }

  update(collection: RoomCollection): void {
    this.#collection = collection;
  }

  /** 기획서 5.1: 프로필 펫은 별도 설정값이 아니라 지금 오버레이에 떠 있는 펫이다. */
  overlayPet(): PetSummary {
    const pet = activePet(this.#collection);
    const species = speciesOf(pet.speciesPetId);
    return {
      petId: species.petId,
      name: pet.nickname ?? species.name,
      level: pet.level,
      rarity: species.rarity,
      // 스프라이트 식별자는 slug다. 실제 경로는 그리는 쪽이 조립한다.
      sprite: species.slug,
    };
  }

  ownedPetCount(): number {
    return this.#collection.pets.length;
  }

  dexProgress(): DexProgress {
    // 마리 수가 아니라 **종** 수다. 같은 종을 여러 마리 가져도 도감은 한 칸이다.
    return { owned: discoveredSpeciesCount(this.#collection), total: PET_DEX_SLOT_COUNT };
  }

  /**
   * 기획서 7.4: 자동 배치는 첫 빈자리에만 시도하고, 실패하면 보관함으로 간다.
   *
   * 트로피 도메인은 아직 없다. 배치 실패가 **지급 실패가 되지 않는다**는 규칙만 지키고,
   * 실제 룸 배치는 트로피 담당이 오면 그쪽으로 넘긴다.
   */
  grantTrophy(achievementId: string, autoPlace: boolean): TrophyPlacement {
    let placement: TrophyPlacement = 'storage';
    if (autoPlace && this.#roomSlots > 0) {
      this.#roomSlots -= 1;
      placement = 'room';
    }
    this.#trophies.push({ achievementId, placement });
    return placement;
  }
}
