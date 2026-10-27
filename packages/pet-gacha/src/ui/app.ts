import {
  awakeningCopy,
  cardInterval,
  defaultResultIndex,
  drawAffordance,
  GachaActionError,
  highestGrade,
  individualOdds,
  introDuration,
  resultActions,
  revealCopy,
  secureRandomInt,
  showsTokenHint,
  TOKEN_HINT,
  unwrapGachaResponse,
  type GachaBridge,
  type GachaPet,
  type GachaState,
  type SavedGachaDraw,
  type DrawCount,
  type DrawResult,
  type GachaGrade,
  type PetsByGrade,
} from '../index.ts';

interface DisplayPet extends GachaPet {
  readonly asset: string;
}

declare global {
  interface Window {
    gacha?: GachaBridge;
  }
}

const pityBox = document.querySelector('.pity-box');
if (pityBox) document.querySelector('.summon-stage')?.append(pityBox);

const assetRoot = assetRootUrl();
const asset = (path: string): string => new URL(path, assetRoot).href;

let petsByGrade: PetsByGrade<DisplayPet> = { common: [], rare: [], epic: [] };
let gachaState: GachaState = { pityCounter: 0, totalDrawCount: 0 };
let catalogReady = false;
let requesting = false;
let ownedCount: number | undefined;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const numberFormat = new Intl.NumberFormat('ko-KR');

let tokenBalance = 0;
let pendingRequestId: string | undefined;
let pendingDraw: (DrawResult<DisplayPet> & { readonly ownedPetIds: readonly string[] }) | undefined;
/** 결과 화면의 대상 카드. 10회 소환은 카드를 눌러 바꾼다. */
let selectedResult = 0;
/** 결과를 보이는 순간의 오버레이 펫. 첫 펫이면 방금 뽑은 펫이다. */
let overlayPetId: string | null = null;
/** 방금 소환한 횟수. `한 번 더`가 같은 횟수로 다시 소환한다. */
let lastCount: DrawCount = 1;
let revealTimers: number[] = [];

const stage = element<HTMLElement>('summon-stage');
const reveal = element<HTMLElement>('reveal');
const portal = element<HTMLElement>('portal');
const resultGrid = element<HTMLElement>('result-grid');
const oddsPanel = element<HTMLElement>('odds-panel');

stage.style.setProperty(
  '--gacha-background',
  `url("${asset('backgrounds/bg_002_moonlit_gacha_grove/bg_002_composite.png')}")`,
);

element<HTMLButtonElement>('draw-one').addEventListener('click', () => void startDraw(1));
element<HTMLButtonElement>('draw-ten').addEventListener('click', () => void startDraw(10));
element<HTMLButtonElement>('skip-button').addEventListener('click', finishReveal);
element<HTMLButtonElement>('close-results').addEventListener('click', closeResults);
element<HTMLButtonElement>('result-overlay').addEventListener('click', () => void bringToOverlay());
element<HTMLButtonElement>('result-room').addEventListener('click', () => void showInRoom());
element<HTMLButtonElement>('result-again').addEventListener('click', drawAgain);
element<HTMLButtonElement>('odds-button').addEventListener('click', openOdds);
element<HTMLButtonElement>('odds-close').addEventListener('click', closeOdds);
window.addEventListener('focus', () => {
  if (!requesting && !pendingDraw) void loadCatalog().catch(showError);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!oddsPanel.hidden) closeOdds();
  else if (reveal.classList.contains('showing')) closeResults();
});

async function startDraw(count: DrawCount): Promise<void> {
  if (pendingDraw || requesting) return;
  lastCount = count;
  requesting = true;
  setControlsDisabled(true);
  element<HTMLElement>('stage-kicker').textContent = '새로운 친구를 만나고 있어요';
  let saved: SavedGachaDraw;
  try {
    if (!catalogReady) await loadCatalog();
    pendingRequestId ??= window.crypto.randomUUID();
    saved = unwrapGachaResponse(await bridge().draw(count, pendingRequestId));
  } catch (error) {
    if (error instanceof GachaActionError && error.code === 'duplicate') {
      pendingRequestId = undefined;
      try {
        await loadCatalog();
      } catch {
        // 원래 요청 오류를 표시하고 다음 시도에서 다시 조회한다.
      }
    }
    showError(error);
    requesting = false;
    setControlsDisabled(false);
    return;
  }

  // 서버가 펫 생성과 재화 차감을 함께 확정한 뒤에만 결과를 연출한다.
  pendingDraw = {
    ...saved,
    results: saved.results.map((result) => ({ ...result, pet: displayPet(result.pet) })),
  };
  gachaState = saved;
  ownedCount = saved.ownedCount;
  tokenBalance = saved.balance;
  pendingRequestId = undefined;
  requesting = false;
  updateHud();

  const grade = highestGrade(pendingDraw.results);
  const delay = reducedMotion ? 0 : introDuration(grade);
  prepareReveal(grade, delay);
  revealTimers.push(window.setTimeout(() => revealCards(false), delay));
}

