// 펫 도감 창.
//
// 규칙은 여기 없다. 슬롯 상태·진행도·문구는 전부 main 이 `dexView`로 만든 화면 모델에서 오고,
// 이 파일은 그것을 DOM 과 캔버스에 옮기고 입력을 IPC 로 넘기기만 한다.
//
// 스프라이트는 모두 캔버스에 그린다. `file:` 이미지는 캔버스를 오염시켜 픽셀을 읽을 수 없지만,
// 실루엣은 픽셀을 읽지 않고 `source-in` 합성으로 칠하므로 상관없다.

import {
  initialSelection,
  unwrapDexResponse,
  type DexBridge,
  type DexSlotView,
  type DexSpriteRef,
  type DexTabView,
  type DexView,
} from '../index.ts';

declare global {
  interface Window {
    dex?: DexBridge;
  }
}

interface SpriteMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
}

const SILHOUETTE = '#2C2438';
const SLOT_SCALE = 2;
/** 상세 무대 크기. 32px 프레임은 2배, 48px 프레임은 1배로 들어간다. */
const SHOWCASE_BOX = 64;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const assetRoot = assetRootUrl();
const asset = (path: string): string => new URL(path, assetRoot).href;

const grid = element<HTMLElement>('grid');
const tabsEl = element<HTMLElement>('tabs');
const errorEl = element<HTMLElement>('error');
const errorMessage = element<HTMLElement>('error-message');
const detailEmpty = element<HTMLElement>('detail-empty');
const detailBody = element<HTMLElement>('detail-body');
const showcase = element<HTMLCanvasElement>('showcase');
const detailName = element<HTMLElement>('detail-name');
const detailNumber = element<HTMLElement>('detail-number');
const detailGrade = element<HTMLElement>('detail-grade');
const detailOwned = element<HTMLElement>('detail-owned');
const detailMet = element<HTMLElement>('detail-met');
const evolution = element<HTMLElement>('evolution');
const hints = element<HTMLUListElement>('hints');
const detailAction = element<HTMLButtonElement>('detail-action');
const detailActionError = element<HTMLElement>('detail-action-error');

/** 창 하나가 들고 있는 전부. 정본은 main 의 `PetClient`다. */
const dex: {
  view: DexView | null;
  tab: DexTabView['key'];
  selectedId: string | null;
  /** 확인 저장을 보낸 종. 응답 전에 같은 요청을 다시 보내지 않는다. */
  marking: Set<string>;
  /** 마지막으로 그린 그리드와 상세 무대. 같으면 다시 만들지 않는다(깜박임·첫 클릭 유실 방지). */
  gridKey: string;
  showcaseKey: string;
  /** 마지막으로 그린 진화 썸네일·힌트. 같으면 다시 만들지 않는다. */
  detailKey: string;
  /** NEW 팝을 이미 보여 준 종. 그리드를 다시 만들어도 같은 표식을 또 튀기지 않는다. */
  popped: Set<string>;
} = {
  view: null,
  tab: 'ALL',
  selectedId: null,
  marking: new Set(),
  gridKey: '',
  showcaseKey: '',
  detailKey: '',
  popped: new Set(),
};

document.querySelector('.window-close')?.addEventListener('click', () => window.close());
document.querySelector('.window-back')?.addEventListener('click', () => {
  void bridge().backToRoom();
});
element<HTMLButtonElement>('error-retry').addEventListener('click', () => void load());
detailAction.addEventListener('click', () => void runDetailAction());
grid.addEventListener('keydown', moveFocus);
// 다른 창에서 뽑기·합성을 했으면 돌아올 때 새로 읽는다.
window.addEventListener('focus', () => void load());

void load();

async function load(): Promise<void> {
  try {
    const view = unwrapDexResponse(await bridge().load());
    dex.view = view;
    errorEl.hidden = true;
    grid.hidden = false;
    // 처음 열면 NEW 나 발견한 칸을 고른다. 아무것도 못 만났으면 상세 자리에 안내만 둔다.
    if (dex.selectedId === null) dex.selectedId = initialSelection(view);
    render();
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown): void {
  dex.view = null;
  dex.gridKey = '';
  dex.showcaseKey = '';
  dex.detailKey = '';
  // 이전 슬롯의 상세와 버튼이 남지 않게 상세 본문도 숨긴다.
  detailBody.hidden = true;
  detailEmpty.hidden = true;
  grid.hidden = true;
  errorEl.hidden = false;
  errorMessage.textContent = `도감을 불러오지 못했어요 — ${messageOf(error)}`;
  renderProgress(null);
  tabsEl.replaceChildren();
}

function render(): void {
  const view = dex.view;
  if (!view) return;
  renderProgress(view);
  renderTabs(view);
  renderGrid(view);
  renderDetail();
}

/* ---------- 머리줄 ---------- */

function renderProgress(view: DexView | null): void {
  element('progress-count').textContent = view
    ? `${view.progress.found} / ${view.progress.total}`
    : '— / —';
  element('progress-percent').textContent = view ? `${view.progress.percent}%` : '—';
  element('progress-fill').style.width = view ? `${view.progress.percent}%` : '0';
}

function renderTabs(view: DexView): void {
  tabsEl.replaceChildren(
    ...view.tabs.map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dex-tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.key === dex.tab));
      const label = tab.key === 'ALL' ? '전체' : tab.key;
      const count = document.createElement('strong');
      count.textContent = ` ${tab.found}/${tab.total}`;
      button.append(label, count);
      button.addEventListener('click', () => {
        dex.tab = tab.key;
        const visible = visibleSlots(view);
        if (!visible.some((slot) => slot.speciesId === dex.selectedId)) {
          dex.selectedId = visible[0]?.speciesId ?? null;
        }
        render();
      });
      return button;
    }),
  );
}

