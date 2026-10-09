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
  auraOf,
  auraRingsAt,
  AURA_ROUNDNESS,
  backgroundAssetPath,
  backgroundFrameIndexAt,
  drawBoxOf,
  fireflyAlpha,
  fireflyCountFor,
  fireflyDotAt,
  FIREFLY_GLOW_RADIUS,
  clipWalkAreaToViewport,
  hitTest,
  inDrawOrder,
  isDragGesture,
  layersInDrawOrder,
  PET_SCALE,
  SCENE_SCALE,
  spawnFireflies,
  spawnRoamingPet,
  spawnWeather,
  stepRoaming,
  viewportOf,
  walkAreaOf,
  weatherAlpha,
  weatherColor,
  weatherCountFor,
  weatherDotAt,
  weatherFor,
  WEATHER_DEPTHS,
} from '../dist/index.js';
import { assetUrl } from './assets.js';
import { drawFrame, fetchJson, loadImage, SpritePlayer } from './sprite.js';

const api = window.petApi;

const sceneEl = document.getElementById('scene');
const stageEl = document.getElementById('stage');
const destinationsEl = document.getElementById('destinations');
const dexNewEl = document.getElementById('dex-new');
const layersEl = document.getElementById('layers');
const canvas = document.getElementById('pets');
const ctx = canvas.getContext('2d');
const emptyEl = document.getElementById('empty');
const errorEl = document.getElementById('error');

const detailEl = document.getElementById('detail');
const detailName = document.getElementById('detail-name');
const detailGrade = document.getElementById('detail-grade');
const detailLevel = document.getElementById('detail-level');
const detailActivate = document.getElementById('detail-activate');
const detailClose = document.getElementById('detail-close');

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
  /** 창이 보여 주는 장면 영역. 배경마다 다르므로 배경을 적용할 때 정한다. */
  viewport: null,
  /** 배경 애니메이션의 프레임 `<img>` 목록. 프레임을 가진 배경에서만 쓴다. */
  animationFrames: [],
  animation: null,
  /**
   * 런타임이 찍는 반딧불이.
   *
   * 프레임 PNG를 쓰지 않는 이유는 `domain/firefly.ts` 머리말에 있다 — 배경이
   * 16장이 되면 프레임도 16벌이 되고, 짧은 루프는 반복이 눈에 띈다.
   */
  fireflies: [],
  /** 떨어지는 것들. 계절이 종류를 정하고, 없으면 kind 가 null 이다. */
  weather: { kind: null, particles: [], area: { x: 0, y: 0, width: 0, height: 0 } },
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
          loadImage(assetUrl(backgroundAssetPath(background.directory, file))),
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

    const image = await loadImage(assetUrl(backgroundAssetPath(background.directory, layer.file)));
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

/**
 * 등급 색을 CSS 변수에서 읽는다.
 *
 * 팔레트를 여기 적지 않는 이유: 같은 색이 상세 패널의 등급 배지에도 쓰인다. 두 곳에 적으면
 * 한쪽만 고쳐져 같은 등급이 화면에서 두 색으로 보인다. `petroom.css`가 단 하나의 출처다.
 *
 * 빈 값은 **캐시하지 않는다.** 스타일 적용 전에 불리면 `''`가 나오는데, `fillStyle = ''`는
 * 캔버스가 통째로 무시해서 직전 색(첫 호출이면 검정)이 남는다. 그걸 캐시하면 새로고침
 * 전까지 검은 오라가 박힌다.
 */
const gradeColors = new Map();
function gradeColor(token) {
  const cached = gradeColors.get(token);
  if (cached) return cached;

  const color = getComputedStyle(document.documentElement)
    .getPropertyValue(`--grade-${token}`)
    .trim();
  if (!color) return '#FFD166';
  gradeColors.set(token, color);
  return color;
}

