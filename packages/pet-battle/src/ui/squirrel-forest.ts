import {
  squirrelForestPixels,
  type SquirrelLayout,
  type ForestPixel,
} from '../view/squirrel-combat.ts';
import type { PetCombatPose } from '../view/pet-combat-animations.ts';

export class SquirrelForest {
  private readonly grove: CanvasRenderingContext2D | null;
  private readonly storm: CanvasRenderingContext2D | null;
  constructor(grove: HTMLCanvasElement, storm: HTMLCanvasElement) {
    this.grove = grove.getContext('2d');
    this.storm = storm.getContext('2d');
  }
  paint(
    pose: PetCombatPose,
    evolution: number,
    layout: SquirrelLayout,
    opacity: number,
    ghost: HTMLCanvasElement | null,
  ): void {
    if (!this.grove || !this.storm) return;
    if (!pose.squirrel?.enabled && this.grove.canvas.hidden && this.storm.canvas.hidden) return;
    const field = squirrelForestPixels(pose, evolution, layout);
    const render = (context: CanvasRenderingContext2D, pixels: ForestPixel[], dim: number) => {
      const canvas = context.canvas;
      if (canvas.width !== layout.width || canvas.height !== layout.height) {
        canvas.width = layout.width;
        canvas.height = layout.height;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      canvas.hidden = pixels.length === 0 && dim === 0;
      canvas.style.opacity = String(opacity * (pose.squirrel?.intensity ?? 0));
      if (dim > 0) {
        context.fillStyle = `rgba(4,28,22,${dim})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Adjacent stamps share an opaque color. Fill them in one path, preserving
      // layer order while avoiding thousands of draw calls for the forest trunks.
      let color: string | undefined;
      for (const p of pixels) {
        if (p.color !== color) {
          if (color !== undefined) context.fill();
          context.beginPath();
          context.fillStyle = p.color;
          color = p.color;
        }
        context.rect(p.x, p.y, p.width, p.height);
      }
      if (color !== undefined) context.fill();
    };
    render(this.grove, field.back, field.dim);
    render(this.storm, field.front, 0);
    if (ghost && !this.storm.canvas.hidden)
      for (const clone of field.clones) {
        this.storm.globalAlpha = clone.alpha;
        this.storm.drawImage(
          ghost,
          clone.x,
          clone.y,
          ghost.width * clone.scale,
          ghost.height * clone.scale,
        );
      }
    this.storm.globalAlpha = 1;
    this.storm.canvas.dataset['cloneCount'] = String(ghost ? field.clones.length : 0);
    this.storm.canvas.dataset['bladeCount'] = String(field.bladeCount);
    this.storm.canvas.dataset['spellMs'] = String(pose.squirrel?.elapsedMs ?? 0);
  }
}