/* ---------- 그리드 ---------- */

function visibleSlots(view: DexView): DexSlotView[] {
  return view.sections
    .filter((section) => dex.tab === 'ALL' || section.rarity === dex.tab)
    .flatMap((section) => section.slots);
}

function renderGrid(view: DexView): void {
  // 화면 모델이 그대로면 버튼을 갈아 끼우지 않고 선택 표시만 바꾼다. focus 마다 다시 읽으므로,
  // 매번 새로 만들면 캔버스가 깜박이고 NEW 팝이 다시 재생되며 누르던 버튼이 사라진다.
  const key = `${dex.tab}|${JSON.stringify(view.sections)}`;
  if (key === dex.gridKey) {
    for (const slot of Array.from(grid.querySelectorAll<HTMLElement>('.dex-slot'))) {
      slot.setAttribute('aria-pressed', String(slot.dataset['speciesId'] === dex.selectedId));
    }
    return;
  }
  dex.gridKey = key;
  const focusedId = (document.activeElement as HTMLElement | null)?.dataset['speciesId'];
  grid.replaceChildren(
    ...view.sections
      .filter((section) => dex.tab === 'ALL' || section.rarity === dex.tab)
      .map((section) => {
        const block = document.createElement('section');
        block.className = 'dex-section';
        block.dataset['rarity'] = section.rarity;
        const title = document.createElement('h2');
        const count = document.createElement('small');
        count.textContent = `${section.found}/${section.total}`;
        title.append(section.rarity, count);
        const slots = document.createElement('div');
        slots.className = 'dex-slots';
        slots.append(...section.slots.map(slotElement));
        block.append(title, slots);
        return block;
      }),
  );
  if (focusedId) grid.querySelector<HTMLElement>(`[data-species-id="${focusedId}"]`)?.focus();
}

function slotElement(slot: DexSlotView): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dex-slot';
  button.dataset['speciesId'] = slot.speciesId;
  button.dataset['rarity'] = slot.rarity;
  button.dataset['state'] = slot.state;
  button.setAttribute('aria-pressed', String(slot.speciesId === dex.selectedId));
  button.setAttribute('aria-label', slotLabel(slot));

  const canvas = document.createElement('canvas');
  void drawCard(canvas, slot.sprite, slot.state === 'undiscovered', () => SLOT_SCALE);
  button.append(canvas);

  const number = span('dex-slot__number', slot.number);
  button.append(number);
  switch (slot.state) {
    case 'undiscovered':
      button.append(span('dex-slot__unknown', '?'));
      break;
    case 'owned':
    case 'discovered-empty':
      button.append(span('dex-slot__count', `×${slot.ownedCount}`));
      break;
    default: {
      const unreachable: never = slot.state;
      throw new Error(`알 수 없는 슬롯 상태: ${String(unreachable)}`);
    }
  }
  if (slot.isNew) {
    const badge = span('dex-slot__new', 'NEW');
    // 팝은 처음 나타날 때 한 번만(design prompt). 다시 그린 그리드에서는 정지한 표식이다.
    if (dex.popped.has(slot.speciesId)) badge.classList.add('dex-slot__new--shown');
    dex.popped.add(slot.speciesId);
    button.append(badge);
  }

  button.addEventListener('click', () => select(slot.speciesId));
  return button;
}

function slotLabel(slot: DexSlotView): string {
  const parts = [slot.number, slot.rarity, slot.state === 'undiscovered' ? '미발견' : slot.name];
  if (slot.state !== 'undiscovered') parts.push(`보유 ${slot.ownedCount}마리`);
  if (slot.isNew) parts.push('새로 발견');
  return parts.join(', ');
}

function select(speciesId: string): void {
  dex.selectedId = speciesId;
  render();
}

