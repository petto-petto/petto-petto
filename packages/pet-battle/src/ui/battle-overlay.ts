import type { BattleCommand, BattleGateway, BattleState } from '../contracts.ts';
import {
  backgroundForEnemy,
  defeatedEnemyColors,
  deriveBattleScene,
  shouldStartEnemyHitReaction,
} from '../view/scene.ts';
import { DemoBattleGateway } from './demo-gateway.ts';
import { battleLayout, menuPositions, projectPetOffset } from '../view/layout.ts';
import { peekingSpectators } from '../view/peeking-spectators.ts';

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
  | 'ATTACK_EFFECT'
  | 'PET_ASSET'
  | 'HIT'
  | 'DEFEAT'
  | 'SPAWN'
  | 'RESET'
  | 'SIZE'
  | 'COLOR'
  | 'HP'
  | 'REDUCED_MOTION';

const root = required<HTMLElement>('#battle-overlay');
const environment = required<HTMLElement>('#battle-environment');
const pet = required<HTMLElement>('#pet');
const petSheet = required<HTMLImageElement>('#pet-sheet');
const enemy = required<HTMLElement>('#enemy');
const enemyImage = required<HTMLImageElement>('#enemy-image');
const background = required<HTMLImageElement>('#battle-background');
const hpBar = required<HTMLElement>('.enemy-hp');
const hpFill = required<HTMLElement>('#enemy-hp-fill');
const hpLabel = required<HTMLElement>('#enemy-hp-label');
const stageLabel = required<HTMLElement>('#stage-label');
const petName = required<HTMLElement>('#pet-name');
const petLevel = required<HTMLElement>('#pet-level');
const combatEffects = required<HTMLElement>('.combat-effects');
const toast = required<HTMLElement>('#battle-toast');
const petMenu = required<HTMLElement>('#pet-menu');
const enemyMenu = required<HTMLElement>('#enemy-menu');
const opacity = required<HTMLInputElement>('#display-opacity');
const petSpectators = required<HTMLElement>('#pet-spectators');
const defeatedEnemySpectators = required<HTMLElement>('#defeated-enemy-spectators');

const gateway: BattleGateway = window.petBattle ?? new DemoBattleGateway();
let state: BattleState | undefined;
let inFlight = 0;
let enemyHitTimer: number | undefined;
let spectatorKey = '';
let defeatedSpectatorKey = '';
let layout = battleLayout(root.clientWidth, root.clientHeight);

function resizeBattle(): void {
  if (root.clientWidth === 0 || root.clientHeight === 0) return;
  layout = battleLayout(root.clientWidth, root.clientHeight);
  const properties = {
    '--pet-size': layout.petSize,
    '--pet-left': layout.petLeft,
    '--enemy-left': layout.enemyLeft,
    '--floor-bottom': layout.height - layout.floor,
    '--character-top': layout.floor - layout.petSize,
    '--spectator-size': layout.spectatorSize,
    '--growth-x': (layout.petLeft - layout.enemyLeft) / layout.scale + 64,
  };
  for (const [name, value] of Object.entries(properties)) {
    root.style.setProperty(name, `${value}px`);
  }
  root.style.setProperty('--arena-scale', String(layout.scale));
  root.dataset['layout'] = layout.compact ? 'compact' : 'radial';
  for (const [menu, target] of [
    [petMenu, 'PET'],
    [enemyMenu, 'ENEMY'],
  ] as const) {
    const positions = menuPositions(layout, target);
    menu.querySelectorAll<HTMLElement>('.radial-button').forEach((button, index) => {
      const point = positions[index];
      if (!point) return;
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
    });
  }
  if (state) {
    const scene = deriveBattleScene(state);
    enemy.style.setProperty('--enemy-height', `${scene.enemyHeight * layout.scale}px`);
    updateSprite(scene.petSprite);
    updateMotion(state);
    positionPeekingSpectators(state);
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`battle UI element missing: ${selector}`);
  return element;
}

function assetUrl(path: string): string {
  return new URL(`../${path}`, document.baseURI).href;
}

function nowMs(): number {
  return Date.now();
}

