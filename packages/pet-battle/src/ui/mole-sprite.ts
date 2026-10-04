import { moleSlapFrame, type PetCombatPose } from '../view/pet-combat-animations.ts';

/** Reuses the already-decoded visible image, so a late fetch cannot draw another pet's arm. */
export class MoleSprite {
  private readonly context: CanvasRenderingContext2D | null;
  private source = '';
  private pixels: Uint8ClampedArray | undefined;
  private painted = '';

  constructor(privateCanvas: HTMLCanvasElement) {
    this.context = privateCanvas.getContext('2d', { willReadFrequently: true });
  }

  paint(image: HTMLImageElement, pose: PetCombatPose, evolution: number): boolean {
    const context = this.context;
    if (!context || pose.id !== 'mole' || pose.hand !== 'LEFT') return false;
    if (!image.complete || image.naturalHeight !== 32 || image.currentSrc !== image.src)
      return false;
    if (this.source !== image.currentSrc) {
      this.source = image.currentSrc;
      this.pixels = undefined;
      this.painted = '';
      try {
        context.clearRect(0, 0, 48, 32);
        context.drawImage(image, 0, 0, 32, 32, 0, 0, 32, 32);
        this.pixels = context.getImageData(0, 0, 32, 32).data;
      } catch {
        // A missing/tainted source keeps the complete native sprite, never a detached hand.
        return false;
      }
    }
    if (!this.pixels) return false;
    // Four planted pixel poses; skip identical frames rather than rasterizing at every rAF.
    const swing = Math.round(pose.handSwing * 4) / 4;
    const key = `${evolution}:${swing}`;
    if (this.painted !== key) {
      const frame = context.createImageData(48, 32);
      frame.data.set(moleSlapFrame(this.pixels, evolution, swing));
      context.putImageData(frame, 0, 0);
      context.canvas.dataset['source'] = this.source;
      context.canvas.dataset['evolution'] = String(evolution);
      this.painted = key;
    }
    return true;
  }
}
