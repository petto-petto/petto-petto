import { hamsterCheekFrame } from '../view/hamster-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';

/** Cache the native puff/mouth combinations; torso and feet never follow a second sprite clock. */
export class HamsterSprite {
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
    if (!context || pose.id !== 'hamster' || pose.phase === 'IDLE') return false;
    if (
      !image.complete ||
      image.naturalHeight !== 32 ||
      image.currentSrc !== image.src ||
      !Number.isInteger(image.naturalWidth / 32)
    )
      return false;
    const puff = Math.round(Math.max(0, Math.min(1, pose.cheekPuff)) * 2);
    const key = puff * 2 + Number(pose.mouthOpen);
    if (this.source !== image.currentSrc || this.evolution !== evolution) {
      try {
        context.clearRect(0, 0, 32, 32);
        context.drawImage(image, 0, 0, 32, 32, 0, 0, 32, 32);
        const source = context.getImageData(0, 0, 32, 32).data;
        if (!source.some((value, index) => index % 4 === 3 && value > 0)) return false;
        this.frames = Array.from({ length: 6 }, (_, index) => {
          const frame = context.createImageData(32, 32);
          frame.data.set(
            hamsterCheekFrame(source, evolution, Math.floor(index / 2) / 2, index % 2 === 1),
          );
          return frame;
        });
        this.source = image.currentSrc;
        this.evolution = evolution;
        this.painted = -1;
        context.canvas.dataset['source'] = image.currentSrc;
      } catch {
        return false;
      }
    }
    const frame = this.frames[key];
    if (!frame) return false;
    if (this.painted !== key) {
      context.putImageData(frame, 0, 0);
      context.canvas.dataset['cheekPuff'] = String(puff / 2);
      context.canvas.dataset['mouthOpen'] = String(pose.mouthOpen);
      this.painted = key;
    }
    return true;
  }
}
