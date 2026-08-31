import type { BattleCommand, BattleGateway, BattleState } from '../contracts.ts';
import { deriveBattleScene } from '../view/scene.ts';
import { DemoBattleGateway } from './demo-gateway.ts';

declare global {
  interface Window {
    petBattle?: BattleGateway;
  }
}

type ButtonAction =
  | 'START'
  | 'STOP'
  | 'ATTACK'
  | 'GROWTH'
  | 'ASSET_V1'
  | 'ASSET_V2'
  | 'ATTACK_EFFECT'
  | 'HIT'
  | 'DEFEAT'
  | 'SPAWN'
  | 'RESET'
  | 'SIZE'
  | 'COLOR'
  | 'HP'
  | 'REDUCED_MOTION';

const root = required<HTMLElement>('#battle-overlay');
const pet = required<HTMLElement>('#pet');
const petSheet = required<HTMLImageElement>('#pet-sheet');
const enemy = required<HTMLElement>('#enemy');
const enemyImage = required<HTMLImageElement>('#enemy-image');
const background = required<HTMLImageElement>('#battle-background');
const hpBar = required<HTMLElement>('.enemy-hp');
const hpFill = required<HTMLElement>('#enemy-hp-fill');
const hpLabel = required<HTMLElement>('#enemy-hp-label');
const stageLabel = required<HTMLElement>('#stage-label');
const toast = required<HTMLElement>('#battle-toast');
const petMenu = required<HTMLElement>('#pet-menu');
const enemyMenu = required<HTMLElement>('#enemy-menu');
const opacity = required<HTMLInputElement>('#display-opacity');

const gateway: BattleGateway = window.petBattle ?? new DemoBattleGateway();
let state: BattleState | undefined;
let busy = false;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`battle UI element missing: ${selector}`);
  return element;
}

function assetUrl(path: string): string {
  return new URL(`../${path}`, document.baseURI).href;
}

function nowMs(): number {
  return Math.round(performance.now());
}

async function execute(command: BattleCommand, message?: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const result = await gateway.execute(command);
    state = result.state;
    render(state);
    if (message) showToast(message);
  } catch (error) {
    showToast(`연결 오류 · ${String(error)}`, true);
  } finally {
    busy = false;
  }
}

function render(next: BattleState): void {
  const scene = deriveBattleScene(next);
  background.src = assetUrl(scene.backgroundAsset);
  petSheet.src = assetUrl(scene.petAsset);
  enemyImage.src = assetUrl(scene.enemyAsset);
  enemy.style.setProperty('--enemy-height', `${scene.enemyHeight}px`);
  background.style.opacity = String(scene.displayOpacity);
  enemy.style.opacity = scene.enemyVisible ? String(scene.displayOpacity) : '0';
  hpBar.style.opacity = String(scene.displayOpacity);
  hpFill.style.width = `${(scene.enemyHpRatio * 100).toFixed(1)}%`;
  hpLabel.textContent = `${Math.round(scene.enemyHpRatio * 100)}%`;
  stageLabel.textContent = `STAGE ${next.activePet?.stage ?? '—'}`;
  opacity.value = String(Math.round(scene.displayOpacity * 100));
  root.dataset['beat'] = next.motion?.beat ?? 'IDLE';
  root.dataset['enemyPhase'] = next.preview.enemyPhase;
  root.dataset['petAction'] = next.preview.petAction ?? 'IDLE';
  root.dataset['effectRarity'] =
    next.preview.attackEffectRarity ?? next.activePet?.rarity ?? 'COMMON';
  root.classList.toggle('reduced-motion', next.preview.reducedMotion);
  root.style.setProperty('--slash-count', String(scene.attackEffect.slashCount));
  root.style.setProperty('--particle-count', String(scene.attackEffect.particleCount));
  petMenu.hidden = next.preview.menu !== 'PET';
  enemyMenu.hidden = next.preview.menu !== 'ENEMY';
  updateMotion(next);
  updateSprite(next);
  updateControlLabels(next);
}

function updateMotion(next: BattleState): void {
  const motion = next.motion;
  if (!motion) {
    pet.style.removeProperty('transform');
    enemy.style.removeProperty('transform');
    return;
  }
  pet.style.transform = `translate(${motion.petOffset.x}px, ${motion.petOffset.y}px) scale(${motion.petScale.x}, ${motion.petScale.y})`;
  enemy.style.transform = `translate(${motion.enemyOffset.x}px, ${motion.enemyOffset.y}px) scale(${motion.enemyScale.x}, ${motion.enemyScale.y})`;
  root.style.setProperty('--slash-opacity', String(motion.slashOpacity));
  root.style.setProperty('--impact-opacity', String(motion.impactFlashOpacity));
  root.style.setProperty('--speed-opacity', String(motion.speedLineOpacity));
}

function updateSprite(next: BattleState): void {
  const attacking = next.preview.petAction === 'ATTACK';
  const frameCount = next.preview.assetVersion === 'V2' ? (attacking ? 6 : 4) : 1;
  petSheet.style.setProperty('--frame-count', String(frameCount));
  petSheet.style.setProperty('--sheet-shift', `${-(frameCount - 1) * 112}px`);
  petSheet.style.setProperty('--sheet-duration', attacking ? '545ms' : '667ms');
  petSheet.classList.toggle('animated-sheet', frameCount > 1);
}

