/**
 * 첫 실행 지원과 활성 펫 보정.
 *
 * ## 첫 실행
 *
 * 새 사용자에게 펫을 그냥 주지 않는다. 뽑기 1회분 재화를 주고 뽑기 화면으로 보낸다 —
 * 첫 펫을 뽑는 경험 자체가 제품의 시작점이다.
 *
 * "첫 실행"을 따로 기록하지 않는다. `grantOnce` 의 멱등 키가 곧 마커다. 앱을 몇 번 켜든
 * 지급도 안내도 한 번뿐이고, 플래그를 따로 두면 그 값과 실제 지급 여부가 어긋날 수 있다.
 *
 * ## 활성 펫 보정
 *
 * 뽑기와 합성은 비활성 개체를 만든다. 명부에 개체가 있는데 아무도 활성이 아니면 `PetClient`
 * 의 `getActivePet()` 이 계속 null 이라, 그 값을 읽는 쪽(meta 정보 화면)이 펫을 못 찾는다.
 */

import type { PetClient, TokenClient } from '@pet/client';

/** 뽑기 1회 비용. `@pet/gacha` 의 `count * 100_000` 과 같아야 한다. */
export const FIRST_DRAW_GRANT = 100_000;

const FIRST_DRAW_KEY = 'starter:first-draw';

export type StarterOutcome =
  /** 처음 온 사용자다. 재화를 줬으니 뽑기 화면으로 보낸다. */
  | { kind: 'granted'; amount: number }
  /** 이미 받은 적이 있다. */
  | { kind: 'already_granted' };

/** 첫 실행이면 뽑기 1회분을 지급한다. 화면을 여는 일은 호출자가 한다. */
export function grantFirstDrawCurrency(tokens: TokenClient): StarterOutcome {
  const granted = tokens.grantOnce(FIRST_DRAW_KEY, FIRST_DRAW_GRANT, '첫 뽑기 지원');
  return granted ? { kind: 'granted', amount: FIRST_DRAW_GRANT } : { kind: 'already_granted' };
}

export type ActivePetOutcome =
  { kind: 'activated'; ownedPetId: string } | { kind: 'already_active' } | { kind: 'no_pets' };

/**
 * 활성 펫이 없으면 보유한 첫 개체를 활성화한다.
 *
 * 앱 시작과 보유 펫이 바뀐 직후에 모두 불린다. 시작할 때만 보정하면 첫 뽑기를 하고도
 * 앱을 다시 켤 때까지 활성 펫이 없는 채로 남는다. 이미 고른 펫은 건드리지 않는다.
 */
export function ensureActivePet(pets: PetClient): ActivePetOutcome {
  if (pets.getActivePet() !== null) return { kind: 'already_active' };
  const [first] = pets.listOwnedPets();
  if (!first) return { kind: 'no_pets' };
  pets.setActivePet(first.ownedPetId);
  return { kind: 'activated', ownedPetId: first.ownedPetId };
}
