// 펫 창.
//
// 스프라이트 로딩·재생은 팀원이 만든 에셋 가이드(`pets/README.md`)를 그대로 따른다.
// 특히 다음 네 가지는 가이드가 실패 원인 1~4순위로 꼽은 것들이라 코드에 못박아 둔다.
//
//   - 프레임 크기와 개수는 **옆 JSON에서 읽는다**. 32로 하드코딩하지 않는다
//     (EPIC stage 3만 48px이라 그 종만 잘린다).
//   - 프레임 i의 소스 사각형은 `(i × frameWidth, 0, frameWidth, frameHeight)`.
//   - 확대는 정수 배율 nearest-neighbor만. 보간을 끈다.
//   - `click`과 `click2`를 랜덤으로 번갈아 재생한다.
//
// 어떤 펫을 그릴지는 `collection` 도메인이 정한다. meta는 파일 경로를 모른다.

// preload가 노출한 API. 렌더러는 Node에도 임의 IPC 채널에도 닿지 못한다.
const api = window.petApi;

const stage = document.getElementById('stage');
const canvas = document.getElementById('sprite');
const menu = document.getElementById('menu');
const bubble = document.getElementById('bubble');
const ctx = canvas.getContext('2d');

/* ---------- 경로 조립 (에셋 가이드 §1·§6) ---------- */

/** 레벨 → 진화 단계. 가이드 §3. */
function stageOfLevel(level) {
  if (level < 10) return 1;
  if (level < 20) return 2;
  return 3;
}

function motionPath(pet, motion) {
  const { grade, slug, petId, stageNumber } = pet;
  return `assets/pets/${grade}/${slug}/stage${stageNumber}/pet_${petId}_s${stageNumber}_${motion}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  return response.json();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${url} — 이미지를 읽지 못함`));
    image.src = url;
  });
}

/* ---------- 재생 상태 ---------- */

const player = {
  pet: null,
  /** motion 이름 → { meta, image } */
  motions: {},
  current: 'idle',
  startedAt: 0,
  scale: 1,
};

/** 프레임 인덱스. 루프면 순환하고, 1회 재생이면 마지막에서 멈춘다(가이드 §5). */
function frameIndex(meta, elapsedMs) {
  const advanced = Math.floor(elapsedMs / (1000 / meta.fps));
  return meta.loop ? advanced % meta.frameCount : Math.min(advanced, meta.frameCount - 1);
}

/** 창 크기에 맞는 **정수** 배율. 비정수 배율은 픽셀을 뭉갠다(가이드 §7). */
function fitScale(meta) {
  const available = Math.min(window.innerWidth, window.innerHeight) - 8;
  return Math.max(1, Math.floor(available / meta.frameWidth));
}

function resizeCanvas() {
  const idle = player.motions.idle;
  if (!idle) return;
  player.scale = fitScale(idle.meta);
  canvas.width = idle.meta.frameWidth * player.scale;
  canvas.height = idle.meta.frameHeight * player.scale;
  // 캔버스 크기를 바꾸면 컨텍스트 설정이 초기화되므로 다시 끈다.
  ctx.imageSmoothingEnabled = false;
}

function draw(now) {
  const motion = player.motions[player.current] ?? player.motions.idle;
  if (!motion) return;

  const { meta, image } = motion;
  const elapsed = now - player.startedAt;
  const index = frameIndex(meta, elapsed);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    index * meta.frameWidth,
    0,
    meta.frameWidth,
    meta.frameHeight,
    0,
    0,
    meta.frameWidth * player.scale,
    meta.frameHeight * player.scale,
  );

  // 1회 재생이 끝나면 idle로 돌아간다(가이드 §8).
  if (!meta.loop && elapsed >= (meta.frameCount / meta.fps) * 1000) {
    play('idle');
  }
}

function loop(now) {
  draw(now);
  requestAnimationFrame(loop);
}

function play(motion) {
  if (!player.motions[motion]) return;
  player.current = motion;
  player.startedAt = performance.now();
}

/** 클릭 반응. 두 종을 랜덤으로 번갈아야 반복 클릭이 죽어 보이지 않는다(가이드 §8). */
function playClick() {
  const choices = ['click', 'click2'].filter((name) => player.motions[name]);
  if (!choices.length) return;
  play(choices[Math.floor(Math.random() * choices.length)]);
}

/* ---------- 적재 ---------- */

async function loadOverlayPet() {
  const summary = await api.overlayPet();

  // 등급 폴더는 소문자, `pet.json`의 `grade`는 대문자다(가이드 §1).
  const grade = String(summary.rarity).toLowerCase();
  const slug = summary.sprite;
  const stageNumber = stageOfLevel(summary.level);

  // 파일명에 필요한 `petId`는 슬러그만으로 알 수 없다. 종 메타에서 읽는다(가이드 §6).
  const species = await fetchJson(`assets/pets/${grade}/${slug}/pet.json`);

  player.pet = { grade, slug, petId: species.petId, stageNumber, species };

  // idle은 필수, 클릭 반응은 없으면 없는 대로 둔다.
  player.motions.idle = await loadMotion('idle');
  for (const motion of ['click', 'click2']) {
    try {
      player.motions[motion] = await loadMotion(motion);
    } catch (error) {
      api.debugLog(`${motion} 생략 — ${error.message}`);
    }
  }

  resizeCanvas();
  play('idle');
  requestAnimationFrame(loop);

  reportDrawnPixels();

  const idle = player.motions.idle.meta;
  api.debugLog(
    `${species.name}(${species.grade}) Lv.${summary.level} → stage${stageNumber} · ` +
      `프레임 ${idle.frameWidth}×${idle.frameHeight} ${idle.frameCount}장 @${idle.fps}fps · ` +
      `배율 ${player.scale}x → ${canvas.width}px · ` +
      `모션 ${Object.keys(player.motions).join('/')}`,
  );
}

/**
 * 캔버스에 실제로 칠해진 픽셀이 있는지 확인하고, 요청이 있으면 그 화면을 PNG로 남긴다.
 *
 * 스프라이트 파일을 읽는 데 성공했다는 것과 화면에 그려졌다는 것은 다른 얘기다.
 * 배율 계산이나 소스 사각형이 틀리면 파일은 멀쩡한데 캔버스가 비어 있을 수 있다.
 */
function reportDrawnPixels() {
  // 첫 프레임이 그려질 때까지 한 박자 기다린다.
  setTimeout(() => {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) opaque += 1;
    }
    const total = canvas.width * canvas.height;
    api.debugLog(`그려진 픽셀 ${opaque} / ${total} (${((opaque / total) * 100).toFixed(1)}%)`);
  }, 250);
}

async function loadMotion(motion) {
  const base = motionPath(player.pet, motion);
  const meta = await fetchJson(`${base}.json`);
  const image = await loadImage(`${base}.png`);
  return { meta, image };
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
  playClick();
});

/* 우클릭으로 세 메타 화면을 연다(META-001). 펫뿐 아니라 창 아무 곳에서나 받는다. */
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
    api.openPanel(button.dataset.screen);
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

  try {
    await loadOverlayPet();
  } catch (error) {
    // 스프라이트를 못 읽어도 창은 살아 있어야 한다. 우클릭 메뉴는 계속 동작한다.
    stage.classList.add('sprite-missing');
    api.debugLog(`스프라이트 로딩 실패 — ${error.message}`);
  }
});
