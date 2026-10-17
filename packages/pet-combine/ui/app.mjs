import { combineReadiness } from '../dist/index.js';

const assets = new URLSearchParams(window.location.search).get('assets');

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
const materials = panel.querySelector('.combine-materials');
const requirement = panel.querySelector('.combine-requirement');
const resultCard = stage.querySelector('.forge-result-card');
let snapshot = { species: [], ownedPets: [], balance: 0 };
let activeGrade = 'common';
let selectedIds = [];
let busy = false;
let pendingRequestId;
/** 잔액을 한 번이라도 읽었는가. 읽기 전의 0 을 `토큰 부족`으로 그리지 않는다. */
let loaded = false;

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
  loaded = true;
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
  const readiness = combineReadiness(activeGrade, selectedIds.length, snapshot.balance);
  // 잔액은 공통 상단 바가 보인다(`@pet/shell`). 합성 중에는 탭과 닫기를 막는다.
  signalBusy(busy || stage.classList.contains('combining'));
  materials.textContent = readiness.materials;
  requirement.textContent = loaded ? (readiness.reason ?? '') : '';
  for (const tab of panel.querySelectorAll('[data-grade]')) {
    tab.classList.toggle('active', tab.dataset.grade === activeGrade);
  }
  panel.querySelector('.combine-button').disabled =
    busy || stage.classList.contains('combining') || !loaded || !readiness.ready;
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
    grid.scrollLeft = 0;
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
    resultActions(saved.result.ownedPetId),
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

/**
 * 결과 뒤 다음 행동(동선 2단계 D). 합성 결과는 첫 펫일 수 없어서(재료 10장이 필요하다) 늘
 * `오버레이로 지정`이고, 금색 기본 버튼은 `펫룸에서 보기`다.
 */
function resultActions(ownedPetId) {
  const actions = document.createElement('div');
  actions.className = 'forge-result-actions';
  const toOverlay = document.createElement('button');
  toOverlay.type = 'button';
  toOverlay.className = 'forge-result-action';
  toOverlay.textContent = '오버레이로 지정';
  toOverlay.addEventListener('click', () => void bringToOverlay(ownedPetId));
  const inRoom = document.createElement('button');
  inRoom.type = 'button';
  inRoom.className = 'forge-result-action primary';
  inRoom.textContent = '펫룸에서 보기';
  inRoom.addEventListener('click', () => void showInRoom(ownedPetId));
  actions.append(toOverlay, inRoom);
  return actions;
}

async function bringToOverlay(ownedPetId) {
  try {
    await bridge().setOverlayPet(ownedPetId);
    window.close();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : '오버레이로 지정하지 못했어요.';
  }
}

async function showInRoom(ownedPetId) {
  try {
    await bridge().openInRoom(ownedPetId);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : '펫룸을 열지 못했어요.';
  }
}

function signalBusy(value) {
  if (typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('petto:busy', { detail: value }));
}

function dismissForgeResult() {
  if (stage.classList.contains('combining')) return;
  resultCard.className = 'forge-result-card';
  resultCard.replaceChildren();
  result.textContent = '';
}

void refresh(true);
