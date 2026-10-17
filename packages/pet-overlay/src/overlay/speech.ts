/**
 * 오버레이 펫 머리 위 말풍선의 순서(동선 2단계 A·C).
 *
 * 말풍선은 한 번에 하나다. 펫 하나에 말풍선이 겹치면 어느 버튼이 무엇인지 읽을 수 없다. 무엇을
 * 먼저 보일지는 이 파일이 정하고, 컴포넌트는 그리기만 한다.
 */

/** 메타가 1분 집계 뒤 보내는 알림 한 건(`usage:aggregated`의 `bubbles`). */
export interface Notice {
  kind: 'achievement' | 'gacha-ready';
  text: string;
}

/** 첫 펫 우클릭 안내. 한 번 닫으면 다시 보이지 않는다. */
export const MENU_HINT_TEXT = '반가워! 나를 우클릭하면 펫룸이랑 뽑기로 데려다줄게.';

/** 안내를 본 적이 있는지 기억하는 `localStorage` 키. 지워지면 안내를 한 번 더 볼 뿐이다. */
export const MENU_HINT_STORAGE_KEY = 'petto.overlay.menuHintSeen';

const NOTICE_ORDER: Readonly<Record<Notice['kind'], number>> = {
  // 업적 보상을 받아야 잔액이 오르는 경우가 흔해서 업적이 먼저다.
  achievement: 0,
  'gacha-ready': 1,
};

/** 기다리는 알림에 새 알림을 더한다. 같은 종류는 마지막 것 하나만 남긴다. */
export function enqueueNotices(queue: readonly Notice[], incoming: readonly Notice[]): Notice[] {
  const latest = new Map<Notice['kind'], Notice>();
  for (const notice of [...queue, ...incoming]) latest.set(notice.kind, notice);
  return [...latest.values()].sort((a, b) => NOTICE_ORDER[a.kind] - NOTICE_ORDER[b.kind]);
}

export interface SpeechInput {
  menuOpen: boolean;
  menuHintPending: boolean;
  evolutionAvailable: boolean;
  notices: readonly Notice[];
}

export type Speech =
  { kind: 'menu-hint' } | { kind: 'evolve' } | { kind: 'notice'; notice: Notice };

/**
 * 지금 보일 말풍선. 메뉴가 열리면 모두 비킨다(메뉴와 같은 자리다).
 *
 * 첫 안내가 가장 먼저다 — 메뉴를 알아야 나머지 말풍선의 목적지도 다시 찾아갈 수 있다. 진화는 알림보다
 * 앞선다. 진화 말풍선은 진화할 때까지 남는 것이 규칙이라(`EvolveBubble`), 알림이 그 자리를 빼앗으면
 * 진화를 놓친다.
 */
export function currentSpeech(input: SpeechInput): Speech | null {
  if (input.menuOpen) return null;
  if (input.menuHintPending) return { kind: 'menu-hint' };
  if (input.evolutionAvailable) return { kind: 'evolve' };
  const notice = input.notices[0];
  return notice ? { kind: 'notice', notice } : null;
}
