import { measurePetSprite, type SpriteMetrics } from '../view/sprite-grounding.ts';

function loadSpriteMetrics(asset: string): Promise<SpriteMetrics> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to measure pet sprite');
        context.drawImage(image, 0, 0);
        resolve(measurePetSprite(context.getImageData(0, 0, canvas.width, canvas.height)));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('Unable to load pet sprite'));
    image.src = asset;
  });
}

/** Keep one idle-foot anchor across attack frames, polling, pet switches and resizes. */
export class PetGrounding {
  private readonly applyOffset: (offset: number) => void;
  private readonly loadMetrics: (asset: string) => Promise<SpriteMetrics>;
  private readonly cache = new Map<string, Promise<SpriteMetrics>>();
  private source: string | null = null;
  private frameSize = 0;
  private padding = 0;
  private front = 1;

  constructor(
    applyOffset: (offset: number) => void,
    loadMetrics: (asset: string) => Promise<SpriteMetrics> = loadSpriteMetrics,
  ) {
    this.applyOffset = applyOffset;
    this.loadMetrics = loadMetrics;
  }

  get frontRatio(): number {
    return this.front;
  }

  resize(frameSize: number): void {
    this.frameSize = frameSize;
    this.apply();
  }

  setSource(asset: string | null): void {
    if (asset === this.source) return;
    this.source = asset;
    this.padding = 0;
    this.front = 1;
    this.apply();
    if (!asset) return;

    let pending = this.cache.get(asset);
    if (!pending) {
      // A failed asset stays neutral instead of retrying on every battle-state poll.
      pending = this.loadMetrics(asset).catch(() => ({ bottomPaddingRatio: 0, frontRatio: 1 }));
      this.cache.set(asset, pending);
    }
    void pending.then((metrics) => {
      if (this.source !== asset) return;
      this.padding = metrics.bottomPaddingRatio;
      this.front = metrics.frontRatio;
      this.apply();
    });
  }

  private apply(): void {
    this.applyOffset(Math.round(this.padding * this.frameSize));
  }
}