function bridge(): GachaBridge {
  if (!window.gacha) throw new Error('앱에서 뽑기 창을 열어 주세요.');
  return window.gacha;
}

function displayPet(pet: GachaPet): DisplayPet {
  return {
    ...pet,
    asset: asset(`pets/${pet.grade}/${pet.slug}/stage1/pet_${pet.id}_s1_card.png`),
  };
}

async function loadCatalog(): Promise<void> {
  const snapshot = unwrapGachaResponse(await bridge().load());
  petsByGrade = {
    common: snapshot.pets.common.map(displayPet),
    rare: snapshot.pets.rare.map(displayPet),
    epic: snapshot.pets.epic.map(displayPet),
  };
  gachaState = snapshot;
  ownedCount = snapshot.ownedCount;
  tokenBalance = snapshot.balance;
  renderOdds();
  catalogReady = true;
  updateHud();
}

function showError(error: unknown): void {
  element<HTMLElement>('stage-kicker').textContent = '소환하지 못했어요';
  element<HTMLElement>('stage-heading').textContent =
    error instanceof Error ? error.message : '다시 시도해 주세요.';
  element<HTMLElement>('pod-status').textContent = '소환 버튼을 눌러 다시 시도';
}

async function initialize(): Promise<void> {
  requesting = true;
  setControlsDisabled(true);
  element<HTMLElement>('stage-kicker').textContent = '친구들을 불러오는 중';
  try {
    await loadCatalog();
    element<HTMLElement>('stage-kicker').textContent = '새로운 인연을 기다리는 숲';
  } catch (error) {
    showError(error);
  } finally {
    requesting = false;
    setControlsDisabled(false);
  }
}

function prepareReveal(grade: GachaGrade, duration: number): void {
  const copy = revealCopy(grade);
  reveal.className = `modal reveal ${grade} charging`;
  reveal.setAttribute('aria-hidden', 'true');
  portal.className = `portal awakening ${grade}`;
  portal.style.setProperty('--awaken-duration', `${Math.max(duration, 1)}ms`);
  element<HTMLButtonElement>('skip-button').hidden = false;
  element<HTMLElement>('result-actions').hidden = true;
  element<HTMLElement>('result-error').hidden = true;
  element<HTMLElement>('stage-kicker').textContent = '잠든 인연이 깨어나는 중';
  element<HTMLElement>('stage-heading').textContent = awakeningCopy(grade);
  element<HTMLElement>('pod-status').textContent = '깨어나는 중 · · ·';
  element<HTMLElement>('reveal-kicker').textContent = copy.kicker;
  element<HTMLElement>('reveal-heading').textContent = copy.heading;
  resultGrid.replaceChildren();
  makeParticles(grade);
  setControlsDisabled(true);
  element<HTMLButtonElement>('skip-button').focus();
}

function revealCards(skipped: boolean): void {
  clearRevealTimers();
  if (!pendingDraw) return;

  const grade = highestGrade(pendingDraw.results);
  reveal.className = `modal reveal active ${grade} showing`;
  reveal.setAttribute('aria-hidden', 'false');
  portal.className = 'portal';
  element<HTMLButtonElement>('skip-button').hidden = true;
  element<HTMLElement>('reveal-heading').textContent =
    pendingDraw.results.length === 10 ? '열 마리의 새로운 친구' : '새로운 친구를 만났습니다';
  resultGrid.dataset['count'] = String(pendingDraw.results.length);
  selectedResult = defaultResultIndex(pendingDraw.results);
  const selectable = pendingDraw.results.length > 1;

  pendingDraw.results.forEach((result, index) => {
    const card = createResultCard(result.grade, result.pet);
    if (selectable) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => selectResult(index));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') selectResult(index);
      });
    }
    resultGrid.append(card);
    const delay = skipped || reducedMotion ? 0 : index * cardInterval(grade);
    revealTimers.push(window.setTimeout(() => card.classList.add('visible'), delay));
  });

  const completeDelay =
    skipped || reducedMotion
      ? 0
      : Math.max(0, pendingDraw.results.length - 1) * cardInterval(grade) + 220;
  revealTimers.push(
    window.setTimeout(() => {
      element<HTMLElement>('result-actions').hidden = false;
      // 저장과 연출이 끝났다. 결과를 보는 동안에는 상단 바로 다른 화면에 가도 된다.
      signalBusy(false);
      renderResultActions();
      element<HTMLButtonElement>(primaryActionId()).focus();
    }, completeDelay),
  );
  // 첫 펫인지는 메인이 정한다(뽑은 직후 자동으로 오버레이 펫이 된다). 결과를 그리는 동안 묻는다.
  void bridge()
    .overlayPetId()
    .then((id) => {
      overlayPetId = id;
      renderResultActions();
    })
    .catch(() => undefined);
}

