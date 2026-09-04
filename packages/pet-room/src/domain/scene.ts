/**
 * 펫룸 장면 — 배경 선택, 배회 영역, 위치 갱신.
 *
 * 렌더러가 아니라 여기 있는 이유: 배회 규칙("영역 밖으로 나가지 않는다", "목표에 닿으면
 * 다시 고른다")은 창을 띄우지 않고 검증할 수 있어야 한다.
 */

/* ------------------------------------------------------------------ *
 * 배경 계약 (`assets/backgrounds/{디렉터리}/bg_00X.json`)
 * ------------------------------------------------------------------ */

export interface BackgroundLayer {
  name: string;
  file: string;
  z: number;
  /** 레이어를 다른 속도로 밀 때의 계수. **현재 에셋에서는 쓸 수 없다** — `WALK_AREA` 주석 참조. */
  parallax: number;
  opaque: boolean;
}

/** 한 레이어만 프레임으로 교체하는 애니메이션. 지금은 반딧불이다. */
export interface BackgroundAnimation {
  /** 교체 대상 레이어의 `name`. 나머지 레이어는 고정이다. */
  layer: string;
  fps: number;
  loop: boolean;
  /** 디렉터리 기준 상대 경로. 레이어 **전체**를 갈아 끼우는 풀 프레임이다. */
  frames: readonly string[];
}

export interface BackgroundMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  horizon: number;
  /** 지면이 시작되는 y. 펫의 발은 이 아래에 놓인다. */
  groundTop: number;
  petAnchor: { x: number; y: number; w: number; h: number };
  composite: string;
  layers: readonly BackgroundLayer[];
  animation?: BackgroundAnimation;
  /**
   * 배회 가능 영역. **현재 에셋에는 없는 필드다.**
   *
   * 계약에 이게 없어서 `walkAreaOf`가 PNG를 실측한 값으로 유도한다. 배경 쪽에서 이
   * 필드를 넣어 주면 유도를 건너뛰고 그대로 쓴다 — 그때 렌더러는 한 줄도 안 바뀐다.
   */
  walkArea?: WalkArea;
}

/* ------------------------------------------------------------------ *
 * 낮 / 밤
 * ------------------------------------------------------------------ */

export type BackgroundPhase = 'day' | 'night';

/** 낮이 시작되는 시(로컬). */
export const DAY_START_HOUR = 6;
/** 밤이 시작되는 시(로컬). */
export const NIGHT_START_HOUR = 18;

export interface BackgroundChoice {
  phase: BackgroundPhase;
  id: string;
  /** `assets/backgrounds/` 아래의 디렉터리명. */
  directory: string;
  /** 디렉터리 안의 런타임 메타 파일명. */
  metaFile: string;
}

const DAY: BackgroundChoice = {
  phase: 'day',
  id: 'bg_002',
  directory: 'bg_002_deep_forest',
  metaFile: 'bg_002.json',
};

const NIGHT: BackgroundChoice = {
  phase: 'night',
  id: 'bg_003',
  directory: 'bg_003_deep_forest_night',
  metaFile: 'bg_003.json',
};

/**
 * 로컬 시각이 낮인가 밤인가.
 *
 * 경계는 06:00과 18:00이다. 05:59는 밤, 06:00은 낮.
 */
export function phaseAt(at: Date): BackgroundPhase {
  const hour = at.getHours();
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'day' : 'night';
}

/** 지금 시각에 쓸 배경. */
export function backgroundAt(at: Date): BackgroundChoice {
  return phaseAt(at) === 'day' ? DAY : NIGHT;
}

/**
 * 배경 디렉터리 기준 상대 경로를 **에셋 루트 기준** 경로로 바꾼다.
 *
 * `petAssetPath` 와 같은 규약이다 — 에셋 루트가 어디인지는 UI 의 `assetUrl()` 이 안다.
 */
export function backgroundAssetPath(directory: string, file: string): string {
  return `backgrounds/${directory}/${file}`;
}

/** 레이어를 그릴 순서(z 오름차순)로 돌려준다. json의 배열 순서를 믿지 않는다. */
export function layersInDrawOrder(meta: BackgroundMeta): BackgroundLayer[] {
  return [...meta.layers].sort((a, b) => a.z - b.z);
}

/**
 * 반딧불이 프레임 번호.
 *
 * 스프라이트와 규칙이 같아서 같은 계산을 쓴다. `loop: false`인 배경이 생기면 마지막
 * 프레임에서 멈춘다.
 */
