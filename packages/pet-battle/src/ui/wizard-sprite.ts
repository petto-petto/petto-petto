import { wizardCasterFrame, wizardFrameSize } from '../view/wizard-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';

/** Cached cast poses preserve the shared art and never crop the 48px evolution to 32px. */
export class WizardSprite {
  private readonly context: CanvasRenderingContext2D | null;
  private source = '';
  private evolution = -1;
  private frames: ImageData[] = [];
  private painted = -1;
  constructor(canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d', { willReadFrequently: true });
  }
  paint(image: HTMLImageElement, pose: PetCombatPose, evolution: number): boolean {
    const context = this.context,
      spell = pose.wizard,
      size = wizardFrameSize(evolution);
    if (!context || pose.id !== 'wizard' || !spell?.enabled || pose.phase === 'IDLE') return false;
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
        const pixels = context.getImageData(0, 0, size, size).data;
        if (!pixels.some((v, i) => i % 4 === 3 && v > 0)) return false;
        this.frames = Array.from({ length: 5 }, (_, i) => {
          const frame = context.createImageData(size, size);
          frame.data.set(wizardCasterFrame(pixels, evolution, i / 4));
          return frame;
        });
        this.source = image.currentSrc;
        this.evolution = evolution;
        this.painted = -1;
        context.canvas.dataset['source'] = image.currentSrc;
        context.canvas.dataset['frameSize'] = String(size);
      } catch {
        return false;
      }
    }
    const step = Math.round((evolution === 2 ? spell.legSpread : spell.staffRaise) * 4);
    const frame = this.frames[step];
    if (!frame) return false;
    if (this.painted !== step) {
      context.putImageData(frame, 0, 0);
      this.painted = step;
      context.canvas.dataset['castProgress'] = String(step / 4);
    }
    return true;
  }
}
