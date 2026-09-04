// 펫 창(오버레이).
//
// 스프라이트 로딩·재생은 `sprite.js`가 하고, 그 규칙은 `@pet/room`의 도메인 함수에 있다.
// 예전에는 이 파일이 재생기를 직접 들고 있어서 펫룸이 같은 코드를 다시 쓸 수 없었고,
// 에셋 가이드가 실패 원인 1~4순위로 꼽은 규칙들에 테스트가 하나도 없었다.
//
// 이 파일에 남은 것은 오버레이 고유의 일뿐이다 — 창 크기에 맞춘 배율, 우클릭 메뉴,
// 말풍선, 그리고 활성 펫이 바뀌면 재시작 없이 갈아 끼우는 것.

import { stageOfLevel } from '../../../packages/pet-room/dist/index.js';
import { drawFrame, SpritePlayer } from './sprite.js';

// preload가 노출한 API. 렌더러는 Node에도 임의 IPC 채널에도 닿지 못한다.
const api = window.petApi;

const stage = document.getElementById('stage');
const canvas = document.getElementById('sprite');
const menu = document.getElementById('menu');
const bubble = document.getElementById('bubble');
const ctx = canvas.getContext('2d');

/** 지금 그리는 펫. 활성 펫이 바뀌면 통째로 갈린다. */
const overlay = { player: null, scale: 1 };

/* ---------- 재생 ---------- */

/** 창 크기에 맞는 **정수** 배율. 비정수 배율은 픽셀을 뭉갠다(에셋 가이드 §7). */
function fitScale(meta) {
  const available = Math.min(window.innerWidth, window.innerHeight) - 8;
  return Math.max(1, Math.floor(available / meta.frameWidth));
}

function resizeCanvas() {
  if (!overlay.player) return;
  const meta = overlay.player.meta;
  overlay.scale = fitScale(meta);
  canvas.width = meta.frameWidth * overlay.scale;
  canvas.height = meta.frameHeight * overlay.scale;
  // 캔버스 크기를 바꾸면 컨텍스트 설정이 초기화되므로 다시 끈다.
  ctx.imageSmoothingEnabled = false;
}

function loop(now) {
  if (overlay.player) {
    const frame = overlay.player.frameAt(now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(ctx, frame, 0, 0, overlay.scale);
  }
  requestAnimationFrame(loop);
}

/* ---------- 적재 ---------- */

/**
 * 오버레이 펫을 갈아 끼운다.
 *
 * `pet:overlay`가 주는 `PetSummary`와 `room:activePetChanged`가 주는 `RoomPetView`는
 * 필드 이름이 조금 다르다. 여기서 한 모양으로 맞춘다.
 */
function speciesOfPayload(payload) {
  return {
    rarity: payload.rarity,
    // PetSummary는 `sprite`, RoomPetView는 `slug`로 같은 값을 부른다.
    slug: payload.slug ?? payload.sprite,
    petId: payload.petId,
    stage: payload.stage ?? stageOfLevel(payload.level),
  };
}

async function showPet(payload) {
  const species = speciesOfPayload(payload);
  overlay.player = await SpritePlayer.load(species);
  stage.classList.remove('sprite-missing');
  resizeCanvas();

  const meta = overlay.player.meta;
  api.debugLog(
    `${payload.name}(${species.rarity}) Lv.${payload.level} → stage${species.stage} · ` +
      `프레임 ${meta.frameWidth}×${meta.frameHeight} ${meta.frameCount}장 @${meta.fps}fps · ` +
      `배율 ${overlay.scale}x → ${canvas.width}px`,
  );
}

/**
 * 캔버스에 실제로 칠해진 픽셀이 있는지 확인한다.
 *
 * 스프라이트 파일을 읽는 데 성공했다는 것과 화면에 그려졌다는 것은 다른 얘기다.
 * 배율 계산이나 소스 사각형이 틀리면 파일은 멀쩡한데 캔버스가 비어 있을 수 있다.
 */
function reportDrawnPixels() {
  // 첫 프레임이 그려질 때까지 한 박자 기다린다.
  setTimeout(() => {
    if (!canvas.width || !canvas.height) return;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) opaque += 1;
    }
    const total = canvas.width * canvas.height;
    api.debugLog(`그려진 픽셀 ${opaque} / ${total} (${((opaque / total) * 100).toFixed(1)}%)`);
  }, 250);
}

/* ---------- 입력 ---------- */

/*
 * 좌클릭으로 클릭 반응을 재생한다.
 *
 * 창 옮기기는 JS가 아니라 CSS가 한다 — Electron은 `-webkit-app-region: drag`가 붙은
 * 영역을 타이틀 바처럼 다룬다(pet.css 참고). 그래서 여기서는 반응만 재생하면 된다.
 */
canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  hideMenu();
  overlay.player?.playClick();
});

/* 우클릭으로 메타 화면과 펫룸을 연다(META-001). 펫뿐 아니라 창 아무 곳에서나 받는다. */
stage.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  showMenuAt(event.clientX, event.clientY);
});

