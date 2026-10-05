import {
  awakeningCopy,
  cardInterval,
  GachaActionError,
  highestGrade,
  individualOdds,
  introDuration,
  revealCopy,
  secureRandomInt,
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

document.querySelector('.window-close')?.addEventListener('click', () => window.close());
document.querySelector('.window-back')?.addEventListener('click', () => {
  void bridge().backToRoom();
});
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
let pendingDraw: DrawResult<DisplayPet> | undefined;
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
  element<HTMLButtonElement>('close-results').hidden = true;
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

  pendingDraw.results.forEach((result, index) => {
    const card = createResultCard(result.grade, result.pet);
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
      const closeButton = element<HTMLButtonElement>('close-results');
      closeButton.hidden = false;
      closeButton.focus();
    }, completeDelay),
  );
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
  element<HTMLElement>('stage-heading').textContent = '잠든 씨앗에 Token을 건네보세요';
  element<HTMLElement>('pod-status').textContent = '새근 · 새근 · 새근';
  pendingDraw = undefined;
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
  element<HTMLElement>('token-balance').textContent = numberFormat.format(tokenBalance);
  element<HTMLElement>('pity-counter').textContent = `${pityCounter} / 100`;
  element<HTMLElement>('pity-fill').style.width = `${pityCounter}%`;

  const progress = element<HTMLElement>('pity-track');
  progress.setAttribute('aria-valuenow', String(pityCounter));
}

function setControlsDisabled(disabled: boolean): void {
  element<HTMLButtonElement>('draw-one').disabled = disabled;
  element<HTMLButtonElement>('draw-ten').disabled = disabled;
  element<HTMLButtonElement>('odds-button').disabled = disabled || !catalogReady;
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