/**
 * 펫 프레임을 단색 실루엣으로 만드는 도장.
 *
 * `source-in` 합성으로 **알파는 스프라이트에서, 색은 통째로 한 색에서** 가져온다. 펫 픽셀이
 * 완전 불투명 아니면 완전 투명이라(design.md §4) 결과도 계단 없는 도트 실루엣이다.
 *
 * 캔버스는 역할마다 **따로** 둔다. 하나를 돌려 쓰면 두 이름이 같은 버퍼를 가리키게 되고,
 * 나중에 그리는 순서를 바꾸는 편집 한 번에 색이 조용히 뒤바뀐다 — 예외도 안 나서 눈으로만
 * 잡힌다.
 *
 * 크기가 같으면 `width`를 다시 대입하지 않는다. 캔버스 크기 대입은 값이 같아도 백버퍼를
 * 재할당하고 컨텍스트 상태를 초기화한다 — 매 프레임 도는 자리에서는 이쪽이 blit 보다 비싸다.
 */
function createStamp() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  return (frame, color) => {
    if (canvas.width !== frame.sw) canvas.width = frame.sw;
    if (canvas.height !== frame.sh) canvas.height = frame.sh;
    context.imageSmoothingEnabled = false;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, frame.sw, frame.sh);
    context.drawImage(
      frame.image,
      frame.sx,
      frame.sy,
      frame.sw,
      frame.sh,
      0,
      0,
      frame.sw,
      frame.sh,
    );
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, frame.sw, frame.sh);
    return canvas;
  };
}

const gradeStamp = createStamp();
const goldStamp = createStamp();

/**
 * 부풀릴 방향. 각도를 촘촘히 나눌수록 테두리가 둥글어진다.
 *
 * 여덟 방향이면 팔각형이라 모서리가 각지게 보인다. 열여섯이면 이 크기(반지름 2~13px)에서
 * 눈으로 원과 구분되지 않으면서 찍는 횟수는 두 배로만 는다.
 */
const AURA_DIRECTIONS = Array.from({ length: 16 }, (unused, index) => {
  const angle = (index / 16) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
});

/**
 * 오라를 만드는 데 쓰는 오프스크린 세 장.
 *
 * `work` 이번 고리, `kept` 이번 고리를 다음 차례를 위해 보관, `prev` 직전 고리.
 * 셋을 두는 이유: 띠를 만들려면 이번 모양에서 직전 모양을 도려내야 하는데, 도려내고 나면
 * 이번 모양이 사라져 다음 고리가 쓸 것이 없어진다.
 *
 * 매 프레임 새로 만들지 않는다. 크기가 같으면 `width` 대입도 건너뛴다 — 캔버스 크기 대입은
 * 값이 같아도 백버퍼를 재할당하고 컨텍스트 상태를 초기화한다.
 */
function createLayer() {
  const canvas = document.createElement('canvas');
  return { canvas, context: canvas.getContext('2d') };
}
const auraWork = createLayer();
const auraKept = createLayer();
const auraPrev = createLayer();

function resizeLayer(layer, width, height) {
  if (layer.canvas.width !== width) layer.canvas.width = width;
  if (layer.canvas.height !== height) layer.canvas.height = height;
  layer.context.imageSmoothingEnabled = false;
}

/**
 * 실루엣을 반지름 `radius`만큼 **원판으로** 부풀려 그린다.
 *
 * 중심을 먼저 찍고 각 방향으로 민다. 원판 부풀리기는 반지름이 더해지므로
 * (`AURA_ROUNDNESS + ring.offset`) 두 번 나눠 할 필요가 없다.
 */
function dilateInto(context, stamp, box, pad, radius) {
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(stamp, pad, pad, box.width, box.height);
  for (const [ux, uy] of AURA_DIRECTIONS) {
    context.drawImage(
      stamp,
      pad + Math.round(ux * radius),
      pad + Math.round(uy * radius),
      box.width,
      box.height,
    );
  }
}

/** 한 장을 다른 장으로 통째로 옮긴다. `copy`라 지우고 그리는 두 단계가 필요 없다. */
function copyLayer(from, to) {
  to.context.globalCompositeOperation = 'copy';
  to.context.drawImage(from.canvas, 0, 0);
}

