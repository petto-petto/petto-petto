import {
  squirrelCasterFrame,
  squirrelFrameSize,
  squirrelShadowFrame,
} from '../view/squirrel-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';

/** The native face remains in place; cached wider tail poses also supply non-interactive shadow clones. */
export class SquirrelSprite {
  private readonly context: CanvasRenderingContext2D | null;
  private source = '';
  private evolution = -1;
  private frames: ImageData[] = [];
  private shadows: ImageData[] = [];
  private painted = -1;
  private ghost: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d', { willReadFrequently: true });
    this.ghost = canvas.ownerDocument.createElement('canvas');
  }
  ghostFor(source: string): HTMLCanvasElement | null {
    return this.source === source ? this.ghost : null;
  }
  paint(image: HTMLImageElement, pose: PetCombatPose, evolution: number): boolean {
    const context = this.context,
      spell = pose.squirrel,
      size = squirrelFrameSize(evolution),
      width = size * 1.5;
    if (!context || pose.id !== 'squirrel' || !spell?.enabled || pose.phase === 'IDLE')
      return false;
    if (
      !image.complete ||
      image.currentSrc !== image.src ||
      image.naturalHeight !== size ||
      !Number.isInteger(image.naturalWidth / size)
    )
      return false;
    if (this.source !== image.currentSrc || this.evolution !== evolution) {
      try {
        context.canvas.width = context.canvas.height = size;
        context.drawImage(image, 0, 0, size, size, 0, 0, size, size);
        const base = context.getImageData(0, 0, size, size).data;
        if (!base.some((v, i) => i % 4 === 3 && v > 0)) return false;
        this.frames = Array.from({ length: 6 }, (_, i) => {
          const frame = context.createImageData(width, size);
          frame.data.set(squirrelCasterFrame(base, evolution, i / 5));
          return frame;
        });
        this.shadows = this.frames.map((frame) => {
          const shadow = context.createImageData(width, size);
          shadow.data.set(squirrelShadowFrame(frame.data));
          return shadow;
        });
        context.canvas.width = width;
        context.canvas.height = size;
        this.ghost.width = width;
        this.ghost.height = size;
        this.source = image.currentSrc;
        this.evolution = evolution;
        this.painted = -1;
        context.canvas.dataset['frameSize'] = String(size);
        context.canvas.dataset['source'] = this.source;
      } catch {
        return false;
      }
    }
    const step = Math.round(spell.tailSweep * 5),
      frame = this.frames[step],
      shadow = this.shadows[step];
    if (!frame || !shadow) return false;
    if (this.painted !== step) {
      context.putImageData(frame, 0, 0);
      this.ghost.getContext('2d')?.putImageData(shadow, 0, 0);
      this.painted = step;
      context.canvas.dataset['tailSweep'] = String(step / 5);
    }
    return true;
  }
}
