// 펫룸 창.
//
// 보유 펫 전원이 숲 지면을 서서히 배회하고, 반딧불이가 깜빡이고, 펫을 누르면 클릭 반응과
// 상세 패널이 뜬다.
//
// ## 규칙은 여기 없다
//
// 배회·낮밤·프레임·클릭 판정 규칙은 전부 `@pet/room`에 있고 `node --test`로 검증된다.
// 이 파일은 그 결과를 DOM과 캔버스에 옮기고, 입력을 IPC로 넘기는 일만 한다.
//
// ## 활성 펫은 이 창이 정하지 않는다
//
// "오버레이로 지정"을 눌러도 **로컬 상태를 먼저 고치지 않는다.** `setActivePet`을 호출만
// 하고, 금색 테두리와 버튼 상태는 오직 `room:activePetChanged` push를 받고 나서 바꾼다.
// 발신 창이 낙관적으로 먼저 그리면 로컬 상태와 push 상태가 경쟁해 진실의 원천이 둘로
// 쪼개진다(`src/main/room.ts` 참조).

import {
  backgroundAssetPath,
  backgroundFrameIndexAt,
  drawBoxOf,
  hitTest,
  inDrawOrder,
  layersInDrawOrder,
  mockXpRatio,
  PET_SCALE,
  spawnRoamingPet,
  stepRoaming,
  walkAreaOf,
} from '../../../packages/pet-room/dist/index.js';
import { drawFrame, fetchJson, loadImage, SpritePlayer } from './sprite.js';

const api = window.petApi;

const layersEl = document.getElementById('layers');
const canvas = document.getElementById('pets');
const ctx = canvas.getContext('2d');
const phaseEl = document.getElementById('phase');
const errorEl = document.getElementById('error');

const detailEl = document.getElementById('detail');
const detailName = document.getElementById('detail-name');
const detailGrade = document.getElementById('detail-grade');
const detailLevel = document.getElementById('detail-level');
const detailXp = document.getElementById('detail-xp');
const detailXpLabel = document.getElementById('detail-xp-label');
const detailNote = document.getElementById('detail-note');
const detailActivate = document.getElementById('detail-activate');
const detailClose = document.getElementById('detail-close');

const GRADE_LABEL = { COMMON: '커먼', RARE: '레어', EPIC: '에픽' };
const PHASE_LABEL = { day: '낮', night: '밤' };

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** 창 하나가 들고 있는 전부. 활성 펫만은 여기서 정하지 않는다(파일 머리말 참조). */
const room = {
  /** ownedPetId → RoomPetView */
  views: new Map(),
  /** ownedPetId → SpritePlayer */
  players: new Map(),
  /** 배회 상태 배열. 공유 rAF 하나가 매 프레임 일괄 갱신한다. */
  roaming: [],
  walkArea: null,
  /** 배경 애니메이션(반딧불이)의 프레임 `<img>` 목록. */
  animationFrames: [],
  animation: null,
  /** main이 push로 알려 준 활성 펫. 이 창이 직접 고치지 않는다. */
  activePetId: null,
  /** 상세 패널이 보여 주는 펫. 창 안에서만 의미 있는 로컬 UI 상태다. */
  selectedPetId: null,
};

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  api.debugLog(`[PETROOM] ${message}`);
}

/* ---------- 배경 ---------- */

/**
 * 배경 레이어를 깐다.
 *
 * `z` 오름차순으로 겹치고, `animation.layer`로 지정된 레이어만 프레임 `<img>` 여러 장을
 * 겹쳐 두고 하나씩 보인다. `.src`를 갈아 끼우지 않고 미리 다 얹어 두는 이유: 교체 순간
 * 디코딩이 걸리면 반딧불이가 한 프레임 깜빡인다.
 *
 * `parallax`는 쓰지 않는다. 레이어가 `seamless: false`이고 폭이 창과 같아서, 어느 레이어든
 * 밀면 즉시 빈 가장자리가 드러난다.
 */
async function buildLayers(background, meta) {
  layersEl.replaceChildren();
  room.animationFrames = [];
  room.animation = meta.animation ?? null;

  const animatedLayer = meta.animation?.layer;

  for (const layer of layersInDrawOrder(meta)) {
    if (layer.name === animatedLayer) {
      const frames = await Promise.all(
        meta.animation.frames.map((file) =>
          loadImage(backgroundAssetPath(background.directory, file)),
        ),
      );
      frames.forEach((image, index) => {
        image.alt = '';
        image.hidden = index !== 0;
        layersEl.append(image);
      });
      room.animationFrames = frames;
      continue;
    }

    const image = await loadImage(backgroundAssetPath(background.directory, layer.file));
    image.alt = '';
    layersEl.append(image);
  }
}