async function execute(command: BattleCommand, message?: string): Promise<void> {
  if (command.type === 'GET_STATE' && inFlight > 0) return;
  inFlight += 1;
  try {
    const result = await gateway.execute(command);
    const previous = state;
    state = result.state;
    render(state, previous);
    if (message) showToast(message);
  } catch (error) {
    showToast(`연결 오류 · ${String(error)}`, true);
  } finally {
    inFlight -= 1;
  }
}

function render(next: BattleState, previous?: BattleState): void {
  const scene = deriveBattleScene(next);
  background.src = assetUrl(scene.backgroundAsset);
  petSheet.src = assetUrl(scene.petAsset);
  enemyImage.src = assetUrl(scene.enemyAsset);
  enemy.style.setProperty('--enemy-height', `${scene.enemyHeight * layout.scale}px`);
  environment.style.opacity = String(scene.displayOpacity);
  enemy.style.opacity = scene.enemyVisible ? String(scene.displayOpacity) : '0';
  hpBar.style.opacity = String(scene.displayOpacity);
  stageLabel.style.opacity = String(scene.displayOpacity);
  combatEffects.style.opacity = String(scene.displayOpacity);
  hpFill.style.width = `${(scene.enemyHpRatio * 100).toFixed(1)}%`;
  hpLabel.textContent = `${Math.round(scene.enemyHpRatio * 100)}%`;
  stageLabel.textContent = `STAGE ${next.activePet?.stage ?? '—'}`;
  petName.textContent = next.activePet?.displayName ?? '활성 펫 없음';
  petLevel.textContent = next.activePet ? `LV.${next.activePet.level}` : 'LV.—';
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
  if (shouldStartEnemyHitReaction(previous, next)) triggerEnemyHitReaction();
  updateSprite(scene.petSprite);
  updateControlLabels(next);
  updateSpectators(next);
}

function updateSpectators(next: BattleState): void {
  const pets = next.spectatorPetIds
    .map((petId) => next.roster.find((pet) => pet.petId === petId))
    .filter((pet): pet is NonNullable<typeof pet> => pet !== undefined)
    .slice(0, 3);
  const theme = backgroundForEnemy(next.preview.enemyColor ?? next.enemyColor);
  const key = JSON.stringify([
    pets.map((pet) => [pet.petId, pet.rarity, pet.displayName]),
    theme,
    next.activePet?.stage,
  ]);
  if (key !== spectatorKey) {
    spectatorKey = key;
    petSpectators.dataset['theme'] = theme;
    petSpectators.replaceChildren(
      ...pets.map((pet) => {
        const slot = document.createElement('span');
        slot.className = 'peek-slot';
        slot.dataset['petId'] = pet.petId;
        const head = document.createElement('span');
        head.className = 'peek-head';
        const image = document.createElement('img');
        image.src = assetUrl(petAssetForRarity(pet.rarity));
        image.alt = `${pet.displayName} · 빼꼼 응원`;
        image.draggable = false;
        head.append(image);
        slot.append(head);
        return slot;
      }),
    );
    petSpectators.hidden = pets.length === 0;
    positionPeekingSpectators(next);
  }

  const enemies = defeatedEnemyColors(next.activePet?.stage ?? 1);
  const enemyKey = enemies.join(',');
  if (enemyKey === defeatedSpectatorKey) return;
  defeatedSpectatorKey = enemyKey;
  defeatedEnemySpectators.replaceChildren(
    ...enemies.map((color) =>
      spectatorElement(
        'enemy-fan defeated-fan',
        `assets/enemies/v2/${color.toLowerCase()}-exhausted.png`,
        `처치한 ${color.toLowerCase()} 적`,
      ),
    ),
  );
  defeatedEnemySpectators.hidden = enemies.length === 0;
}

function positionPeekingSpectators(next: BattleState): void {
  const theme = backgroundForEnemy(next.preview.enemyColor ?? next.enemyColor);
  const slots = peekingSpectators(theme, root.clientWidth, root.clientHeight);
  petSpectators.querySelectorAll<HTMLElement>('.peek-slot').forEach((element, index) => {
    const slot = slots[index];
    element.hidden = !slot;
    if (!slot) return;
    element.dataset['direction'] = slot.direction;
    element.style.left = `${slot.x}px`;
    element.style.top = `${slot.y}px`;
    element.style.setProperty('--peek-duration', `${slot.durationMs}ms`);
    element.style.setProperty('--peek-delay', `${slot.delayMs}ms`);
  });
}