/**
 * 클릭한 자리에 메뉴를 띄운다.
 *
 * 기본은 커서 오른쪽 아래로 펼치고, 그쪽 공간이 부족하면 **커서를 기준으로 뒤집어**
 * 왼쪽 또는 위로 펼친다. 그래도 넘치면 창 안으로 밀어 넣는다.
 *
 * 뒤집기까지 하는 이유: 펫 창은 한 변이 152px뿐이고 `overflow: hidden`이라 클릭 좌표를
 * 그대로 쓰면 오른쪽·아래에서 메뉴가 잘린다. 잘린 메뉴는 안 보이는 정도가 아니라 아예
 * 누를 수 없다. 그렇다고 밀어 넣기만 하면 메뉴가 커서에서 멀리 떨어져 "클릭한 자리에
 * 떴다"는 느낌이 사라진다. 뒤집기가 커서와 메뉴 모서리를 붙여 준다.
 */
function showMenuAt(x, y) {
  menu.hidden = false;

  // 크기는 보이는 상태에서만 잴 수 있다.
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const margin = 2;

  // 1) 오른쪽 아래로 펼치되, 넘치면 커서 기준으로 뒤집는다.
  let left = x + width + margin > window.innerWidth ? x - width : x;
  let top = y + height + margin > window.innerHeight ? y - height : y;

  // 2) 뒤집어도 넘치면(창보다 메뉴가 클 때) 창 안으로 민다.
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  left = Math.min(Math.max(left, margin), maxLeft);
  top = Math.min(Math.max(top, margin), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

for (const button of menu.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'room') {
      api.openRoom();
    } else {
      api.openPanel(button.dataset.screen);
    }
    hideMenu();
  });
}

window.addEventListener('click', (event) => {
  if (!menu.contains(event.target)) hideMenu();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideMenu();
});
window.addEventListener('resize', resizeCanvas);

function hideMenu() {
  menu.hidden = true;
}

/* ---------- 말풍선 ---------- */

let bubbleTimer = null;
function say(message) {
  if (!message) return;
  bubble.textContent = message;
  bubble.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.hidden = true;
  }, 4200);
}

api.on('usage:aggregated', (payload) => say(payload?.bubble));

/**
 * 활성 펫이 바뀌면 **재시작 없이** 스프라이트를 갈아 끼운다.
 *
 * 이 창은 활성 펫을 스스로 정하지 않는다. 펫룸에서 바꾸든 어디서 바꾸든, 여기 도달하는
 * 경로는 이 push 하나뿐이다.
 */
api.on('room:activePetChanged', (view) => {
  if (!view) return;
  showPet(view).catch((error) => {
    stage.classList.add('sprite-missing');
    api.debugLog(`활성 펫 교체 실패 — ${error.message}`);
  });
});

/**
 * 우클릭 메뉴가 창 안에 들어오는지 모서리마다 확인한다.
 *
 * 클릭 좌표를 그대로 쓰면 오른쪽·아래를 눌렀을 때 잘리는데, 창이 투명이라 잘린 것을
 * 눈으로 알아채기 어렵다. 그래서 합성 이벤트로 각 지점을 눌러 보고 결과 좌표를 보고한다.
 */
function checkMenuPlacement() {
  const points = [
    ['왼쪽 위', 4, 4],
    ['가운데', Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2)],
    ['오른쪽 아래', window.innerWidth - 4, window.innerHeight - 4],
    ['오른쪽 위', window.innerWidth - 4, 4],
    ['왼쪽 아래', 4, window.innerHeight - 4],
  ];

  for (const [label, x, y] of points) {
    stage.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
    const box = menu.getBoundingClientRect();
    const fits =
      box.left >= 0 &&
      box.top >= 0 &&
      box.right <= window.innerWidth &&
      box.bottom <= window.innerHeight;
    api.debugLog(
      `메뉴 ${label} 클릭(${x},${y}) → ` +
        `(${Math.round(box.left)},${Math.round(box.top)}) ${Math.round(box.width)}×${Math.round(box.height)} ` +
        `창 ${window.innerWidth}×${window.innerHeight} ${fits ? '안에 들어옴' : '!!! 잘림'}`,
    );
  }
  hideMenu();
}

/* ---------- 시작 ---------- */

window.addEventListener('load', async () => {
  api.debugLog(
    `pet 준비 완료 — 본문 높이 ${Math.round(document.body.getBoundingClientRect().height)}px, ` +
      `노드 ${document.querySelectorAll('*').length}개`,
  );

  // 기본 상태에서 메뉴와 말풍선이 정말 숨겨졌는지 계산된 스타일로 확인한다.
  // `hidden` 속성은 작성자 `display` 규칙에 지므로 눈으로만 믿으면 안 된다.
  api.debugLog(
    `기본 상태 — 메뉴 display=${getComputedStyle(menu).display}, ` +
      `말풍선 display=${getComputedStyle(bubble).display}`,
  );

  if (await api.selftestEnabled()) checkMenuPlacement();

  // 그리기 루프는 한 번만 켠다. 활성 펫이 바뀌어도 루프는 그대로고 `overlay.player`만 갈린다.
  requestAnimationFrame(loop);

  try {
    await showPet(await api.overlayPet());
    reportDrawnPixels();
  } catch (error) {
    // 스프라이트를 못 읽어도 창은 살아 있어야 한다. 우클릭 메뉴는 계속 동작한다.
    stage.classList.add('sprite-missing');
    api.debugLog(`스프라이트 로딩 실패 — ${error.message}`);
  }
});