function selectResult(index: number): void {
  selectedResult = index;
  renderResultActions();
}

function selectedOwnedPetId(): string | undefined {
  return pendingDraw?.ownedPetIds[selectedResult];
}

function primaryActionId(): string {
  const target = selectedOwnedPetId();
  return target !== undefined && target === overlayPetId ? 'result-overlay' : 'result-room';
}

/** 고른 카드와 잔액으로 결과 뒤 버튼을 그린다. 금색 기본 버튼은 하나다. */
function renderResultActions(): void {
  if (!pendingDraw) return;
  const target = selectedOwnedPetId();
  const actions = resultActions({
    targetIsOverlayPet: target !== undefined && target === overlayPetId,
    count: lastCount,
    balance: tokenBalance,
  });
  const overlayButton = element<HTMLButtonElement>('result-overlay');
  overlayButton.textContent = actions.overlay.label;
  overlayButton.classList.toggle('primary', actions.overlay.primary);
  element<HTMLButtonElement>('result-room').classList.toggle('primary', actions.roomPrimary);
  const again = element<HTMLButtonElement>('result-again');
  again.disabled = !actions.again.enabled;
  again.classList.toggle('unaffordable', !actions.again.enabled);
  element<HTMLElement>('result-again-cost').textContent = actions.again.label;
  Array.from(resultGrid.children).forEach((card, index) =>
    card.classList.toggle('selected', pendingDraw!.results.length > 1 && index === selectedResult),
  );
}

/** `오버레이로 지정` — 고른 펫을 오버레이 펫으로 세우고 창을 닫는다. 이미 오버레이 펫이면 닫기만 한다. */
async function bringToOverlay(): Promise<void> {
  const target = selectedOwnedPetId();
  if (target === undefined) return;
  try {
    if (target !== overlayPetId) await bridge().setOverlayPet(target);
    window.close();
  } catch (error) {
    showResultError(error, '오버레이로 지정하지 못했어요. 다시 시도해 주세요.');
  }
}

/** `펫룸에서 보기` — 이 창 자리에 펫룸을 열고 고른 펫의 상세를 띄운다. */
async function showInRoom(): Promise<void> {
  const target = selectedOwnedPetId();
  if (target === undefined) return;
  try {
    await bridge().openInRoom(target);
  } catch (error) {
    showResultError(error, '펫룸을 열지 못했어요. 다시 시도해 주세요.');
  }
}

function drawAgain(): void {
  const count = lastCount;
  closeResults();
  void startDraw(count);
}

function showResultError(error: unknown, fallback: string): void {
  const message = element<HTMLElement>('result-error');
  message.textContent = error instanceof Error && error.message ? error.message : fallback;
  message.hidden = false;
}

function finishReveal(): void {
  revealCards(true);
}

function closeResults(): void {
  clearRevealTimers();
  reveal.className = 'modal reveal';
  reveal.setAttribute('aria-hidden', 'true');
  element<HTMLElement>('particle-field').replaceChildren();
  element<HTMLElement>('stage-kicker').textContent = '새로운 인연을 기다리는 숲';
  element<HTMLElement>('stage-heading').textContent = '잠든 씨앗에 토큰을 건네보세요';
  element<HTMLElement>('pod-status').textContent = '새근 · 새근 · 새근';
  pendingDraw = undefined;
  overlayPetId = null;
  element<HTMLElement>('result-actions').hidden = true;
  element<HTMLElement>('result-error').hidden = true;
  setControlsDisabled(false);
  element<HTMLButtonElement>('draw-one').focus();
}

function createResultCard(grade: GachaGrade, pet: DisplayPet): HTMLElement {
  const card = document.createElement('article');
  card.className = `result-card ${grade}`;

  const gradeLabel = document.createElement('span');
  gradeLabel.className = 'card-grade';
  gradeLabel.textContent = grade.toUpperCase();

  const image = document.createElement('img');
  image.src = pet.asset;
  image.alt = pet.name;

  const name = document.createElement('strong');
  name.textContent = pet.name;

  card.append(gradeLabel, image, name);
  return card;
}