/**
 * 활성 펫 표시 — 펫을 감싸는 등급 색 오라.
 *
 * 상자를 두르지 않는다. 네모는 펫이 아니라 판정 상자를 그리는 것이라, 무엇이 빛나는지가
 * 아니라 "무엇이 선택 상자에 갇혔는지"로 읽힌다.
 *
 * 고리 수와 맥동은 `@pet/room`의 `auraRingsAt`이 정한다(가챠의 등급 연출과 같은 눈금).
 *
 * ## 왜 실루엣을 그대로 따라가지 않는가
 *
 * 실루엣을 그대로 두르면 팔·다리·귀를 따라 흘러서, 빛이 아니라 펫을 한 겹 더 그린 것처럼
 * 보인다. `AURA_ROUNDNESS`만큼 먼저 부풀려 좁은 홈을 메우면 덩어리진 빛으로 읽힌다.
 *
 * ## 왜 고리를 도넛으로 만드는가
 *
 * 부푼 모양을 화면에 그대로 겹쳐 찍으면 알파가 `1-(1-α)^n`으로 누적돼, 도메인이 0.85라고 한
 * 고리가 실제로는 불투명하게 나온다. 그러면 **테스트가 지키는 숫자가 화면을 설명하지 못한다**
 * — 규칙을 도메인으로 올린 이유가 사라진다. 그래서 고리마다 직전 고리를 도려내 겹치지 않는
 * 띠로 만들고, 그 띠를 `ring.alpha`로 딱 한 번 올린다.
 *
 * `shadowBlur`는 쓰지 않는다. 부드러운 글로우는 도트 엣지를 뭉개서, 정수 배율
 * nearest-neighbor 로 그린 스프라이트 옆에서 오라만 흐릿하게 뜬다(design.md §4).
 *
 * `box`가 이미 `PET_SCALE`만큼 확대된 크기라 오프셋과 반지름은 모두 캔버스 픽셀이다.
 */
function drawAura(view, box, frame, now) {
  const spec = auraOf(view.rarity);
  const rings = auraRingsAt(spec, now, reducedMotion.matches);
  const outermost = rings[rings.length - 1];
  if (!outermost) return;

  const pad = outermost.offset + AURA_ROUNDNESS;
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  for (const layer of [auraWork, auraKept, auraPrev]) resizeLayer(layer, width, height);

  const stamp = gradeStamp(frame, gradeColor(spec.token));

  // 첫 고리가 도려낼 자리는 펫 실루엣이다. 부풀린 만큼이 그대로 빛으로 남는다.
  auraPrev.context.globalCompositeOperation = 'source-over';
  auraPrev.context.clearRect(0, 0, width, height);
  auraPrev.context.drawImage(stamp, pad, pad, box.width, box.height);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const ring of rings) {
    dilateInto(auraWork.context, stamp, box, pad, AURA_ROUNDNESS + ring.offset);
    copyLayer(auraWork, auraKept);

    auraWork.context.globalCompositeOperation = 'destination-out';
    auraWork.context.drawImage(auraPrev.canvas, 0, 0);

    ctx.globalAlpha = ring.alpha;
    ctx.drawImage(auraWork.canvas, box.left - pad, box.top - pad);

    copyLayer(auraKept, auraPrev);
  }

  // 선택 표시(design.md §6). 등급 고리보다 안쪽이라 등급 색을 덮지 않는다 — 같은 거리에
  // 두었더니 COMMON 회색이 화면에서 아예 사라졌다.
  ctx.globalAlpha = 1;
  const gold = goldStamp(frame, '#FFD166');
  for (const [ux, uy] of AURA_DIRECTIONS) {
    ctx.drawImage(gold, box.left + Math.round(ux), box.top + Math.round(uy), box.width, box.height);
  }
  ctx.restore();
}

/**
 * 한 프레임을 그리고, 이번 프레임의 클릭 판정 상자를 만들어 돌려준다.
 *
 * 판정 상자를 그리는 순간에 만드는 이유: 프레임마다 크기가 다를 수 있고(종·단계별 캔버스
 * 차이), 위치는 매 프레임 바뀐다. 따로 계산하면 보이는 것과 눌리는 것이 어긋난다.
 */
/** 떨어지는 것들의 외곽선. 펫 스프라이트와 같은 색이다(design.md §4). */
const WEATHER_OUTLINE = '#2C2438';

/** 반딧불이 빛. 선택 표시(금색)와 같은 색이지만 알파가 낮아 혼동되지 않는다. */
const FIREFLY_COLOR = '#FFD166';

