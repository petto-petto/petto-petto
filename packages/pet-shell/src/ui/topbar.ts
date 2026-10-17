/**
 * 상단 바를 그린다. 화면은 `<header class="petto-topbar" data-current="gacha">`를 두고 이 모듈을
 * 읽기만 한다. 탭 구성과 배지 규칙은 `tabs.ts`, 잔액과 배지 값은 메인이 준다(`window.shell`).
 *
 * 화면이 연출 중이면 `document`에 `petto:busy` 이벤트(`detail: true | false`)를 보낸다. 그동안 탭과
 * 닫기를 막는다 — 저장이 끝나기 전에 창이 바뀌거나 닫히면 결과를 보지 못한다.
 */

import { SHELL_TABS, topBarView, type ShellState, type ShellTabKey } from '../tabs.ts';

export interface ShellBridge {
  state(): Promise<ShellState>;
  open(key: ShellTabKey): Promise<unknown>;
  /** 잔액·배지가 바뀌었을 수 있다는 알림. 해제 함수를 돌려준다. */
  onChanged(listener: () => void): () => void;
}

declare global {
  interface Window {
    shell?: ShellBridge;
  }
}

const UNREAD: ShellState = {
  balance: null,
  gachaAffordable: null,
  claimableRewardCount: null,
  dexHasNew: null,
};

function isTab(value: unknown): value is ShellTabKey {
  return SHELL_TABS.some((tab) => tab.key === value);
}

export function mountTopBar(host: HTMLElement, bridge: ShellBridge | undefined): void {
  const initial = host.dataset['current'];
  if (!isTab(initial)) throw new Error(`상단 바의 현재 화면을 알 수 없습니다: ${String(initial)}`);
  let current: ShellTabKey = initial;

  let state: ShellState = UNREAD;
  /** 처음 읽기 전에는 칩을 비워 둔다. `—`는 읽지 못했다는 뜻이라 읽는 중과 섞지 않는다. */
  let loaded = false;
  let busy = false;

  const nav = document.createElement('nav');
  nav.className = 'petto-tabs';
  nav.setAttribute('aria-label', '화면');
  const token = document.createElement('span');
  token.className = 'petto-token';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'petto-close';
  close.setAttribute('aria-label', '창 닫기');
  close.textContent = '×';
  close.addEventListener('click', () => {
    if (!busy) window.close();
  });
  host.replaceChildren(nav, token, close);

  const render = (): void => {
    const view = topBarView(current, state);
    nav.replaceChildren(
      ...view.tabs.map((tab) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `petto-tab${tab.current ? ' current' : ''}`;
        button.dataset['key'] = tab.key;
        button.disabled = busy && !tab.current;
        if (tab.current) button.setAttribute('aria-current', 'page');
        if (tab.trailing) button.classList.add('trailing');
        const label = document.createElement('span');
        const text = tab.external ? `${tab.label} ↗` : tab.label;
        label.textContent = tab.icon ? `${tab.icon}\uFE0E ${text}` : text;
        button.append(label);
        if (tab.badge) {
          const badge = document.createElement('span');
          badge.className = `petto-badge petto-badge--${tab.badge.kind}`;
          badge.textContent = tab.badge.kind === 'new' ? tab.badge.label : '';
          button.append(badge);
        }
        const name = [tab.label, tab.external ? '새 창' : '', tab.badge?.label ?? '']
          .filter((part) => part !== '')
          .join(' · ');
        button.setAttribute('aria-label', name);
        button.addEventListener('click', () => {
          if (busy || tab.current) return;
          void bridge?.open(tab.key);
        });
        return button;
      }),
    );
    token.textContent = loaded ? view.token.text : '';
    token.title = loaded ? view.token.title : '';
    close.disabled = busy;
  };

  const refresh = async (): Promise<void> => {
    if (!bridge) return;
    try {
      state = await bridge.state();
    } catch {
      state = UNREAD;
    }
    loaded = true;
    render();
  };

  // 한 창이 여러 탭을 보이는 경우(정보 창의 정보·업적) 창이 지금 탭을 알려 준다.
  document.addEventListener('petto:current', (event) => {
    const next = (event as CustomEvent<unknown>).detail;
    if (!isTab(next) || next === current) return;
    current = next;
    render();
  });
  document.addEventListener('petto:busy', (event) => {
    busy = (event as CustomEvent<unknown>).detail === true;
    render();
  });
  window.addEventListener('focus', () => void refresh());
  bridge?.onChanged(() => void refresh());
  render();
  void refresh();
}

const host = document.querySelector<HTMLElement>('.petto-topbar');
if (host) mountTopBar(host, window.shell);
