const assets = new URLSearchParams(window.location.search).get('assets');
import { createCombineAnimationLock, createCombineEngine } from '../dist/index.js';

if (!assets) throw new Error('Combine UI requires the assets query parameter.');

const assetBase = assets.endsWith('/') ? assets : `${assets}/`;
const asset = (path) => new URL(path, assetBase).href;
const stage = document.querySelector('.combine-stage');

stage.style.setProperty(
  '--combine-background',
  `url("${asset('backgrounds/bg_003_arcane_combine_cavern/bg_003_composite.png')}")`,
);

const pets = {
  common: [
    {
      id: 'mole',
      name: '두더지',
      grade: 'common',
      asset: asset('pets/common/mole_digger/stage1/pet_003_s1_card.png'),
    },
    {
      id: 'treant',
      name: '새싹나무',
      grade: 'common',
      asset: asset('pets/common/sprout_treant/stage1/pet_004_s1_card.png'),
    },
  ],
  rare: [
    {
      id: 'zebra',
      name: '미드나잇얼룩말',
      grade: 'rare',
      asset: asset('pets/rare/midnight_zebra/stage1/pet_002_s1_card.png'),
    },
    {
      id: 'hamster',
      name: '볼주머니햄',
      grade: 'rare',
      asset: asset('pets/rare/cheek_hamster/stage1/pet_005_s1_card.png'),
    },
  ],
  epic: [
    {
      id: 'squirrel',
      name: '도토리다람쥐',
      grade: 'epic',
      asset: asset('pets/epic/acorn_squirrel/stage1/pet_001_s1_card.png'),
    },
    {
      id: 'wizard',
      name: '별빛마법사',
      grade: 'epic',
      asset: asset('pets/epic/star_wizard/stage1/pet_006_s1_card.png'),
    },
  ],
};
const engine = createCombineEngine(pets, (max) => Math.floor(Math.random() * max));
const animationLock = createCombineAnimationLock();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const panel = document.querySelector('.combine-panel');
const message = panel.querySelector('.combine-message');
const result = panel.querySelector('.combine-result');
const selection = panel.querySelector('.selection-slots');
const grid = panel.querySelector('.pet-grid');
const tokens = panel.querySelector('.token-readout');
const resultCard = stage.querySelector('.forge-result-card');
const labels = {
  selection: '재료는 정확히 10장 필요합니다.',
  tokens: 'Token이 부족합니다.',
  candidates: '결과 펫 풀이 비어 있습니다.',
};
function render() {
  const state = engine.getState();
  tokens.textContent = `TOKEN ${state.tokenBalance.toLocaleString()}`;
  for (const tab of panel.querySelectorAll('[data-grade]'))
    tab.classList.toggle('active', tab.dataset.grade === state.activeGrade);
  panel.querySelector('.combine-button').disabled = stage.classList.contains('combining');
  selection.replaceChildren(
    ...state.selection.map((id, index) => {
      const pet = pets[state.activeGrade].find((candidate) => candidate.id === id);
      const b = document.createElement('button');
      b.className = `selection-card ${pet.grade}`;
      b.title = `${pet.name} 제거`;
      b.setAttribute('aria-label', `${pet.name} 재료 제거`);
      b.append(petImage(pet), cardMark('×'));
      b.onclick = () => {
        if (stage.classList.contains('combining')) return;
        engine.removePet(index);
        render();
      };
      return b;
    }),
  );
  grid.replaceChildren(
    ...pets[state.activeGrade].map((pet) => {
      const b = document.createElement('button');
      b.className = `pet-card ${pet.grade}`;
      b.append(petImage(pet), cardText(`${state.inventory[pet.id]}장`, pet.name), cardMark('+'));
      b.onclick = () => {
        if (stage.classList.contains('combining')) return;
        engine.addPet(pet.id);
        render();
      };
      return b;
    }),
  );
}

function petImage(pet) {
  const image = document.createElement('img');
  image.src = pet.asset;
  image.alt = pet.name;
  return image;
}

function cardText(kicker, name) {
  const text = document.createElement('span');
  text.className = 'card-text';
  const label = document.createElement('small');
  label.textContent = kicker;
  const strong = document.createElement('strong');
  strong.textContent = name;
  text.append(label, strong);
  return text;
}

function cardMark(symbol) {
  const mark = document.createElement('span');
  mark.className = 'card-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = symbol;
  return mark;
}
panel.querySelectorAll('[data-grade]').forEach((tab) =>
  tab.addEventListener('click', () => {
    if (stage.classList.contains('combining')) return;
    engine.selectGrade(tab.dataset.grade);
    message.textContent = '';
    render();
  }),
);
panel.querySelector('.combine-button').addEventListener('click', () => {
  if (!animationLock.tryStart()) return;
  const outcome = engine.combine();
  if (outcome.kind === 'error') {
    message.textContent = labels[outcome.code];
    animationLock.finish();
  } else {
    playCombineSuccess(outcome);
  }
  render();
});

function playCombineSuccess(outcome) {
  message.textContent = '항아리가 부글부글 끓고 있습니다…';
  result.textContent = '';
  resultCard.className = `forge-result-card ${outcome.grade}`;
  const close = document.createElement('button');
  close.className = 'forge-result-close';
  close.type = 'button';
  close.setAttribute('aria-label', '합성 결과 카드 닫기');
  close.textContent = '×';
  close.addEventListener('click', dismissForgeResult);
  resultCard.replaceChildren(
    petImage(outcome.pet),
    cardText(outcome.grade.toUpperCase(), outcome.pet.name),
    close,
  );
  stage.classList.add('combining');

  window.setTimeout(
    () => {
      stage.classList.remove('combining');
      resultCard.classList.add('revealed');
      result.textContent = `${outcome.grade.toUpperCase()} ${outcome.pet.name} 획득!`;
      animationLock.finish();
      render();
    },
    reducedMotion ? 0 : 1_500,
  );
}

function dismissForgeResult() {
  if (stage.classList.contains('combining')) return;
  resultCard.className = 'forge-result-card';
  resultCard.replaceChildren();
  result.textContent = '';
}
render();