/** 지금 보여야 할 반딧불이 프레임으로 바꾼다. */
function updateFireflies(now) {
  if (!room.animation || room.animationFrames.length === 0) return;
  // 움직임을 줄여 달라고 했으면 첫 프레임에서 멈춘다(design.md §8).
  const index = reducedMotion.matches ? 0 : backgroundFrameIndexAt(room.animation, now);
  room.animationFrames.forEach((image, i) => {
    image.hidden = i !== index;
  });
}

/* ---------- 펫 ---------- */

/** 발밑 타원 그림자. 없으면 펫이 지면에서 떠 보인다(design.md §6). */
function drawShadow(pet, frameWidth) {
  const radiusX = (frameWidth * PET_SCALE) / 4;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(pet.x, pet.y - 2, radiusX, radiusX / 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 활성 펫 표시 — 2px 금색 점선(design.md §6). 블러는 도트 엣지를 뭉갠다. */
function drawSelection(box) {
  ctx.save();
  ctx.strokeStyle = '#FFD166';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(box.left - 3, box.top - 3, box.width + 6, box.height + 6);
  ctx.restore();
}

/**
 * 한 프레임을 그리고, 이번 프레임의 클릭 판정 상자를 만들어 돌려준다.
 *
 * 판정 상자를 그리는 순간에 만드는 이유: 프레임마다 크기가 다를 수 있고(종·단계별 캔버스
 * 차이), 위치는 매 프레임 바뀐다. 따로 계산하면 보이는 것과 눌리는 것이 어긋난다.
 */
function drawPets(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const boxes = [];
  for (const pet of inDrawOrder(room.roaming)) {
    const player = room.players.get(pet.ownedPetId);
    if (!player) continue;

    const frame = player.frameAt(now);
    const box = drawBoxOf(pet, frame.sw, frame.sh);

    drawShadow(pet, frame.sw);
    if (pet.ownedPetId === room.activePetId) drawSelection(box);
    drawFrame(ctx, frame, box.left, box.top, PET_SCALE);

    boxes.push(box);
  }
  return boxes;
}

/* ---------- 상세 패널 ---------- */

function renderDetail() {
  const view = room.selectedPetId ? room.views.get(room.selectedPetId) : undefined;
  if (!view) {
    detailEl.hidden = true;
    return;
  }

  detailEl.hidden = false;
  detailName.textContent = view.name;

  detailGrade.className = `grade-badge grade-badge--${view.rarity.toLowerCase()}`;
  detailGrade.replaceChildren();
  const gem = document.createElement('span');
  gem.className = 'grade-badge__gem';
  detailGrade.append(gem, document.createTextNode(GRADE_LABEL[view.rarity] ?? view.rarity));

  detailLevel.textContent = `Lv.${view.level} · ${view.stage}단계`;

  const ratio = mockXpRatio(view.level);
  detailXp.style.width = `${Math.round(ratio * 100)}%`;
  // 진행을 색으로만 말하지 않는다(design.md §6).
  detailXpLabel.textContent = `EXP ${Math.round(ratio * 100)}%`;
  detailNote.textContent = '경험치는 성장 로직이 붙기 전까지 레벨에서 만든 표시값입니다.';

  const isActive = view.ownedPetId === room.activePetId;
  detailActivate.textContent = isActive ? '오버레이 활성 중' : '오버레이로 지정';
  detailActivate.disabled = isActive;
}

/* ---------- 입력 ---------- */

/** 이번 프레임의 판정 상자. 클릭은 화면에 보이는 것을 기준으로 맞아야 한다. */
let hitBoxes = [];

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  // 창이 정수 배율로 확대돼 있어도 캔버스 좌표계로 되돌린다.
  const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
  const y = ((event.clientY - rect.top) * canvas.height) / rect.height;

  const ownedPetId = hitTest(hitBoxes, x, y);
  if (!ownedPetId) {
    room.selectedPetId = null;
    renderDetail();
    return;
  }

  // 클릭 반응은 이 창의 연출이라 즉시 재생한다. 활성 펫 지정과는 별개다.
  room.players.get(ownedPetId)?.playClick();
  room.selectedPetId = ownedPetId;
  renderDetail();
});

