import { bottomPaddingRatio } from '../view/sprite-grounding.ts';

function loadBottomPadding(asset: string): Promise<number> {
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
        resolve(bottomPaddingRatio(context.getImageData(0, 0, canvas.width, canvas.height)));
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
  private readonly loadPadding: (asset: string) => Promise<number>;
  private readonly cache = new Map<string, Promise<number>>();
  private source: string | null = null;
  private frameSize = 0;
  private padding = 0;

  constructor(
    applyOffset: (offset: number) => void,
    loadPadding: (asset: string) => Promise<number> = loadBottomPadding,
  ) {
    this.applyOffset = applyOffset;
    this.loadPadding = loadPadding;
  }

  resize(frameSize: number): void {
    this.frameSize = frameSize;
    this.apply();
  }

  setSource(asset: string | null): void {
    if (asset === this.source) return;
    this.source = asset;
    this.padding = 0;
    this.apply();
    if (!asset) return;

    let pending = this.cache.get(asset);
    if (!pending) {
      // A failed asset stays neutral instead of retrying on every battle-state poll.
      pending = this.loadPadding(asset).catch(() => 0);
      this.cache.set(asset, pending);
    }
    void pending.then((padding) => {
      if (this.source !== asset) return;
      this.padding = padding;
      this.apply();
    });
  }

  private apply(): void {
    this.applyOffset(Math.round(this.padding * this.frameSize));
  }
}