/**
 * 반딧불이를 찍는다.
 *
 * 중심 한 점에 사각 띠를 덧대 빛 번짐을 흉내 낸다. `shadowBlur`나 방사형
 * 그라데이션을 쓰지 않는 이유는 오라와 같다 — 부드러운 빛은 도트 엣지를 뭉개서
 * 정수 배율 화면에서 그 점만 혼자 흐려 보인다(`design.md` §4).
 *
 * 바깥 띠부터 그려야 중심이 위에 남는다.
 */
function drawFireflies(now) {
  if (room.fireflies.length === 0) return;

  const still = reducedMotion.matches;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = FIREFLY_COLOR;

  for (const fly of room.fireflies) {
    const dot = fireflyDotAt(fly, now, still);
    if (dot.level <= 0) continue;

    for (let ring = FIREFLY_GLOW_RADIUS - 1; ring >= 0; ring -= 1) {
      const alpha = fireflyAlpha(dot.level, ring);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      const size = ring * 2 + 1;
      ctx.fillRect(dot.x - ring, dot.y - ring, size, size);
    }
  }

  ctx.restore();
}

/**
 * 눈·꽃잎·낙엽을 찍는다.
 *
 * `near`가 참이면 가장 가까운 깊이만, 거짓이면 나머지만 그린다. 펫을 사이에
 * 두고 두 번 불러 **먼 것은 펫 뒤로, 가까운 것은 앞으로** 지나가게 하려는
 * 것이다. 한 번에 다 그리면 눈이 전부 펫 뒤에 깔려 평평해 보인다.
 */
function drawWeather(now, near) {
  const { kind, particles, area } = room.weather;
  if (!kind || particles.length === 0) return;

  const still = reducedMotion.matches;
  const color = weatherColor(kind);
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const particle of particles) {
    const front = particle.depth === WEATHER_DEPTHS - 1;
    if (front !== near) continue;
    const dot = weatherDotAt(particle, kind, area, now, still);
    const alpha = weatherAlpha(dot.depth);

    // 흰 눈은 겨울 낮 배경(거의 흰색) 위에서 사라진다. 도트 아트가 쓰는 해법은
    // 외곽선이다 — 펫 스프라이트가 `#2C2438`로 형태를 세우는 것과 같다. 옅게
    // 깔아 무거워 보이지 않게 한다.
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = WEATHER_OUTLINE;
    ctx.fillRect(dot.x - 1, dot.y - 1, dot.size + 2, dot.size + 2);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(dot.x, dot.y, dot.size, dot.size);
  }

  ctx.restore();
}

function drawPets(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 펫보다 먼저 — 반딧불이는 배경과 펫 사이 공기에 떠 있다.
  drawFireflies(now);
  drawWeather(now, false);

  const boxes = [];
  for (const pet of inDrawOrder(room.roaming)) {
    const player = room.players.get(pet.ownedPetId);
    if (!player) continue;

    const frame = player.frameAt(now);
    const box = drawBoxOf(pet, frame.sw, frame.sh);

    drawShadow(pet, frame.sw);
    // 오라는 스프라이트보다 **먼저** 칠한다. 뒤에 칠하면 펫 위에 색이 얹혀 도트가 탁해진다.
    if (pet.ownedPetId === room.activePetId) {
      const view = room.views.get(pet.ownedPetId);
      if (view) drawAura(view, box, frame, now);
    }
    drawFrame(ctx, frame, box.left, box.top, PET_SCALE);

    boxes.push(box);
  }

  // 가장 가까운 깊이는 펫 앞을 지난다. 눈이 전부 뒤에만 깔리면 평평해 보인다.
  drawWeather(now, true);

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
  // 등급은 COMMON·RARE·EPIC 영문 대문자로 쓴다(design.md §2).
  detailGrade.append(gem, document.createTextNode(view.rarity));

  detailLevel.textContent = `Lv.${view.level} · ${view.stage}단계`;

  const isActive = view.ownedPetId === room.activePetId;
  detailActivate.textContent = isActive ? '오버레이 활성 중' : '오버레이로 지정';
  detailActivate.disabled = isActive;
}

