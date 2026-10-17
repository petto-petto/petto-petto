/**
 * 펫 우클릭 메뉴의 항목과 배지(동선 2단계 B).
 *
 * 합성·도감은 펫룸에서 간다. 메뉴는 자주 가는 곳의 바로가기라 네 개로 줄인다.
 */

export type MenuKey = 'room' | 'gacha' | 'battle' | 'info';

export interface MenuItem {
  key: MenuKey;
  label: string;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  { key: 'room', label: '펫룸' },
  { key: 'gacha', label: '뽑기' },
  { key: 'battle', label: '전투' },
  { key: 'info', label: '정보' },
];

/** 메인이 주는 배지 재료. 읽지 못한 값은 `null` 이다(`overlay:menu-state`). */
export interface MenuState {
  gachaAffordable: boolean | null;
  claimableRewardCount: number | null;
}

export interface MenuBadges {
  gacha: string | null;
  info: string | null;
}

/** 할 수 있는 일이 있을 때만 배지를 단다. 모르는 값은 "없음"으로 그리지 않고 아예 그리지 않는다. */
export function menuBadges(state: MenuState | null): MenuBadges {
  const count = state?.claimableRewardCount ?? 0;
  return {
    gacha: state?.gachaAffordable === true ? '가능' : null,
    info: count > 0 ? `보상 ${count}` : null,
  };
}

/** 받을 보상이 있으면 정보 팻말이 바로 업적 화면을 연다. */
export function infoScreenFor(state: MenuState | null): 'info' | 'achievements' {
  return (state?.claimableRewardCount ?? 0) > 0 ? 'achievements' : 'info';
}