/** 상세를 열면 확인 처리한다. 실패하면 NEW 를 그대로 두고, 다음에 열 때 다시 시도한다. */
async function markSeen(speciesId: string): Promise<void> {
  if (dex.marking.has(speciesId)) return;
  dex.marking.add(speciesId);
  try {
    unwrapDexResponse(await bridge().markSeen(speciesId));
    await load();
  } catch (error) {
    console.warn(`[DEX] NEW 확인을 저장하지 못했습니다 — ${messageOf(error)}`);
  } finally {
    dex.marking.delete(speciesId);
  }
}

/** 방향키로 가장 가까운 슬롯으로 옮긴다. 화면에 보이는 배치 그대로 판단한다. */
function moveFocus(event: KeyboardEvent): void {
  const direction = DIRECTIONS[event.key];
  if (!direction) return;
  const current = event.target instanceof HTMLElement ? event.target.closest('.dex-slot') : null;
  if (!current) return;
  event.preventDefault();
  const from = center(current);
  let best: { slot: HTMLElement; score: number } | undefined;
  for (const candidate of Array.from(grid.querySelectorAll<HTMLElement>('.dex-slot'))) {
    if (candidate === current) continue;
    const to = center(candidate);
    const along = (to.x - from.x) * direction.x + (to.y - from.y) * direction.y;
    if (along <= 0) continue;
    const across =
      Math.abs((to.x - from.x) * direction.y) + Math.abs((to.y - from.y) * direction.x);
    const score = along + across * 2;
    if (!best || score < best.score) best = { slot: candidate, score };
  }
  best?.slot.focus();
}

