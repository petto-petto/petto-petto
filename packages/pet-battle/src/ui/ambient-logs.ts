import type { BattleLayout } from '../view/layout.ts';
import { AmbientLogFeed, ambientLogLayout, type AmbientSide } from '../view/ambient-logs.ts';
import type { AmbientPortrait } from '../view/ambient-portraits.ts';

interface FeedView {
  feed: AmbientLogFeed;
  panel: HTMLElement;
  list: HTMLOListElement;
  context: string | null;
  portraitAsset: string | null;
}

/** A static first-frame face crop; never starts another sprite animation. */
function updatePortrait(item: HTMLElement, portrait: AmbientPortrait): void {
  const crop = item.querySelector<HTMLElement>('.ambient-portrait-crop')!;
  const image = document.createElement('img');
  crop.dataset['x'] = String(portrait.x);
  crop.dataset['y'] = String(portrait.y);
  crop.dataset['width'] = String(portrait.width);
  crop.dataset['height'] = String(portrait.height);
  crop.dataset['scale'] = String(portrait.scale);
  crop.style.width = `${portrait.width * portrait.scale}px`;
  crop.style.height = `${portrait.height * portrait.scale}px`;
  image.alt = '';
  image.draggable = false;
  image.style.height = `${portrait.frameHeight * portrait.scale}px`;
  image.style.transform = `translate(${-portrait.x * portrait.scale}px, ${-portrait.y * portrait.scale}px)`;
  image.style.visibility = 'hidden';
  // Replace immediately: a late load from the old pet must never paint its face.
  crop.replaceChildren(image);
  image.onload = () => {
    if (crop.firstElementChild === image) image.style.visibility = 'visible';
  };
  image.src = portrait.asset;
}

function dialogueEntry(id: number, text: string, portrait: AmbientPortrait): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset['logId'] = String(id);
  item.className = 'ambient-log-entry';
  const face = document.createElement('span');
  face.className = 'ambient-log-portrait';
  face.setAttribute('aria-hidden', 'true');
  const crop = document.createElement('span');
  crop.className = 'ambient-portrait-crop';
  face.append(crop);
  const bubble = document.createElement('span');
  bubble.className = 'ambient-log-text';
  bubble.textContent = text;
  item.append(face, bubble);
  updatePortrait(item, portrait);
  return item;
}

export class AmbientLogsView {
  readonly #views: Record<AmbientSide, FeedView>;

  constructor(root: HTMLElement) {
    const create = (side: AmbientSide): FeedView => {
      const panel = root.querySelector<HTMLElement>(`[data-ambient-side="${side}"]`);
      const list = panel?.querySelector('ol');
      if (!panel || !list) throw new Error(`battle ambient log element missing: ${side}`);
      return { feed: new AmbientLogFeed(side), panel, list, context: null, portraitAsset: null };
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
    petPortrait: AmbientPortrait;
    enemyPortrait: AmbientPortrait;
  }): void {
    const geometry = ambientLogLayout(options.layout, options.hasDefeatedSpectators);
    for (const side of ['PET', 'ENEMY'] as const) {
      const view = this.#views[side];
      const portrait = side === 'PET' ? options.petPortrait : options.enemyPortrait;
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
      if (view.portraitAsset !== portrait.asset) {
        view.portraitAsset = portrait.asset;
        for (const child of Array.from(view.list.children)) {
          updatePortrait(child as HTMLElement, portrait);
        }
      }
      if (!view.feed.tick(options.now, visible)) continue;
      const ids = new Set(view.feed.entries.map((entry) => String(entry.id)));
      for (const child of Array.from(view.list.children)) {
        if (!ids.has((child as HTMLElement).dataset['logId'] ?? '')) child.remove();
      }
      const latest = view.feed.entries.at(-1)!;
      view.list.append(dialogueEntry(latest.id, latest.text, portrait));
    }
  }
}
