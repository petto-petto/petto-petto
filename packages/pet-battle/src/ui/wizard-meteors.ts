import { wizardSpellPixels, type WizardLayout, type SpellPixel } from '../view/wizard-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';

/** One scene owner clears both weather planes on STOP, hiding, selection changes and reduced motion. */
export class WizardMeteors {
  private readonly sky: CanvasRenderingContext2D | null;
  private readonly storm: CanvasRenderingContext2D | null;
  constructor(sky: HTMLCanvasElement, storm: HTMLCanvasElement) {
    this.sky = sky.getContext('2d');
    this.storm = storm.getContext('2d');
  }
  paint(pose: PetCombatPose, evolution: number, layout: WizardLayout, opacity: number): void {
    if (!this.sky || !this.storm) return;
    if (!pose.wizard?.enabled && this.sky.canvas.hidden && this.storm.canvas.hidden) return;
    const field = wizardSpellPixels(pose, evolution, layout);
    const render = (context: CanvasRenderingContext2D, pixels: SpellPixel[], dim: number) => {
      const canvas = context.canvas;
      if (canvas.width !== layout.width || canvas.height !== layout.height) {
        canvas.width = layout.width;
        canvas.height = layout.height;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      canvas.hidden = pixels.length === 0 && dim === 0;
      canvas.style.opacity = String(opacity * (pose.wizard?.intensity ?? 0));
      if (dim > 0) {
        context.fillStyle = `rgba(25,12,52,${dim})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      for (const pixel of pixels) {
        context.fillStyle = pixel.color;
        context.fillRect(pixel.x, pixel.y, pixel.width, pixel.height);
      }
    };
    render(this.sky, field.back, field.dim);
    render(this.storm, field.front, 0);
    this.storm.canvas.dataset['meteorCount'] = String(field.meteorCount);
    this.storm.canvas.dataset['spellMs'] = String(pose.wizard?.elapsedMs ?? 0);
  }
}