/* ---------- 입력 ---------- */

/** 이번 프레임의 판정 상자. 클릭은 화면에 보이는 것을 기준으로 맞아야 한다. */
let hitBoxes = [];

/**
 * 장면을 끌면 창이 옮겨진다. 장면은 펫 클릭을 받아야 해서 `-webkit-app-region: drag`를 쓸 수
 * 없으므로, 누른 뒤 문턱만큼 움직였을 때부터 끌기로 보고 창 이동은 main에 맡긴다. 문턱을
 * 넘지 않은 누름은 그대로 아래 `click`이 펫 판정을 한다.
 */
let sceneDrag = null;
/**
 * 끌기로 끝난 누름 뒤에 브라우저가 보내는 `click`을 펫 선택으로 받지 않는다. 끄는 동안 포인터를
 * 붙잡으므로 그 `click`은 캔버스가 아니라 장면에 갈 수 있어서, 창 전체의 capture 단계에서 막는다.
 */
let suppressNextClick = false;

window.addEventListener(
  'click',
  (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.stopPropagation();
  },
  true,
);

sceneEl.addEventListener('pointerdown', (event) => {
  // 직전 끌기 뒤에 `click`이 오지 않았더라도 다음 클릭까지 삼키지 않는다.
  suppressNextClick = false;
  if (event.button !== 0) return;
  sceneDrag = { screenX: event.screenX, screenY: event.screenY, moved: false };
});

sceneEl.addEventListener('pointermove', (event) => {
  if (!sceneDrag) return;
  if (!sceneDrag.moved) {
    if (!isDragGesture(sceneDrag, event)) return;
    sceneDrag.moved = true;
    // 클릭일 때는 붙잡지 않는다. 붙잡으면 `click`의 대상이 캔버스에서 장면으로 바뀐다.
    // 끌기부터 붙잡아야 빠르게 끌어 포인터가 창 밖으로 나가도 계속 따라온다.
    sceneEl.setPointerCapture(event.pointerId);
    // 시작점은 누른 곳이다. 문턱만큼 늦게 시작하면 창이 그만큼 포인터보다 뒤처진다.
    api.roomDragStart(sceneDrag.screenX, sceneDrag.screenY);
  }
  api.roomDragMove(event.screenX, event.screenY);
});

function endSceneDrag() {
  if (!sceneDrag) return;
  if (sceneDrag.moved) {
    api.roomDragEnd();
    suppressNextClick = true;
  }
  sceneDrag = null;
}

sceneEl.addEventListener('pointerup', endSceneDrag);
sceneEl.addEventListener('pointercancel', endSceneDrag);

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

document.querySelector('.window-close').addEventListener('click', () => window.close());

// 뽑기·합성 화면으로 넘어간다. 실패해도 펫룸은 그대로 살아 있어야 하므로 오류만 보여 준다.
destinationsEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-destination]');
  if (!button) return;
  api
    .navigateFromRoom(button.dataset.destination)
    .catch((error) => showError(`화면을 옮기지 못했습니다 — ${error.message}`));
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
    // 다음 프레임을 **먼저** 예약한다. 마지막에 예약하면 그리는 도중 예외가 한 번만 나도
    // 다시 예약되지 않아 배회·idle·선택이 통째로 멈춘 채 창만 남는다.
    requestAnimationFrame(tick);

    const dt = (now - last) / 1000;
    last = now;

    // 움직임을 줄여 달라고 했으면 배회를 멈춘다. idle 애니메이션은 계속 돈다 —
    // 그건 펫이 살아 있다는 표시이지 장식용 반복이 아니다.
    if (!reducedMotion.matches && room.walkArea) {
      stepRoaming(room.roaming, room.walkArea, dt, Math.random);
    }

    updateFireflies(now);
    hitBoxes = drawPets(now);
  };

  requestAnimationFrame(tick);
}

/* ---------- 적재 ---------- */

/**
 * 마지막으로 시작한 배경 적용의 번호.
 *
 * `applyBackground`는 메타와 이미지를 기다린다. 그 사이에 다음 선택이 들어오면
 * 두 적용이 겹치고, 늦게 끝난 쪽이 화면과 선택기를 덮어쓴다 — 미리보기 드롭다운을
 * 빠르게 바꿨을 때 실제로 엉뚱한 장면이 남았다. 번호가 밀린 적용은 조용히 버린다.
 */
