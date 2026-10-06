import { zebraHoofFrame, type PetCombatPose } from '../view/pet-combat-animations.ts';

/** Three cached native leg poses; the original torso never changes. */
export class ZebraSprite {
  private readonly context: CanvasRenderingContext2D | null;
  private source = '';
  private evolution = -1;
  private frames: ImageData[] = [];
  private painted = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d', { willReadFrequently: true });
  }

  paint(image: HTMLImageElement, pose: PetCombatPose, evolution: number): boolean {
    const context = this.context;
    if (!context || pose.id !== 'zebra' || pose.phase === 'IDLE') return false;
    if (!image.complete || image.naturalHeight !== 32 || image.currentSrc !== image.src)
      return false;
    const frameCount = image.naturalWidth / image.naturalHeight;
    if (!Number.isInteger(frameCount)) return false;
    // The stock strip jitters the torso between frames. Hold its first frame so
    // the only moving pixels are the composited hoof.
    const frameIndex = 0;
    const lift = Math.round(Math.max(0, Math.min(1, pose.hoofLift)) * 2);
    if (this.source !== image.currentSrc || this.evolution !== evolution) {
      try {
        context.clearRect(0, 0, 32, 32);
        context.drawImage(image, frameIndex * 32, 0, 32, 32, 0, 0, 32, 32);
        const source = context.getImageData(0, 0, 32, 32).data;
        let visiblePixels = 0;
        for (let alpha = 3; alpha < source.length; alpha += 4)
          if (source[alpha] !== 0) visiblePixels++;
        if (visiblePixels === 0) return false;
        this.frames = [0, 0.5, 1].map((amount) => {
          const frame = context.createImageData(32, 32);
          frame.data.set(zebraHoofFrame(source, evolution, amount));
          return frame;
        });
        this.source = image.currentSrc;
        this.evolution = evolution;
        this.painted = -1;
        context.canvas.dataset['source'] = image.currentSrc;
        context.canvas.dataset['evolution'] = String(evolution);
        context.canvas.dataset['frameIndex'] = String(frameIndex);
      } catch {
        // A missing/tainted source keeps the complete original sprite visible.
        return false;
      }
    }
    const frame = this.frames[lift];
    if (!frame) return false;
    if (this.painted !== lift) {
      context.putImageData(frame, 0, 0);
      context.canvas.dataset['hoofLift'] = String(lift / 2);
      this.painted = lift;
    }
    return true;
  }
}
