import { hamsterFoodPixels } from '../view/hamster-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';
import type { Point } from '../view/layout.ts';

export class HamsterFood {
  private readonly context: CanvasRenderingContext2D | null;
  constructor(canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d');
  }
  paint(
    pose: PetCombatPose,
    start: Point,
    target: Point,
    evolution: number,
    unit: number,
    width: number,
    height: number,
  ): void {
    const context = this.context;
    if (!context) return;
    if (context.canvas.width !== width || context.canvas.height !== height) {
      context.canvas.width = width;
      context.canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    const pixels = hamsterFoodPixels(pose, start, target, evolution, unit);
    context.canvas.hidden = pixels.length === 0;
    context.canvas.dataset['flight'] = String(pose.foodFlight);
    for (const pixel of pixels) {
      context.fillStyle = pixel.color;
      context.fillRect(pixel.x, pixel.y, pixel.width, pixel.height);
    }
  }
}
