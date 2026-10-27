/**
 * 640 화면들의 공통 상단 바(동선 3단계).
 *
 * 펫룸·뽑기·합성·도감은 같은 자리에서 갈아 끼워지는 한 창이다. 위쪽 막대가 같아야 한 창으로 읽히고,
 * 어느 화면에서든 한 번에 다른 화면으로 간다. 정보·업적도 640 창의 한 화면이다(동선 4단계). 전투만 640 자리를
 * 쓰지 않고 따로 뜬다(결정 2) — 탭에 `↗`를 붙여 화면이 바뀌지 않는다는 것을 보인다.
 */

import { compactAmount, exactAmount } from './format.ts';

/** 640 자리를 나눠 쓰는 화면. */
export type ShellScreen = 'room' | 'gacha' | 'combine' | 'dex' | 'info';
/**
 * 탭. 업적은 정보 창(`info`)이 보이는 다른 화면이라 창은 따로 없다 — 정보 창이 지금 어느 화면인지 알려
 * 주면(`petto:current`) 상단 바가 그 탭을 금색으로 표시한다.
 */
export type ShellTabKey = ShellScreen | 'achievements' | 'settings' | 'battle';

export interface ShellTab {
  key: ShellTabKey;
  label: string;
  /** 지금 화면을 바꾸지 않고 따로 띄운다. */
  external: boolean;
  /** 글자 앞 아이콘. 아이콘만으로는 무엇인지 모르므로 늘 글자와 함께 쓴다. */
  icon?: string;
  /** 화면 탭 줄과 떨어뜨려 오른쪽에 둔다(설정). */
  trailing?: boolean;
}

export const SHELL_TABS: readonly ShellTab[] = [
  { key: 'room', label: '펫룸', external: false },
  { key: 'gacha', label: '뽑기', external: false },
  { key: 'combine', label: '합성', external: false },
  { key: 'dex', label: '도감', external: false },
  { key: 'info', label: '정보', external: false },
  { key: 'achievements', label: '업적', external: false },
  { key: 'battle', label: '전투', external: true },
  // 설정도 정보 창이 보이는 화면이다. 예전에는 정보 창 바닥의 작은 ⚙ 하나라 무엇인지 알기 어려웠다.
  { key: 'settings', label: '설정', external: false, icon: '⚙', trailing: true },
];

/** 메인이 주는 막대 상태. 읽지 못한 값은 `null` 이다 — 0 이나 `false` 로 바꾸지 않는다. */
export interface ShellState {
  balance: number | null;
  gachaAffordable: boolean | null;
  claimableRewardCount: number | null;
  dexHasNew: boolean | null;
}

/** 빨간 점은 색만으로 읽히지 않으므로 접근성 이름을 함께 갖는다(design.md §8). */
export interface ShellBadge {
  kind: 'dot' | 'new';
  label: string;
}

export interface ShellTabView extends ShellTab {
  current: boolean;
  badge: ShellBadge | null;
}

export interface TopBarView {
  tabs: ShellTabView[];
  token: { text: string; title: string };
}

function badgeOf(key: ShellTabKey, state: ShellState): ShellBadge | null {
  switch (key) {
    case 'gacha':
      return state.gachaAffordable === true ? { kind: 'dot', label: '뽑기 가능' } : null;
    case 'dex':
      return state.dexHasNew === true ? { kind: 'new', label: 'NEW' } : null;
    case 'achievements':
      return (state.claimableRewardCount ?? 0) > 0
        ? { kind: 'dot', label: '받을 보상 있음' }
        : null;
    default:
      return null;
  }
}

export function topBarView(current: ShellTabKey, state: ShellState): TopBarView {
  return {
    tabs: SHELL_TABS.map((tab) => ({
      ...tab,
      current: tab.key === current,
      badge: badgeOf(tab.key, state),
    })),
    token:
      state.balance === null
        ? { text: '—', title: '보유 토큰을 불러오지 못했어요' }
        : { text: compactAmount(state.balance), title: `보유 토큰 ${exactAmount(state.balance)}` },
  };
}