function spectatorElement(className: string, asset: string, label: string): HTMLElement {
  const viewport = document.createElement('span');
  viewport.className = `spectator ${className}`;
  const image = document.createElement('img');
  image.src = assetUrl(asset);
  image.alt = label;
  image.draggable = false;
  viewport.append(image);
  return viewport;
}

function petAssetForRarity(rarity: BattleState['roster'][number]['rarity']): string {
  return `assets/pets/v2/${rarity.toLowerCase()}-idle.png`;
}

function updateMotion(next: BattleState): void {
  const motion = next.motion;
  if (!motion) {
    pet.style.removeProperty('transform');
    enemy.style.removeProperty('transform');
    return;
  }
  const offset = projectPetOffset(layout, motion.petOffset);
  pet.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${motion.petScale.x}, ${motion.petScale.y})`;
  enemy.style.transform = `translate(${motion.enemyOffset.x * layout.scale}px, ${motion.enemyOffset.y * layout.scale}px) scale(${motion.enemyScale.x}, ${motion.enemyScale.y})`;
  root.style.setProperty('--slash-opacity', String(motion.slashOpacity));
  root.style.setProperty('--impact-opacity', String(motion.impactFlashOpacity));
  root.style.setProperty('--speed-opacity', String(motion.speedLineOpacity));
}

function triggerEnemyHitReaction(): void {
  if (enemyHitTimer !== undefined) window.clearTimeout(enemyHitTimer);
  enemy.classList.remove('hit-reaction');
  void enemy.offsetWidth;
  enemy.classList.add('hit-reaction');
  enemyHitTimer = window.setTimeout(() => {
    enemy.classList.remove('hit-reaction');
    enemyHitTimer = undefined;
  }, 420);
}

function updateSprite(sprite: ReturnType<typeof deriveBattleScene>['petSprite']): void {
  petSheet.style.setProperty('--frame-count', String(sprite.frameCount));
  petSheet.style.setProperty('--frame-steps', String(sprite.frameSteps));
  petSheet.style.setProperty('--sheet-shift', `${-(sprite.frameCount - 1) * layout.petSize}px`);
  petSheet.style.setProperty('--sheet-duration', `${sprite.durationMs}ms`);
  petSheet.classList.toggle('animated-sheet', sprite.animated);
}

function updateControlLabels(next: BattleState): void {
  const color = next.preview.enemyColor ?? '색상';
  const size = next.preview.enemySize ?? '크기';
  const effect = next.preview.attackEffectRarity ?? '효과';
  const petAsset = next.preview.petAssetRarity ?? '펫';
  const hp = next.preview.enemyHpRatio;
  labelFor('COLOR', colorLabel(color));
  labelFor('SIZE', sizeLabel(size));
  labelFor('ATTACK_EFFECT', effect === '효과' ? effect : (effect[0] ?? effect));
  labelFor('PET_ASSET', petAsset === '펫' ? petAsset : rarityLabel(petAsset));
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

function rarityLabel(rarity: string): string {
  return { COMMON: '기본', RARE: '희귀', EPIC: '영웅' }[rarity] ?? rarity;
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
    case 'ATTACK_EFFECT':
      return { command: { type: 'CYCLE_ATTACK_EFFECT' }, message: '등급별 타격 이펙트' };
    case 'PET_ASSET':
      return { command: { type: 'CYCLE_PET_ASSET' }, message: '펫 에셋 전환' };
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

required<HTMLButtonElement>('.window-close').addEventListener('click', (event) => {
  event.stopPropagation();
  window.close();
});

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

resizeBattle();
const resizeObserver = new ResizeObserver(resizeBattle);
resizeObserver.observe(root);
void execute({ type: 'GET_STATE', nowMs: nowMs() });
window.setInterval(() => {
  void execute({ type: 'GET_STATE', nowMs: nowMs() });
}, 80);