function makeParticles(_grade: GachaGrade): void {
  const count = 20;
  const field = element<HTMLElement>('particle-field');
  field.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement('span');
    particle.style.setProperty('--x', `${secureRandomInt(100)}%`);
    particle.style.setProperty('--delay', `${secureRandomInt(500)}ms`);
    particle.style.setProperty('--size', `${2 + secureRandomInt(4)}px`);
    field.append(particle);
  }
}

function updateHud(): void {
  const { pityCounter } = gachaState;
  element<HTMLElement>('owned-count').textContent =
    ownedCount === undefined ? '—' : numberFormat.format(ownedCount);
  element<HTMLElement>('pity-counter').textContent = `${pityCounter} / 100`;
  element<HTMLElement>('pity-fill').style.width = `${pityCounter}%`;

  const progress = element<HTMLElement>('pity-track');
  progress.setAttribute('aria-valuenow', String(pityCounter));
  renderAffordance();
}

let controlsBusy = false;

function setControlsDisabled(disabled: boolean): void {
  controlsBusy = disabled;
  // 연출·저장 중에는 상단 바의 탭과 닫기를 막는다(`@pet/shell`). 결과를 보기 전에 창이 바뀌지 않게 한다.
  signalBusy(disabled);
  renderAffordance();
  element<HTMLButtonElement>('odds-button').disabled = disabled || !catalogReady;
}

/**
 * 잔액으로 소환 버튼과 보조 문구를 정한다. 잔액을 읽기 전(`catalogReady` 가 아님)에는 부족으로 그리지
 * 않는다 — 0 으로 간주하면 읽기 실패가 "토큰 부족"으로 보이고, 눌러서 다시 읽는 길도 막힌다.
 */
function renderAffordance(): void {
  const known = catalogReady;
  const pairs = [
    [1, 'draw-one', 'draw-one-cost'],
    [10, 'draw-ten', 'draw-ten-cost'],
  ] as const;
  for (const [count, buttonId, costId] of pairs) {
    const state = drawAffordance(count, known ? tokenBalance : Number.POSITIVE_INFINITY);
    const button = element<HTMLButtonElement>(buttonId);
    button.disabled = controlsBusy || !state.affordable;
    button.classList.toggle('unaffordable', !state.affordable);
    element<HTMLElement>(costId).textContent = state.label;
  }
  const hint = element<HTMLElement>('token-hint');
  hint.textContent = TOKEN_HINT;
  hint.hidden = !known || !showsTokenHint(tokenBalance);
}

function signalBusy(busy: boolean): void {
  if (typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('petto:busy', { detail: busy }));
}

function openOdds(): void {
  oddsPanel.hidden = false;
  element<HTMLButtonElement>('odds-button').setAttribute('aria-expanded', 'true');
  element<HTMLButtonElement>('odds-close').focus();
}

function closeOdds(): void {
  oddsPanel.hidden = true;
  element<HTMLButtonElement>('odds-button').setAttribute('aria-expanded', 'false');
  element<HTMLButtonElement>('odds-button').focus();
}

function renderOdds(): void {
  const odds = individualOdds<DisplayPet>(petsByGrade);
  const gradeOdds: Readonly<Record<GachaGrade, string>> = {
    common: '80%',
    rare: '17%',
    epic: '3%',
  };
  const list = element<HTMLElement>('odds-list');
  list.replaceChildren();

  for (const grade of ['common', 'rare', 'epic'] as const) {
    const group = document.createElement('section');
    group.className = `odds-group ${grade}`;

    const heading = document.createElement('h3');
    heading.append(document.createTextNode(grade.toUpperCase()));
    const totalOdds = document.createElement('strong');
    totalOdds.textContent = gradeOdds[grade];
    heading.append(totalOdds);

    const entries = document.createElement('div');
    entries.className = 'odds-pet-list';
    for (const pet of petsByGrade[grade]) {
      const entry = document.createElement('div');
      entry.className = 'odds-pet';

      const image = document.createElement('img');
      image.src = pet.asset;
      image.alt = '';
      const name = document.createElement('span');
      name.textContent = pet.name;
      const chance = document.createElement('strong');
      chance.textContent = `${odds[grade]}%`;

      entry.append(image, name, chance);
      entries.append(entry);
    }

    group.append(heading, entries);
    list.append(group);
  }
}

function clearRevealTimers(): void {
  for (const timer of revealTimers) window.clearTimeout(timer);
  revealTimers = [];
}

function assetRootUrl(): URL {
  const query = new URLSearchParams(window.location.search).get('assets');
  if (query) return new URL(query.endsWith('/') ? query : `${query}/`);
  return new URL('../../../apps/desktop/renderer/assets/', window.location.href);
}

function element<ElementType extends HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) throw new Error(`필수 UI 요소를 찾지 못했습니다: #${id}`);
  return found as ElementType;
}

updateHud();
void initialize();