export function backgroundFrameIndexAt(animation: BackgroundAnimation, elapsedMs: number): number {
  const advanced = Math.floor(Math.max(0, elapsedMs) / (1000 / animation.fps));
  if (animation.loop) return advanced % animation.frames.length;
  return Math.min(advanced, animation.frames.length - 1);
}

/* ------------------------------------------------------------------ *
 * 배회 영역
 * ------------------------------------------------------------------ */

/** 배회 가능 영역. 좌표계는 **발 위치**(스프라이트 하단 중앙)다. */
export interface WalkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 배경 계약에 `walkArea`가 없어서 직접 재야 했던 값들.
 *
 * `near` 레이어는 지면과 **전경 나무 기둥**을 한 장에 담고 있다. 펫은 지면 위에 서야
 * 하므로 near보다 앞에 그릴 수밖에 없는데, 그러면 기둥보다도 앞이 되어 펫이 기둥을
 * 뚫고 나온다. 그래서 배회 범위를 기둥 밖으로 제한한다.
 *
 * 아래 두 폭은 bg_002/bg_003의 near PNG에서 실측한 값이다(두 배경이 동일).
 * **배경 json에 `walkArea`가 생기면 이 상수들은 전부 죽는다.**
 */
const TRUNK_WIDTH_LEFT = 60;
const TRUNK_WIDTH_RIGHT = 84;
/** 최대 프레임 폭 48px의 절반. EPIC stage3가 그 크기다. */
const PET_HALF_WIDTH = 24;
/** 기둥에 스치지 않을 만큼의 여유. */
const CLEARANCE = 12;
/** 지면 뒤쪽 여백. 발이 풀선에 정확히 걸치면 배경에 파묻혀 보인다. */
const GROUND_BACK_MARGIN = 10;
/** 지면 앞쪽 여백. 발이 화면 아래로 잘리지 않게 한다. */
const GROUND_FRONT_MARGIN = 12;

export class InvalidWalkAreaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalkAreaError';
  }
}

/**
 * 배경 메타에서 배회 영역을 얻는다.
 *
 * 메타가 `walkArea`를 주면 그대로 쓰고, 없으면 `groundTop`·`height`와 위 실측 상수로
 * 유도한다.
 */
export function walkAreaOf(meta: BackgroundMeta): WalkArea {
  if (meta.walkArea) return meta.walkArea;

  const x = TRUNK_WIDTH_LEFT + PET_HALF_WIDTH + CLEARANCE;
  const right = meta.width - TRUNK_WIDTH_RIGHT - PET_HALF_WIDTH - CLEARANCE;
  const y = meta.groundTop + GROUND_BACK_MARGIN;
  const bottom = meta.height - GROUND_FRONT_MARGIN;

  if (right <= x || bottom <= y) {
    throw new InvalidWalkAreaError(
      `배회 영역을 만들 수 없습니다: ${meta.id} (${meta.width}x${meta.height}, groundTop ${meta.groundTop})`,
    );
  }

  return { x, y, width: right - x, height: bottom - y };
}

export function clampToWalkArea(area: WalkArea, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width),
    y: Math.min(Math.max(y, area.y), area.y + area.height),
  };
}

export function randomPointIn(area: WalkArea, random: () => number): { x: number; y: number } {
  return {
    x: area.x + random() * area.width,
    y: area.y + random() * area.height,
  };
}

/* ------------------------------------------------------------------ *
 * 배회
 * ------------------------------------------------------------------ */

/** 초당 이동 픽셀. walk 애니메이션이 없으므로 걷는 것처럼 보이려면 느려야 한다. */
export const ROAM_SPEED_PX_PER_SEC = 16;
/** 목표에 닿았다고 보는 거리. */
const ARRIVAL_EPSILON = 1.5;
/** 목표 도달 후 쉬는 시간의 범위. 계속 움직이면 기계처럼 보인다. */
const REST_MIN_MS = 600;
const REST_MAX_MS = 2600;

/** 배회 중인 펫 한 마리의 위치. `x`/`y`는 **발** 좌표다. */
export interface RoamingPet {
  ownedPetId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** 남은 정지 시간(ms). 0보다 크면 멈춰 서 있다. */
  restMs: number;
}

