import {
  awakeningCopy,
  cardInterval,
  createGachaEngine,
  highestGrade,
  individualOdds,
  introDuration,
  revealCopy,
  secureRandomInt,
  type DrawCount,
  type DrawResult,
  type GachaGrade,
  type PetsByGrade,
} from '../index.ts';

interface DemoPet {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly grade: GachaGrade;
  readonly asset: string;
}

const assetRoot = assetRootUrl();
const asset = (path: string): string => new URL(path, assetRoot).href;

const PETS = {
  common: [
    {
      id: '003',
      slug: 'mole_digger',
      name: '두더지',
      grade: 'common',
      asset: asset('pets/common/mole_digger/stage1/pet_003_s1_card.png'),
    },
    {
      id: '004',
      slug: 'sprout_treant',
      name: '새싹나무',
      grade: 'common',
      asset: asset('pets/common/sprout_treant/stage1/pet_004_s1_card.png'),
    },
  ],
  rare: [
    {
      id: '002',
      slug: 'midnight_zebra',
      name: '미드나잇얼룩말',
      grade: 'rare',
      asset: asset('pets/rare/midnight_zebra/stage1/pet_002_s1_card.png'),
    },
    {
      id: '005',
      slug: 'cheek_hamster',
      name: '볼주머니햄',
      grade: 'rare',
      asset: asset('pets/rare/cheek_hamster/stage1/pet_005_s1_card.png'),
    },
  ],
  epic: [
    {
      id: '001',
      slug: 'acorn_squirrel',
      name: '도토리다람쥐',
      grade: 'epic',
      asset: asset('pets/epic/acorn_squirrel/stage1/pet_001_s1_card.png'),
    },
    {
      id: '006',
      slug: 'star_wizard',
      name: '별빛마법사',
      grade: 'epic',
      asset: asset('pets/epic/star_wizard/stage1/pet_006_s1_card.png'),
    },
  ],
} as const satisfies PetsByGrade<DemoPet>;

const engine = createGachaEngine<DemoPet>(PETS, secureRandomInt);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const numberFormat = new Intl.NumberFormat('ko-KR');

let tokenBalance = 9_999_999_999;
let pendingDraw: DrawResult<DemoPet> | undefined;
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

element<HTMLButtonElement>('draw-one').addEventListener('click', () => startDraw(1));
element<HTMLButtonElement>('draw-ten').addEventListener('click', () => startDraw(10));
element<HTMLButtonElement>('skip-button').addEventListener('click', finishReveal);
element<HTMLButtonElement>('close-results').addEventListener('click', closeResults);
element<HTMLButtonElement>('odds-button').addEventListener('click', openOdds);
element<HTMLButtonElement>('odds-close').addEventListener('click', closeOdds);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!oddsPanel.hidden) closeOdds();
  else if (reveal.classList.contains('showing')) closeResults();
});

function startDraw(count: DrawCount): void {
  if (pendingDraw) return;

  const cost = count * 100_000;
  if (tokenBalance < cost) return;

  pendingDraw = engine.draw(count);
  tokenBalance -= cost;
  updateHud();

  const grade = highestGrade(pendingDraw.results);
  const delay = reducedMotion ? 0 : introDuration(grade);
  prepareReveal(grade, delay);
  revealTimers.push(window.setTimeout(() => revealCards(false), delay));
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

function createResultCard(grade: GachaGrade, pet: DemoPet): HTMLElement {
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
  const { pityCounter } = engine.getState();
  element<HTMLElement>('token-balance').textContent = numberFormat.format(tokenBalance);
  element<HTMLElement>('pity-counter').textContent = `${pityCounter} / 100`;
  element<HTMLElement>('pity-fill').style.width = `${pityCounter}%`;

  const progress = element<HTMLElement>('pity-track');
  progress.setAttribute('aria-valuenow', String(pityCounter));
}

function setControlsDisabled(disabled: boolean): void {
  element<HTMLButtonElement>('draw-one').disabled = disabled;
  element<HTMLButtonElement>('draw-ten').disabled = disabled;
  element<HTMLButtonElement>('odds-button').disabled = disabled;
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
  const odds = individualOdds<DemoPet>(PETS);
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
    for (const pet of PETS[grade]) {
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
renderOdds();