let applySeq = 0;

async function applyBackground(background) {
  const seq = ++applySeq;
  const metaUrl = assetUrl(backgroundAssetPath(background.directory, background.metaFile));
  const meta = await fetchJson(metaUrl);
  if (seq !== applySeq) return;

  canvas.width = meta.width;
  canvas.height = meta.height;
  ctx.imageSmoothingEnabled = false;

  await buildLayers(background, meta);
  if (seq !== applySeq) return;

  // 무대를 배경 크기로 두고 `SCENE_SCALE`배로 키운 뒤 보이는 영역만큼 밀어 올린다. 캔버스와
  // 레이어는 계속 배경 좌표계에 있으므로 배회·클릭 판정은 이 값을 몰라도 된다(클릭은 캔버스
  // 화면 크기로 되돌려 계산한다).
  const viewport = viewportOf(meta);
  room.viewport = viewport;
  stageEl.style.width = `${meta.width}px`;
  stageEl.style.height = `${meta.height}px`;
  stageEl.style.transform = `scale(${SCENE_SCALE})`;
  // 창 픽셀 단위로 민다. 반 픽셀 위치는 화면을 흐리게 만든다.
  stageEl.style.left = `${-Math.round(viewport.x * SCENE_SCALE)}px`;
  stageEl.style.top = `${-Math.round(viewport.y * SCENE_SCALE)}px`;

  const previous = room.walkArea;
  // 배경이 정한 배회 영역을 보이는 영역 안으로 좁힌다. 좁히지 않으면 펫이 잘린 바깥으로
  // 걸어 나가 사라진다.
  room.walkArea = clipWalkAreaToViewport(walkAreaOf(meta), viewport);

  // 반딧불이는 지면 위 공기에 뜬다 — 수평선과 지면 사이, 지면보다 조금 아래까지.
  // 계절과 시간대가 마릿수를 정한다(겨울과 낮에는 0마리).
  const count = fireflyCountFor(background.season, background.phase);
  const top = meta.horizon ?? Math.round(meta.height * 0.4);
  room.fireflies = count
    ? spawnFireflies(
        {
          x: room.walkArea.x,
          y: top,
          width: room.walkArea.width,
          height: room.walkArea.y + room.walkArea.height - top,
        },
        count,
        Math.random,
      )
    : [];

  // 눈·꽃잎·낙엽은 하늘 끝에서 지면까지 화면 전체를 지난다. 반딧불이와 달리
  // 좌우 끝까지 쓴다 — 가장자리가 비면 화면 밖에서 불어오는 느낌이 사라진다.
  //
  // "화면 전체"는 배경 원본이 아니라 **보이는 영역**이다. 배경 960x360에 뿌리면 그 중
  // 640x240만 보여 실제 밀도가 44%로 떨어진다.
  const weatherKind = weatherFor(background.season);
  const weatherArea = { ...viewport };
  const weatherCount = weatherCountFor(background.season, background.phase);
  room.weather = {
    kind: weatherKind,
    area: weatherArea,
    particles:
      weatherKind && weatherCount
        ? spawnWeather(weatherArea, weatherKind, weatherCount, Math.random)
        : [],
  };
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
  // 보유 펫이 없으면 장면 가운데에 뽑기 안내를 띄운다.
  emptyEl.hidden = views.length > 0;

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
  const previous = room.views.get(view.ownedPetId);
  room.activePetId = view.ownedPetId;
  // 명부의 다른 값(레벨 등)도 함께 온 최신값으로 맞춘다.
  room.views.set(view.ownedPetId, view);
  renderDetail();

  // 진화하면 스프라이트 시트 파일 자체가 바뀐다. 다시 읽지 않으면 상세 패널의 숫자만
  // 갱신되고 **캔버스를 배회하는 펫은 창을 닫았다 열 때까지 옛 단계 그림으로 남는다.**
  if (previous && previous.stage !== view.stage) {
    SpritePlayer.load(view)
      .then((player) => room.players.set(view.ownedPetId, player))
      .catch((error) => {
        showError(`${view.name}의 스프라이트를 다시 읽지 못했습니다 — ${error.message}`);
      });
  }
});