const DIRECTIONS: Readonly<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function center(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/* ---------- 상세 ---------- */

function selectedSlot(): DexSlotView | undefined {
  return dex.view?.sections
    .flatMap((section) => section.slots)
    .find((slot) => slot.speciesId === dex.selectedId);
}

let showcaseToken = 0;

function renderDetail(): void {
  const slot = selectedSlot();
  detailEmpty.hidden = slot !== undefined;
  detailBody.hidden = slot === undefined;
  if (!slot) return;

  const hidden = slot.state === 'undiscovered';
  detailName.textContent = slot.name;
  detailNumber.textContent = slot.number;
  detailGrade.textContent = slot.rarity;
  detailGrade.dataset['rarity'] = slot.rarity;

  detailOwned.hidden = hidden;
  detailOwned.textContent =
    slot.state === 'owned'
      ? `보유 ${slot.ownedCount}마리 · 최고 Lv.${slot.highestLevel}`
      : '지금은 함께하는 펫이 없어요';
  detailMet.hidden = slot.discoveredOn === null;
  detailMet.textContent = `첫 만남 ${slot.discoveredOn ?? ''}`;

  evolution.hidden = hidden;
  // focus 마다 다시 읽으므로, 바뀐 것이 없으면 썸네일·힌트를 갈아 끼우지 않는다(깜박임 방지).
  const detailKey = JSON.stringify([slot.speciesId, slot.stages, slot.hints]);
  if (detailKey !== dex.detailKey) {
    dex.detailKey = detailKey;
    renderStagesAndHints(slot);
  }

  detailAction.textContent = slot.state === 'owned' ? '펫룸에서 보기' : '✨ 펫 뽑기로 가기';
  detailActionError.hidden = true;

  const showcaseKey = `${slot.speciesId}|${slot.state}|${slot.showcase.stage}`;
  if (showcaseKey !== dex.showcaseKey) {
    dex.showcaseKey = showcaseKey;
    void drawShowcase(slot, ++showcaseToken);
  }

  // 상세에 보이면 확인한 것이다. 처음 열 때 자동으로 고른 슬롯도 같다 — 보고 있는데 NEW 가
  // 남으면 표식이 고장 난 것처럼 보이고 펫룸 버튼의 NEW 도 꺼지지 않는다.
  if (slot.isNew) void markSeen(slot.speciesId);
}

function renderStagesAndHints(slot: DexSlotView): void {
  evolution.replaceChildren(
    ...slot.stages.flatMap((stage, index) => {
      const box = document.createElement('span');
      box.className = 'evolution__stage';
      box.title = `${stage.stage}단계${stage.reached ? '' : ' (아직 못 만남)'}`;
      const canvas = document.createElement('canvas');
      void drawCard(canvas, stage.sprite, !stage.reached, () => 1);
      box.append(canvas);
      return index === 0 ? [box] : [span('evolution__arrow', '›'), box];
    }),
  );

  hints.replaceChildren(
    ...slot.hints.map((hint) => {
      const item = document.createElement('li');
      item.textContent = hint;
      return item;
    }),
  );
}

/**
 * 이동 버튼. 실패는 조회 실패가 아니므로 도감 전체를 오류 화면으로 바꾸지 않는다. 그사이
 * 다른 창에서 합성으로 마지막 개체가 사라졌을 수 있으니 문구를 보이고 다시 읽는다.
 */
async function runDetailAction(): Promise<void> {
  const slot = selectedSlot();
  if (!slot) return;
  try {
    if (slot.state === 'owned') unwrapDexResponse(await bridge().openInRoom(slot.speciesId));
    else await bridge().goGacha();
  } catch (error) {
    detailActionError.textContent = `⚠ 이동하지 못했어요 — ${messageOf(error)}`;
    detailActionError.hidden = false;
    await load();
    detailActionError.hidden = false;
  }
}

/**
 * 상세 무대. 도달한 가장 높은 단계의 idle 을 한 번 재생하고 첫 프레임에 멈춘다.
 * 반복 재생은 장식이라 하지 않는다(design.md §8). 미발견이면 실루엣 카드만 그린다.
 */
async function drawShowcase(slot: DexSlotView, token: number): Promise<void> {
  const sprite = slot.showcase.sprite;
  if (slot.state === 'undiscovered') {
    await drawCard(showcase, sprite, true, scaleFor, () => token === showcaseToken);
    return;
  }
  try {
    const [meta, image] = await Promise.all([
      fetchJson<SpriteMeta>(asset(sprite.idle.replace(/\.png$/, '.json'))),
      loadImage(asset(sprite.idle)),
    ]);
    if (token !== showcaseToken) return;
    const scale = scaleFor(meta.frameWidth);
    sizeCanvas(showcase, meta.frameWidth, meta.frameHeight, scale);
    const context = showcase.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const drawFrame = (index: number) => {
      context.clearRect(0, 0, meta.frameWidth, meta.frameHeight);
      context.drawImage(
        image,
        index * meta.frameWidth,
        0,
        meta.frameWidth,
        meta.frameHeight,
        0,
        0,
        meta.frameWidth,
        meta.frameHeight,
      );
    };
    drawFrame(0);
    if (reducedMotion.matches) return;
    const started = performance.now();
    const step = (now: number) => {
      if (token !== showcaseToken) return;
      const index = Math.floor(((now - started) / 1000) * meta.fps);
      if (index >= meta.frameCount) {
        drawFrame(0);
        return;
      }
      drawFrame(index);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } catch {
    // idle 시트가 없으면 카드라도 보인다.
    await drawCard(showcase, sprite, false, scaleFor, () => token === showcaseToken);
  }
}

/** 상세 무대 안에 들어가는 가장 큰 정수 배율. */
function scaleFor(size: number): number {
  return Math.max(1, Math.floor(SHOWCASE_BOX / size));
}

/* ---------- 그리기 ---------- */

/**
 * 카드 한 장을 그린다. `silhouette`이면 불투명 픽셀을 전부 외곽선 색으로 칠한다.
 * 에셋이 없으면 그 칸에만 `?`를 그리고 다른 칸은 그대로 둔다. 배율은 카드 크기를 보고 정한다 —
 * EPIC 3단계 카드는 48px 라 32px 기준 배율로 그리면 칸을 넘친다.
 */
async function drawCard(
  canvas: HTMLCanvasElement,
  sprite: DexSpriteRef,
  silhouette: boolean,
  scaleOf: (size: number) => number,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  let image: HTMLImageElement;
  try {
    image = await loadImage(asset(sprite.card));
  } catch {
    if (!stillWanted()) return;
    drawMissing(canvas, scaleOf(32));
    return;
  }
  if (!stillWanted()) return;
  sizeCanvas(canvas, image.naturalWidth, image.naturalHeight, scaleOf(image.naturalWidth));
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  if (!silhouette) return;
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = SILHOUETTE;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
}

function drawMissing(canvas: HTMLCanvasElement, scale: number): void {
  sizeCanvas(canvas, 32, 32, scale);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = SILHOUETTE;
  context.font = '700 16px Isamanru, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('?', 16, 17);
}

function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, scale: number) {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}

/* ---------- 도우미 ---------- */

function bridge(): DexBridge {
  if (!window.dex) throw new Error('도감 창 연결(preload)이 없습니다.');
  return window.dex;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} 요소가 없습니다.`);
  return found as T;
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 에셋 루트. 창을 여는 쪽이 `?assets=`로 알려 준다(`@pet/room`의 `assets.js`와 같은 규약). */
function assetRootUrl(): URL {
  const query = new URLSearchParams(window.location.search).get('assets');
  if (query) return new URL(query.endsWith('/') ? query : `${query}/`);
  return new URL('../../../apps/desktop/renderer/assets/', window.location.href);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  return (await response.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${url} — 이미지를 읽지 못함`));
    image.src = url;
  });
}