function updateControlLabels(next: BattleState): void {
  const color = next.preview.enemyColor ?? '색상';
  const size = next.preview.enemySize ?? '크기';
  const effect = next.preview.attackEffectRarity ?? '효과';
  const hp = next.preview.enemyHpRatio;
  labelFor('COLOR', colorLabel(color));
  labelFor('SIZE', sizeLabel(size));
  labelFor('ATTACK_EFFECT', effect === '효과' ? effect : (effect[0] ?? effect));
  labelFor('HP', hp === null ? 'HP' : `${Math.round(hp * 100)}`);
  labelFor('START', next.activePet?.battleMode === 'FIGHTING' ? 'ON' : 'START');
  labelFor('STOP', next.activePet?.battleMode === 'PAUSED' ? 'OFF' : 'STOP');
}

function labelFor(action: ButtonAction, label: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (button) button.textContent = label;
}

function colorLabel(color: string): string {
  return (
    {
      RED: '빨',
      ORANGE: '주',
      YELLOW: '노',
      GREEN: '초',
      BLUE: '파',
      PURPLE: '보',
      RAINBOW: '무',
    }[color] ?? color
  );
}

function sizeLabel(size: string): string {
  return { SMALL: '소', MEDIUM: '중', LARGE: '대' }[size] ?? size;
}

function showToast(message: string, error = false): void {
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 1_200);
}

function commandFor(action: ButtonAction): { command: BattleCommand; message: string } {
  switch (action) {
    case 'START':
      return { command: { type: 'SET_BATTLE_RUNNING', running: true }, message: '자동 전투 시작' };
    case 'STOP':
      return { command: { type: 'SET_BATTLE_RUNNING', running: false }, message: '일시 정지' };
    case 'ATTACK':
      return {
        command: { type: 'PREVIEW_PET', action: 'ATTACK', nowMs: nowMs() },
        message: '공격 모션',
      };
    case 'GROWTH':
      return {
        command: { type: 'PREVIEW_PET', action: 'GROWTH', nowMs: nowMs() },
        message: '성장 이펙트',
      };
    case 'ASSET_V1':
      return { command: { type: 'SELECT_ASSET_VERSION', version: 'V1' }, message: '에셋 v1' };
    case 'ASSET_V2':
      return { command: { type: 'SELECT_ASSET_VERSION', version: 'V2' }, message: '에셋 v2' };
    case 'ATTACK_EFFECT':
      return { command: { type: 'CYCLE_ATTACK_EFFECT' }, message: '등급별 타격 이펙트' };
    case 'HIT':
      return {
        command: { type: 'PREVIEW_ENEMY', action: 'HIT', nowMs: nowMs() },
        message: '피격 모션',
      };
    case 'DEFEAT':
      return {
        command: { type: 'PREVIEW_ENEMY', action: 'DEFEAT', nowMs: nowMs() },
        message: '처치 모션',
      };
    case 'SPAWN':
      return {
        command: { type: 'PREVIEW_ENEMY', action: 'SPAWN', nowMs: nowMs() },
        message: '등장 모션',
      };
    case 'RESET':
      return {
        command: { type: 'PREVIEW_ENEMY', action: 'RESET', nowMs: nowMs() },
        message: '몬스터 복귀',
      };
    case 'SIZE':
      return { command: { type: 'CYCLE_ENEMY_SIZE' }, message: '적 크기 전환' };
    case 'COLOR':
      return { command: { type: 'CYCLE_ENEMY_COLOR' }, message: '적·배경 전환' };
    case 'HP':
      return { command: { type: 'CYCLE_ENEMY_HP' }, message: 'HP·표정 전환' };
    case 'REDUCED_MOTION':
      return { command: { type: 'TOGGLE_REDUCED_MOTION' }, message: '모션 감소 전환' };
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  const rawAction = button.dataset['action'];
  if (rawAction === 'OPACITY') return;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const { command, message } = commandFor(rawAction as ButtonAction);
    void execute(command, message);
  });
});

pet.addEventListener('click', (event) => {
  event.stopPropagation();
  void execute({ type: 'TOGGLE_MENU', menu: 'PET' });
});
enemy.addEventListener('click', (event) => {
  event.stopPropagation();
  void execute({ type: 'TOGGLE_MENU', menu: 'ENEMY' });
});
opacity.addEventListener('input', (event) => {
  event.stopPropagation();
  const percent = Number(opacity.value);
  void execute({ type: 'SET_DISPLAY_OPACITY', percent }, `투명도 ${percent}%`);
});
root.addEventListener('click', () => {
  if (state?.overlay) {
    void execute({ type: 'OVERLAY_CLICK', nowMs: nowMs() });
  }
});

void execute({ type: 'GET_STATE', nowMs: nowMs() });
window.setInterval(() => {
  if (!busy) void execute({ type: 'GET_STATE', nowMs: nowMs() });
}, 80);