detailClose.addEventListener('click', () => {
  room.selectedPetId = null;
  renderDetail();
});

detailActivate.addEventListener('click', () => {
  if (!room.selectedPetId) return;
  // 호출만 한다. 화면은 `room:activePetChanged`를 받고 나서 바뀐다.
  api.setActivePet(room.selectedPetId);
});

/* ---------- 공유 루프 ---------- */

/**
 * 전 펫을 매 프레임 **한 번에** 갱신한다.
 *
 * 펫마다 rAF를 돌리면 각자 다른 `dt`를 보고 위치가 서로 드리프트하며, 콜백 수도 마리 수에
 * 비례해 늘어난다. 루프는 하나여야 한다.
 */
function startLoop() {
  let last = performance.now();

  const tick = (now) => {
    const dt = (now - last) / 1000;
    last = now;

    // 움직임을 줄여 달라고 했으면 배회를 멈춘다. idle 애니메이션은 계속 돈다 —
    // 그건 펫이 살아 있다는 표시이지 장식용 반복이 아니다.
    if (!reducedMotion.matches && room.walkArea) {
      stepRoaming(room.roaming, room.walkArea, dt, Math.random);
    }

    updateFireflies(now);
    hitBoxes = drawPets(now);

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

/* ---------- 적재 ---------- */

async function applyBackground(background) {
  const metaUrl = backgroundAssetPath(background.directory, background.metaFile);
  const meta = await fetchJson(metaUrl);

  canvas.width = meta.width;
  canvas.height = meta.height;
  ctx.imageSmoothingEnabled = false;

  await buildLayers(background, meta);

  const previous = room.walkArea;
  room.walkArea = walkAreaOf(meta);
  // 배경 이름이 이미 낮/밤을 말하므로 위상은 이름이 없을 때만 쓴다.
  phaseEl.textContent = meta.name ?? PHASE_LABEL[background.phase] ?? background.phase;

  // 배경이 바뀌면 배회 영역도 바뀔 수 있다. 이미 서 있는 펫을 새 영역 안으로 데려온다.
  if (previous) {
    for (const pet of room.roaming) {
      const moved = spawnRoamingPet(pet.ownedPetId, room.walkArea, Math.random);
      pet.x = moved.x;
      pet.y = moved.y;
      pet.targetX = moved.x;
      pet.targetY = moved.y;
    }
  }
}

async function loadPets(views) {
  room.views = new Map(views.map((view) => [view.ownedPetId, view]));
  room.activePetId = views.find((view) => view.isActive)?.ownedPetId ?? null;

  const players = await Promise.all(
    views.map(async (view) => {
      try {
        return [view.ownedPetId, await SpritePlayer.load(view)];
      } catch (error) {
        // 한 마리를 못 읽어도 나머지는 나온다.
        showError(`${view.name}의 스프라이트를 읽지 못했습니다 — ${error.message}`);
        return null;
      }
    }),
  );

  room.players = new Map(players.filter(Boolean));
  room.roaming = views
    .filter((view) => room.players.has(view.ownedPetId))
    .map((view) => spawnRoamingPet(view.ownedPetId, room.walkArea, Math.random));
}

/* ---------- push 구독 ---------- */

api.on('room:activePetChanged', (view) => {
  if (!view) return;
  room.activePetId = view.ownedPetId;
  // 명부의 다른 값(레벨 등)도 함께 온 최신값으로 맞춘다.
  room.views.set(view.ownedPetId, view);
  renderDetail();
});

api.on('room:backgroundChanged', (background) => {
  applyBackground(background).catch((error) => {
    showError(`배경을 바꾸지 못했습니다 — ${error.message}`);
  });
});

/* ---------- 시작 ---------- */

window.addEventListener('load', async () => {
  try {
    const scene = await api.roomScene();
    await applyBackground(scene.background);
    await loadPets(scene.pets);

    api.debugLog(
      `[PETROOM] ${scene.background.id}(${scene.background.phase}) · ` +
        `펫 ${room.players.size}/${scene.pets.length}마리 · ` +
        `배회 영역 ${JSON.stringify(room.walkArea)} · ` +
        `반딧불이 ${room.animationFrames.length}프레임`,
    );

    startLoop();
  } catch (error) {
    showError(`펫룸을 열지 못했습니다 — ${error.message}`);
  }
});
