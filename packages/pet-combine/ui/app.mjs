const assets = new URLSearchParams(window.location.search).get('assets');
document.querySelector('.window-close')?.addEventListener('click', () => window.close());

if (!assets) throw new Error('Combine UI requires the assets query parameter.');

const assetBase = assets.endsWith('/') ? assets : `${assets}/`;
const asset = (path) => new URL(path, assetBase).href;
const stage = document.querySelector('.combine-stage');
stage.style.setProperty(
  '--combine-background',
  `url("${asset('backgrounds/bg_003_arcane_combine_cavern/bg_003_composite.png')}")`,
);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const panel = document.querySelector('.combine-panel');
const message = panel.querySelector('.combine-message');
const result = panel.querySelector('.combine-result');
const selection = panel.querySelector('.selection-slots');
const grid = panel.querySelector('.pet-grid');
const tokens = panel.querySelector('.token-readout');
const resultCard = stage.querySelector('.forge-result-card');
let snapshot = { species: [], ownedPets: [], balance: 0 };
let activeGrade = 'common';
let selectedIds = [];
let busy = false;
let pendingRequestId;

function bridge() {
  if (!window.combine) throw new Error('앱에서 합성 창을 열어 주세요.');
  return window.combine;
}

function unwrap(response) {
  if (!response.ok) {
    const error = new Error(response.message);
    error.code = response.code;
    throw error;
  }
  return response.value;
}

function eligible() {
  const rarity = activeGrade.toUpperCase();
  return snapshot.ownedPets.filter((pet) => pet.rarity === rarity && !pet.isActive);
}

function autoSelect() {
  pendingRequestId = undefined;
  selectedIds = eligible()
    .slice(0, 10)
    .map((pet) => pet.ownedPetId);
}

function applySnapshot(next, selectAutomatically) {
  snapshot = next;
  if (selectAutomatically) autoSelect();
  else {
    const available = new Set(eligible().map((pet) => pet.ownedPetId));
    if (selectedIds.some((id) => !available.has(id))) pendingRequestId = undefined;
    selectedIds = selectedIds.filter((id) => available.has(id));
  }
  render();
}

async function refresh(selectAutomatically = false) {
  try {
    applySnapshot(unwrap(await bridge().load()), selectAutomatically);
    message.textContent = '';
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : '정보를 불러오지 못했어요.';
  }
}

function render() {
  tokens.textContent = `TOKEN ${snapshot.balance.toLocaleString()}`;
  for (const tab of panel.querySelectorAll('[data-grade]')) {
    tab.classList.toggle('active', tab.dataset.grade === activeGrade);
  }
  panel.querySelector('.combine-button').disabled = busy || stage.classList.contains('combining');
  selection.replaceChildren(
    ...selectedIds.map((id, index) => {
      const pet = snapshot.ownedPets.find((candidate) => candidate.ownedPetId === id);
      const button = document.createElement('button');
      button.className = `selection-card ${activeGrade}`;
      button.title = `${pet.name} 제거`;
      button.setAttribute('aria-label', `${pet.name} 재료 제거`);
      button.append(petImage(pet), cardMark('×'));
      button.onclick = () => {
        if (busy || stage.classList.contains('combining')) return;
        selectedIds.splice(index, 1);
        pendingRequestId = undefined;
        render();
      };
      return button;
    }),
  );
  grid.replaceChildren(
    ...snapshot.species
      .filter((species) => species.rarity === activeGrade.toUpperCase())
      .map((species) => {
        const available = eligible().filter((pet) => pet.speciesId === species.speciesId);
        const button = document.createElement('button');
        button.className = `pet-card ${activeGrade}`;
        button.append(
          petImage(species),
          cardText(`${available.length}장`, species.name),
          cardMark('+'),
        );
        button.onclick = () => {
          if (busy || stage.classList.contains('combining')) return;
          const pet = available.find((candidate) => !selectedIds.includes(candidate.ownedPetId));
          if (!pet) {
            message.textContent = '선택할 수 있는 카드가 부족합니다.';
            return;
          }
          if (selectedIds.length >= 10) return;
          selectedIds.push(pet.ownedPetId);
          pendingRequestId = undefined;
          message.textContent = '';
          render();
        };
        return button;
      }),
  );
}

function petImage(pet) {
  const image = document.createElement('img');
  const grade = pet.rarity.toLowerCase();
  image.src = asset(`pets/${grade}/${pet.sprite}/stage1/pet_${pet.speciesId}_s1_card.png`);
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
    if (busy || stage.classList.contains('combining')) return;
    activeGrade = tab.dataset.grade;
    autoSelect();
    message.textContent = '';
    render();
  }),
);

panel.querySelector('.combine-button').addEventListener('click', () => void submit());
window.addEventListener('focus', () => {
  if (!busy && !stage.classList.contains('combining')) void refresh();
});

async function submit() {
  if (busy || stage.classList.contains('combining')) return;
  busy = true;
  render();
  try {
    pendingRequestId ??= window.crypto.randomUUID();
    const saved = unwrap(await bridge().combine(activeGrade, [...selectedIds], pendingRequestId));
    pendingRequestId = undefined;
    applySnapshot(saved, true);
    playCombineSuccess(saved);
  } catch (error) {
    if (error && error.code === 'duplicate') pendingRequestId = undefined;
    message.textContent = error instanceof Error ? error.message : '합성하지 못했어요.';
    await refreshAfterError();
  } finally {
    busy = false;
    render();
  }
}

async function refreshAfterError() {
  try {
    applySnapshot(unwrap(await bridge().load()), false);
  } catch {
    // 첫 오류 메시지를 유지한다. 다음 버튼 누름 또는 창 포커스로 다시 조회할 수 있다.
  }
}

function playCombineSuccess(saved) {
  message.textContent = '';
  result.textContent = '';
  const grade = saved.result.rarity.toLowerCase();
  resultCard.className = `forge-result-card ${grade}`;
  const close = document.createElement('button');
  close.className = 'forge-result-close';
  close.type = 'button';
  close.setAttribute('aria-label', '합성 결과 카드 닫기');
  close.textContent = '×';
  close.addEventListener('click', dismissForgeResult);
  resultCard.replaceChildren(
    petImage(saved.result),
    cardText(saved.result.rarity, saved.result.name),
    close,
  );
  stage.classList.add('combining');
  window.setTimeout(
    () => {
      stage.classList.remove('combining');
      resultCard.classList.add('revealed');
      result.textContent = `${saved.result.rarity} ${saved.result.name} 획득!`;
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

void refresh(true);
