// 스프라이트 재생기.
//
// 오버레이 창(펫 한 마리)과 펫룸 창(여러 마리)이 같은 구현을 쓴다. 예전에는 이 로직이
// `pet.js` 안에 모듈 수준 싱글턴으로 있어서 여러 마리를 그릴 수 없었고, 규칙에 테스트가
// 하나도 없었다.
//
// **규칙 자체는 여기 없다.** 프레임 번호 계산, 경로 조립, click/click2 선택은 전부
// `@pet/room`의 도메인 함수다(`node --test`로 검증된다). 이 파일은 그 결과를 캔버스에
// 옮기는 일만 한다.

import {
  frameIndexAt,
  isMotionFinished,
  petAssetPath,
  pickClickMotion,
  spriteMetaPath,
} from '../../../packages/pet-room/dist/index.js';

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  return response.json();
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${url} — 이미지를 읽지 못함`));
    image.src = url;
  });
}

/** 모션 하나의 시트와 메타. 프레임 크기는 **항상 이 메타에서** 온다. */
async function loadMotion(species, motion) {
  const png = petAssetPath(species.rarity, species.slug, species.petId, species.stage, motion);
  const [meta, image] = await Promise.all([fetchJson(spriteMetaPath(png)), loadImage(png)]);
  return { meta, image };
}

/**
 * 펫 한 마리의 재생 상태.
 *
 * idle은 필수, click/click2는 없으면 없는 대로 둔다 — 클릭 반응이 빠지는 것이 창이 아예
 * 안 뜨는 것보다 낫다.
 */
export class SpritePlayer {
  #motions;
  #current = 'idle';
  #startedAt = 0;

  constructor(motions) {
    this.#motions = motions;
    this.#startedAt = performance.now();
  }

  /** `{ rarity, slug, petId, stage }`로 한 마리를 적재한다. */
  static async load(species) {
    const motions = { idle: await loadMotion(species, 'idle') };
    for (const motion of ['click', 'click2']) {
      try {
        motions[motion] = await loadMotion(species, motion);
      } catch {
        // 클릭 반응이 없는 종이 있어도 idle은 돈다.
      }
    }
    return new SpritePlayer(motions);
  }

  get motionName() {
    return this.#current;
  }

  /** 지금 재생 중인 모션의 메타. 프레임 크기가 여기서 나온다. */
  get meta() {
    return (this.#motions[this.#current] ?? this.#motions.idle).meta;
  }

  play(motion) {
    if (!this.#motions[motion]) return;
    this.#current = motion;
    this.#startedAt = performance.now();
  }

  /**
   * 클릭 반응. 이미 반응 중이면 무시한다 — 연타로 첫 프레임만 반복되면 오히려 멈춰
   * 보인다.
   */
  playClick() {
    if (this.#current !== 'idle') return;
    this.play(pickClickMotion(Math.random()));
  }

  /**
   * 지금 그려야 할 프레임. 1회 재생이 끝났으면 여기서 idle로 되돌린다.
   *
   * 되돌리는 일을 그리기 직전에 하는 이유: 별도 타이머를 두면 타이머와 화면이 어긋나
   * 마지막 프레임이 한 박자 더 보이거나 건너뛴다.
   */
  frameAt(now) {
    let entry = this.#motions[this.#current] ?? this.#motions.idle;
    let elapsed = now - this.#startedAt;

    if (isMotionFinished(entry.meta, elapsed)) {
      this.play('idle');
      entry = this.#motions.idle;
      elapsed = 0;
    }

    const { meta, image } = entry;
    const index = frameIndexAt(meta, elapsed);
    return {
      image,
      meta,
      sx: index * meta.frameWidth,
      sy: 0,
      sw: meta.frameWidth,
      sh: meta.frameHeight,
    };
  }
}

/**
 * 한 프레임을 캔버스에 그린다.
 *
 * 보간을 끄고 정수 배율만 쓴다(에셋 가이드 §7). 캔버스 크기를 바꾸면 컨텍스트 설정이
 * 초기화되므로, 매번 다시 끈다.
 */
export function drawFrame(ctx, frame, left, top, scale) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    frame.image,
    frame.sx,
    frame.sy,
    frame.sw,
    frame.sh,
    left,
    top,
    frame.sw * scale,
    frame.sh * scale,
  );
}
