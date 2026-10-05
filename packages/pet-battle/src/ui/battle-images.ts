/** Same URLs must not restart image update work on every 80ms state poll. */
export function setImageSource(image: { src: string; decoding: string }, asset: string): void {
  if (image.src === asset) return;
  image.decoding = 'async';
  image.src = asset;
}

async function decodeImage(asset: string): Promise<HTMLImageElement> {
  const image = new Image();
  setImageSource(image, asset);
  await image.decode();
  return image;
}

/** Warm only encountered attack sheets; never change the visible image after async work. */
export class BattleImages {
  private readonly load: (asset: string) => Promise<unknown>;
  private readonly prepared = new Map<string, Promise<unknown>>();

  constructor(load: (asset: string) => Promise<unknown> = decodeImage) {
    this.load = load;
  }

  preload(asset: string | null): Promise<unknown> {
    if (!asset) return Promise.resolve();
    let pending = this.prepared.get(asset);
    if (!pending) {
      // Retain the decoded image, not just its URL. Missing assets cannot block controls.
      pending = this.load(asset).catch(() => undefined);
      this.prepared.set(asset, pending);
    }
    return pending;
  }
}
