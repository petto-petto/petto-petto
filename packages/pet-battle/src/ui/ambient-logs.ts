import type { BattleLayout } from '../view/layout.ts';
import { AmbientLogFeed, ambientLogLayout, type AmbientSide } from '../view/ambient-logs.ts';

interface FeedView {
  feed: AmbientLogFeed;
  panel: HTMLElement;
  list: HTMLOListElement;
  context: string | null;
}

export class AmbientLogsView {
  readonly #views: Record<AmbientSide, FeedView>;

  constructor(root: HTMLElement) {
    const create = (side: AmbientSide): FeedView => {
      const panel = root.querySelector<HTMLElement>(`[data-ambient-side="${side}"]`);
      const list = panel?.querySelector('ol');
      if (!panel || !list) throw new Error(`battle ambient log element missing: ${side}`);
      return { feed: new AmbientLogFeed(side), panel, list, context: null };
    };
    this.#views = { PET: create('PET'), ENEMY: create('ENEMY') };
  }

  update(options: {
    layout: BattleLayout;
    now: number;
    petId: string | null;
    enemyKey: string;
    enemyVisible: boolean;
    hasDefeatedSpectators: boolean;
    pageVisible: boolean;
    menuOpen: boolean;
    opacity: number;
  }): void {
    const geometry = ambientLogLayout(options.layout, options.hasDefeatedSpectators);
    for (const side of ['PET', 'ENEMY'] as const) {
      const view = this.#views[side];
      const context = side === 'PET' ? options.petId : `${options.petId}:${options.enemyKey}`;
      if (view.context !== context) {
        view.context = context;
        view.feed.reset();
        view.list.replaceChildren();
      }
      const visible =
        geometry.visible &&
        options.petId !== null &&
        (side === 'PET' || options.enemyVisible) &&
        !options.menuOpen &&
        options.pageVisible;
      view.panel.hidden = !visible;
      view.panel.style.left = `${side === 'PET' ? geometry.petX : geometry.enemyX}px`;
      view.panel.style.top = `${geometry.top}px`;
      view.panel.style.width = `${geometry.width}px`;
      view.panel.style.height = `${geometry.height}px`;
      view.panel.style.opacity = String(options.opacity);
      if (!view.feed.tick(options.now, visible)) continue;
      const ids = new Set(view.feed.entries.map((entry) => String(entry.id)));
      for (const child of Array.from(view.list.children)) {
        if (!ids.has((child as HTMLElement).dataset['logId'] ?? '')) child.remove();
      }
      const latest = view.feed.entries.at(-1)!;
      const item = document.createElement('li');
      item.dataset['logId'] = String(latest.id);
      item.className = 'ambient-log-entry';
      item.textContent = latest.text;
      view.list.append(item);
    }
  }
}