// 뽑기·합성으로 보유 펫이 바뀌었다. 지워진 펫이 남아 있으면 지정할 때 실패하므로 다시 세운다.
api.on('room:rosterChanged', (views) => {
  refreshDexBadge();
  loadPets(views)
    .then(() => {
      if (room.selectedPetId && !room.views.has(room.selectedPetId)) room.selectedPetId = null;
      renderDetail();
    })
    .catch((error) => showError(`보유 펫을 다시 읽지 못했습니다 — ${error.message}`));
});

// 시각이 넘어갔거나 오버레이의 Growth Debug 에서 계절·시간대를 골랐다. 어느 쪽이든 main 이
// 정한 배경을 그대로 따른다.
api.on('room:backgroundChanged', (background) => {
  applyBackground(background).catch((error) => {
    showError(`배경을 바꾸지 못했습니다 — ${error.message}`);
  });
});

// 펫룸이 열린 채 다른 창(도감)에서 NEW 를 확인했을 수 있다. 돌아오면 다시 읽는다.
window.addEventListener('focus', () => refreshDexBadge());

// 도감의 `펫룸에서 보기`. 이미 열려 있던 펫룸이면 main 이 이 이벤트로 알린다.
api.on('room:focusPet', (ownedPetId) => focusPet(ownedPetId));

/**
 * 그 개체를 클릭한 것처럼 상세를 연다. 명부에 없으면(그사이 합성됨) 아무것도 고르지 않고
 * `false`를 돌려준다.
 */
function focusPet(ownedPetId) {
  if (!ownedPetId || !room.views.has(ownedPetId)) return false;
  room.selectedPetId = ownedPetId;
  room.players.get(ownedPetId)?.playClick();
  renderDetail();
  return true;
}

/**
 * 창을 열 때 넘겨받은 `?focus=`를 한 번만 꺼낸다. 주소에 남겨 두면 새로 고칠 때마다 그 개체가
 * 다시 골라진다.
 */
function takeFocusQuery() {
  const url = new URL(window.location.href);
  const focus = url.searchParams.get('focus');
  if (focus === null) return null;
  url.searchParams.delete('focus');
  history.replaceState(null, '', url);
  return focus;
}

/**
 * 도감 버튼의 NEW 표식. 읽지 못하면 표식만 빼고 펫룸은 그대로 쓴다 — 표식 하나 때문에
 * 펫룸을 오류 화면으로 만들 이유가 없다.
 */
function refreshDexBadge() {
  api
    .dexHasNew()
    .then((hasNew) => {
      dexNewEl.hidden = !hasNew;
    })
    .catch((error) => {
      dexNewEl.hidden = true;
      api.debugLog(`[PETROOM] 도감 NEW 표식을 읽지 못했습니다 — ${error.message}`);
    });
}

/* ---------- 시작 ---------- */

window.addEventListener('load', async () => {
  try {
    refreshDexBadge();
    const scene = await api.roomScene();
    await applyBackground(scene.background);
    await loadPets(scene.pets);
    // 처음 열면 상세를 바로 보여 준다. 도감의 `펫룸에서 보기`로 왔으면 그 개체를, 아니면 지금
    // 오버레이에 떠 있는 활성 펫을 클릭한 것과 같게 연다. 보유 펫이 없으면 아무것도 고르지 않는다.
    // 넘겨받은 개체가 그사이 합성으로 사라졌으면 활성 펫으로 대신한다.
    if (!focusPet(takeFocusQuery())) focusPet(room.activePetId);

    api.debugLog(
      `[PETROOM] ${scene.background.id}(${scene.background.phase}) · ` +
        `펫 ${room.players.size}/${scene.pets.length}마리 · ` +
        `보이는 영역 ${JSON.stringify(room.viewport)} · ` +
        `배회 영역 ${JSON.stringify(room.walkArea)} · ` +
        `반딧불이 ${room.animationFrames.length}프레임`,
    );

    startLoop();
  } catch (error) {
    showError(`펫룸을 열지 못했습니다 — ${error.message}`);
  }
});