/** 시작 위치. 목표를 자기 자리로 두어 첫 프레임부터 쉬는 상태로 시작한다. */
export function spawnRoamingPet(
  ownedPetId: string,
  area: WalkArea,
  random: () => number,
): RoamingPet {
  const at = randomPointIn(area, random);
  return {
    ownedPetId,
    x: at.x,
    y: at.y,
    targetX: at.x,
    targetY: at.y,
    restMs: random() * REST_MAX_MS,
  };
}

/**
 * 전 펫의 위치를 한 프레임분 진행시킨다.
 *
 * **제자리에서 고친다.** 매 프레임 배열과 객체를 새로 만들면 60fps에서 GC 압력이
 * 그대로 프레임 드랍이 된다. 이 함수의 호출자는 공유 rAF 루프 하나뿐이라 소유권이
 * 명확하다.
 *
 * 펫마다 rAF를 돌리면 서로 다른 `dt`를 보고 위치가 드리프트한다. 그래서 루프도 하나,
 * 이 함수도 한 번에 전부 갱신한다.
 */
export function stepRoaming(
  pets: RoamingPet[],
  area: WalkArea,
  dtSeconds: number,
  random: () => number,
): void {
  // 창이 백그라운드에 있다가 돌아오면 dt가 몇 초로 튄다. 그대로 쓰면 펫이 순간이동한다.
  const dt = Math.min(Math.max(dtSeconds, 0), 0.1);

  for (const pet of pets) {
    if (pet.restMs > 0) {
      pet.restMs -= dt * 1000;
      continue;
    }

    const dx = pet.targetX - pet.x;
    const dy = pet.targetY - pet.y;
    const distance = Math.hypot(dx, dy);

    if (distance < ARRIVAL_EPSILON) {
      const next = randomPointIn(area, random);
      pet.targetX = next.x;
      pet.targetY = next.y;
      pet.restMs = REST_MIN_MS + random() * (REST_MAX_MS - REST_MIN_MS);
      continue;
    }

    const step = Math.min(ROAM_SPEED_PX_PER_SEC * dt, distance);
    const moved = clampToWalkArea(
      area,
      pet.x + (dx / distance) * step,
      pet.y + (dy / distance) * step,
    );
    pet.x = moved.x;
    pet.y = moved.y;
  }
}

/**
 * 그릴 순서. 발이 아래에 있는(= `y`가 큰) 펫이 앞이다.
 *
 * 정렬을 안 하면 뒤에 선 펫이 앞에 선 펫을 덮어 깊이가 뒤집힌 것처럼 보인다.
 */
export function inDrawOrder(pets: readonly RoamingPet[]): RoamingPet[] {
  return [...pets].sort((a, b) => a.y - b.y);
}

/* ------------------------------------------------------------------ *
 * 클릭 판정
 * ------------------------------------------------------------------ */

/**
 * 스프라이트 확대 배율.
 *
 * 2를 고른 것은 취향이 아니다. 배경 계약의 `petAnchor.h`가 96이고 최대 프레임이
 * 48px(EPIC stage3)이라 96 = 48 × 2다. 배경이 기대하는 펫 크기와 정확히 맞는다.
 * 정수 배율만 허용된다(가이드 §7).
 */
export const PET_SCALE = 2;

/** 화면에 그려진 펫 하나가 차지하는 사각형. 클릭 판정에 쓴다. */
export interface PetDrawBox {
  ownedPetId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 발 좌표와 프레임 크기로 그릴 사각형을 만든다.
 *
 * 발이 하단 중앙이므로 좌상단은 거기서 폭의 절반만큼 왼쪽, 높이만큼 위다.
 */
export function drawBoxOf(
  pet: RoamingPet,
  frameWidth: number,
  frameHeight: number,
  scale = PET_SCALE,
): PetDrawBox {
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    ownedPetId: pet.ownedPetId,
    left: Math.round(pet.x - width / 2),
    top: Math.round(pet.y - height),
    width,
    height,
  };
}

/**
 * 클릭 지점에 있는 펫. 겹쳐 있으면 **앞에 그려진 쪽**이 이긴다.
 *
 * `boxes`는 `inDrawOrder`가 낸 순서(뒤 → 앞)로 들어온다고 본다. 그래서 뒤에서부터
 * 찾는다. 눈에 보이는 것을 눌렀는데 뒤에 숨은 펫이 선택되면 클릭이 고장 난 것처럼
 * 느껴진다.
 */
export function hitTest(boxes: readonly PetDrawBox[], x: number, y: number): string | undefined {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (!box) continue;
    if (x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height) {
      return box.ownedPetId;
    }
  }
  return undefined;
}
