import type { BattleClient, BattleClientCommand } from '../client.ts';
import type { BattleState } from '../contracts.ts';
import {
  backgroundForEnemy,
  deriveBattleScene,
  shouldStartEnemyHitReaction,
  visibleEnemyStage,
} from '../view/scene.ts';
import { DemoBattleGateway } from '../testing/demo-gateway.ts';
import { battleLayout, menuPositions, projectPetOffset } from '../view/layout.ts';
import { peekingSpectators } from '../view/peeking-spectators.ts';
import { AmbientLogsView } from './ambient-logs.ts';
import { ambientPortrait } from '../view/ambient-portraits.ts';
import { PetGrounding } from './pet-grounding.ts';
import { BattleImages, setImageSource } from './battle-images.ts';
import { ArenaDirector, type ArenaFrame } from '../view/arena.ts';
import { combatContactDistance, separateCombatants } from '../view/footwork.ts';
import { HpBarMotion, type HpBarFrame } from '../view/hp-bar-motion.ts';
import {
  petCombatAnimation,
  petCombatDecorations,
  zebraForwardProjection,
} from '../view/pet-combat-animations.ts';
import { MoleSprite } from './mole-sprite.ts';
import { SproutRoots } from './sprout-roots.ts';
import { ZebraShockwave } from './zebra-shockwave.ts';
import { ZebraSprite } from './zebra-sprite.ts';
import { HamsterSprite } from './hamster-sprite.ts';
import { HamsterFood } from './hamster-food.ts';
import { hamsterBodyProjection, hamsterMouthPosition } from '../view/hamster-combat.ts';
import { WizardSprite } from './wizard-sprite.ts';
import { WizardMeteors } from './wizard-meteors.ts';
import { wizardBodyProjection } from '../view/wizard-combat.ts';
import { SquirrelSprite } from './squirrel-sprite.ts';
import { SquirrelForest } from './squirrel-forest.ts';
import { squirrelBodyProjection } from '../view/squirrel-combat.ts';

declare global {
  interface Window {
    petBattle?: BattleClient;
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
  | 'HP';

const root = required<HTMLElement>('#battle-overlay');
const environment = required<HTMLElement>('#battle-environment');
const worldPlane = required<HTMLElement>('#battle-world');
const pet = required<HTMLElement>('#pet');
const petSheet = required<HTMLImageElement>('#pet-sheet');
const moleCanvas = required<HTMLCanvasElement>('.mole-native-sprite');
const moleSprite = new MoleSprite(moleCanvas);
const zebraCanvas = required<HTMLCanvasElement>('.zebra-native-sprite');
const zebraSprite = new ZebraSprite(zebraCanvas);
const hamsterCanvas = required<HTMLCanvasElement>('.hamster-native-sprite');
const hamsterSprite = new HamsterSprite(hamsterCanvas);
const hamsterFood = new HamsterFood(required<HTMLCanvasElement>('.hamster-food'));
const wizardCanvas = required<HTMLCanvasElement>('.wizard-native-sprite');
const wizardSprite = new WizardSprite(wizardCanvas);
const squirrelCanvas = required<HTMLCanvasElement>('.squirrel-native-sprite');
const squirrelSprite = new SquirrelSprite(squirrelCanvas);
const squirrelForest = new SquirrelForest(
  required<HTMLCanvasElement>('.squirrel-grove'),
  required<HTMLCanvasElement>('.squirrel-storm'),
);
const wizardMeteors = new WizardMeteors(
  required<HTMLCanvasElement>('.wizard-sky'),
  required<HTMLCanvasElement>('.wizard-meteors'),
);
const moleSoil = required<HTMLElement>('.mole-soil');
const sproutRoots = new SproutRoots(required<HTMLCanvasElement>('.sprout-roots'));
const zebraShockwave = new ZebraShockwave(required<HTMLCanvasElement>('.zebra-shockwave'));
const petViewport = required<HTMLElement>('.pet-viewport');
const enemy = required<HTMLElement>('#enemy');
const enemyImage = required<HTMLImageElement>('#enemy-image');
const background = required<HTMLImageElement>('#battle-background');
const hpBar = required<HTMLElement>('.enemy-hp');
const hpFill = required<HTMLElement>('#enemy-hp-fill');
const hpLabel = required<HTMLElement>('#enemy-hp-label');
const stageLabel = required<HTMLElement>('#stage-label');
const combatEffects = required<HTMLElement>('.combat-effects');
const enemySlam = required<HTMLElement>('.enemy-slam');
const defeatBurst = required<HTMLElement>('.defeat-burst');
const toast = required<HTMLElement>('#battle-toast');
const notice = required<HTMLElement>('#battle-notice');
const petMenu = required<HTMLElement>('#pet-menu');
const enemyMenu = required<HTMLElement>('#enemy-menu');
const opacity = required<HTMLInputElement>('#display-opacity');
const petSpectators = required<HTMLElement>('#pet-spectators');
const ambientLogs = new AmbientLogsView(root);
const battleImages = new BattleImages();
const petGrounding = new PetGrounding((offset) => {
  pet.style.setProperty('--pet-ground-offset', `${offset}px`);
});

const gateway: BattleClient = window.petBattle ?? new DemoBattleGateway();
let state: BattleState | undefined;
let inFlight = 0;
let enemyHitTimer: number | undefined;
let enemySlamTimer: number | undefined;
let spectatorKey = '';
let layout = battleLayout(root.clientWidth, root.clientHeight);
const arena = new ArenaDirector();
const hpMotion = new HpBarMotion();
let arenaFrame: ArenaFrame | undefined;
let arenaKey: string | null = null;
let previousPetImpact = false;
let previousEnemyImpact = false;
let worldOverscan = 32;
let spriteKey = '';
let manualAttack: number | undefined;
let previewSequence = 0;
let suppressedAttackPreview = false;
const reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function resizeBattle(): void {
  if (root.clientWidth === 0 || root.clientHeight === 0) return;
  layout = battleLayout(root.clientWidth, root.clientHeight);
  petGrounding.resize(layout.petSize);
  const properties = {
    '--pet-size': layout.petSize,
    '--enemy-frame-size': layout.enemyFrameSize,
    '--pet-left': layout.petLeft,
    '--enemy-left': layout.enemyLeft,
    '--floor-bottom': layout.height - layout.floor,
    '--character-top': layout.floor - layout.enemyFrameSize,
    '--growth-x': (layout.petLeft - layout.enemyLeft) / layout.scale + layout.petSize / 2,
  };
  for (const [name, value] of Object.entries(properties)) {
    root.style.setProperty(name, `${value}px`);
  }
  root.style.setProperty('--arena-scale', String(layout.scale));
  root.dataset['layout'] = layout.compact ? 'compact' : 'radial';
  updateWorldSize();
  positionMenus();
  if (state) {
    const scene = deriveBattleScene(state);
    enemy.style.setProperty('--enemy-height', `${scene.enemyHeight * layout.scale}px`);
    paintArena(state);
    positionPeekingSpectators(state);
    updateAmbientLogs(state);
  }
}

function positionMenus(): void {
  const currentLayout = arenaFrame
    ? {
        ...layout,
        petLeft: arenaFrame.pet.x,
        enemyLeft: arenaFrame.enemy.x,
        floor: arenaFrame.pet.y,
      }
    : layout;
  for (const [menu, target] of [
    [petMenu, 'PET'],
    [enemyMenu, 'ENEMY'],
  ] as const) {
    const positions = menuPositions(currentLayout, target);
    menu.querySelectorAll<HTMLElement>('.radial-button').forEach((button, index) => {
      const point = positions[index];
      if (!point) return;
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
    });
  }
}

function updateWorldSize(): void {
  worldPlane.style.width = `${layout.width + worldOverscan * 2}px`;
  worldPlane.style.height = `${layout.height + worldOverscan * 2}px`;
  worldPlane.style.left = `${-worldOverscan}px`;
  worldPlane.style.top = `${-worldOverscan}px`;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`battle UI element missing: ${selector}`);
  return element;
}

function assetUrl(path: string): string {
  if (path.startsWith('file:')) return new URL(path).href;
  return new URL(path, document.baseURI).href;
}

function nowMs(): number {
  return Date.now();
}

async function execute(command: BattleClientCommand, message?: string): Promise<void> {
  if (command.type === 'GET_STATE' && inFlight > 0) return;
  inFlight += 1;
  try {
    const result = await gateway.execute(command);
    if (command.type === 'SET_BATTLE_RUNNING' && !command.running) hpMotion.cancel();
    const previous = state;
    state = result.state;
    if (
      (command.type === 'PREVIEW_PET' && command.action === 'ATTACK') ||
      command.type === 'CYCLE_ATTACK_EFFECT'
    )
      suppressedAttackPreview = false;
    if (command.type !== 'GET_STATE' && command.type !== 'SET_DISPLAY_OPACITY') {
      manualAttack = undefined;
      if (
        ((command.type === 'PREVIEW_PET' && command.action === 'ATTACK') ||
          command.type === 'CYCLE_ATTACK_EFFECT') &&
        petCombatAnimation(deriveBattleScene(state).petCombatSpecies).id !== 'default'
      )
        manualAttack = ++previewSequence;
    }
    render(state, previous);
    if (
      command.type === 'SET_BATTLE_RUNNING' &&
      command.running &&
      state.preview.menu !== 'CLOSED'
    ) {
      await execute({ type: 'TOGGLE_MENU', menu: state.preview.menu });
    }
    if (message) showToast(message);
  } catch (error) {
    if (!state) {
      // Keep the initial scene and a durable status while the existing poll retries.
      // Never substitute demo pets for a failed authoritative host response.
      notice.textContent = '전투 정보를 불러오지 못했습니다. 다시 연결하는 중…';
      notice.title = String(error);
      notice.hidden = false;
    } else {
      showToast(`연결 오류 · ${String(error)}`, true);
    }
  } finally {
    inFlight -= 1;
  }
}

function render(next: BattleState, previous?: BattleState): void {
  const scene = deriveBattleScene(next);
  const hasPet = next.activePet !== null;
  pet.hidden = !hasPet;
  enemy.hidden = !hasPet;
  hpBar.hidden = !hasPet;
  stageLabel.hidden = !hasPet;
  combatEffects.hidden = !hasPet;
  notice.textContent = !hasPet
    ? next.selectionSource === 'ROOM'
      ? '펫룸에서 전투에 사용할 펫을 지정해 주세요.'
      : '공통 펫 목록에서 활성 펫을 선택해 주세요.'
    : next.growthStatus === 'UNLINKED'
      ? '성장 정보 연결 대기 · 모션 미리보기'
      : '';
  notice.title = '';
  notice.hidden = notice.textContent === '';
  notice.style.opacity = String(scene.displayOpacity);
  setImageSource(background, assetUrl(scene.backgroundAsset));
  petGrounding.setSource(hasPet ? assetUrl(scene.petIdleAsset) : null);
  setImageSource(enemyImage, assetUrl(scene.enemyAsset));
  enemyImage.style.filter =
    scene.enemyHueShiftDegrees === 0 ? '' : `hue-rotate(${scene.enemyHueShiftDegrees}deg)`;
  void battleImages.preload(hasPet ? assetUrl(scene.petAttackAsset) : null);
  enemy.style.setProperty('--enemy-height', `${scene.enemyHeight * layout.scale}px`);
  environment.style.opacity = String(scene.displayOpacity);
  enemy.style.opacity = scene.enemyVisible ? String(scene.displayOpacity) : '0';
  hpBar.style.opacity = String(scene.displayOpacity);
  stageLabel.style.opacity = String(scene.displayOpacity);
  combatEffects.style.opacity = String(scene.displayOpacity);
  enemySlam.style.opacity = String(scene.displayOpacity);
  defeatBurst.style.opacity = String(scene.displayOpacity);
  enemySlam.hidden = !hasPet;
  defeatBurst.hidden = !hasPet;
  const hpText = `${Math.round(scene.enemyHpRatio * 100)}%`;
  const stageText = `STAGE ${scene.enemyColorStage}-${scene.enemySizeStage}`;
  if (hpLabel.textContent !== hpText) hpLabel.textContent = hpText;
  if (stageLabel.textContent !== stageText) stageLabel.textContent = stageText;
  opacity.value = String(Math.round(scene.displayOpacity * 100));
  root.dataset['enemyPhase'] = scene.enemyPhase;
  root.dataset['petAction'] = next.preview.petAction ?? 'IDLE';
  root.dataset['effectRarity'] =
    next.preview.attackEffectRarity ?? next.activePet?.rarity ?? 'COMMON';
  root.classList.toggle('reduced-motion', next.preview.reducedMotion);
  root.style.setProperty('--slash-count', String(scene.attackEffect.slashCount));
  root.style.setProperty('--particle-count', String(scene.attackEffect.particleCount));
  petMenu.hidden = !hasPet || next.preview.menu !== 'PET';
  enemyMenu.hidden = !hasPet || next.preview.menu !== 'ENEMY';
  paintArena(next);
  if (
    ((next.preview.petAction === 'ATTACK' &&
      !suppressedAttackPreview &&
      petCombatAnimation(scene.petCombatSpecies).id === 'default') ||
      next.preview.enemyAction === 'HIT') &&
    shouldStartEnemyHitReaction(previous, next)
  )
    triggerEnemyHitReaction();
  if (next.preview.menu !== 'CLOSED') positionMenus();
  updateControlLabels(next);
  updateSpectators(next);
  updateAmbientLogs(next);
}

function updateAmbientLogs(next: BattleState): void {
  const scene = deriveBattleScene(next);
  const phase = scene.enemyPhase;
  ambientLogs.update({
    layout,
    now: nowMs(),
    petId: next.activePet?.petId ?? null,
    enemyKey: `${next.activePet?.stage ?? 1}:${next.preview.enemyColor ?? next.enemyColor}`,
    enemyVisible: next.activePet !== null && (phase === 'VISIBLE' || phase === 'HIT'),
    hasDefeatedSpectators: false,
    pageVisible: !document.hidden,
    menuOpen: next.preview.menu !== 'CLOSED',
    opacity: Math.max(0, Math.min(1, next.preview.displayOpacity)),
    petPortrait: ambientPortrait(assetUrl(scene.petIdleAsset), 'PET'),
    enemyPortrait: ambientPortrait(assetUrl(scene.enemyAsset), 'ENEMY'),
  });
}

function updateSpectators(next: BattleState): void {
  const pets = next.spectatorPetIds
    .map((petId) => next.roster.find((pet) => pet.petId === petId))
    .filter((pet): pet is NonNullable<typeof pet> => pet !== undefined)
    .slice(0, 3);
  const theme = currentTheme(next);
  const key = JSON.stringify([
    pets.map((pet) => [pet.petId, pet.rarity, pet.displayName, pet.sprite, pet.evolutionStage]),
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
        slot.dataset['rarity'] = pet.rarity;
        const actor = document.createElement('span');
        actor.className = 'peek-actor';
        const sprite = document.createElement('span');
        sprite.className = 'peek-sprite';
        const image = document.createElement('img');
        const shared = next.petSprites?.[pet.petId]?.idle;
        setImageSource(image, assetUrl(shared?.asset ?? petAssetForRarity(pet.rarity)));
        if (shared) image.style.width = `${shared.frameCount * 100}%`;
        image.alt = `${pet.displayName} · 빼꼼 응원`;
        image.draggable = false;
        sprite.append(image);
        actor.append(sprite);
        slot.append(actor);
        return slot;
      }),
    );
    petSpectators.hidden = pets.length === 0;
    positionPeekingSpectators(next);
  }
}

function positionPeekingSpectators(next: BattleState): void {
  const theme = currentTheme(next);
  const slots = peekingSpectators(
    theme,
    layout.width + worldOverscan * 2,
    layout.height + worldOverscan * 2,
  );
  petSpectators.querySelectorAll<HTMLElement>('.peek-slot').forEach((element, index) => {
    const slot = slots[index];
    element.hidden = !slot;
    if (!slot) return;
    element.dataset['direction'] = slot.direction;
    element.style.left = `${slot.x}px`;
    element.style.top = `${slot.y}px`;
    element.style.width = `${slot.width}px`;
    element.style.height = `${slot.height}px`;
    element.style.clipPath = slot.clipPath;
    element.style.setProperty('--peek-frame', `${slot.frameSize}px`);
    element.style.setProperty('--peek-duration', `${slot.durationMs}ms`);
    element.style.setProperty('--peek-delay', `${slot.delayMs}ms`);
  });
}

function petAssetForRarity(rarity: BattleState['roster'][number]['rarity']): string {
  return `assets/pets/v2/${rarity.toLowerCase()}-idle.png`;
}

function currentTheme(next: BattleState) {
  return backgroundForEnemy(
    next.overlay ? next.enemyColor : (next.preview.enemyColor ?? next.enemyColor),
  );
}

/** World movement is left/bottom; hit keyframes may squash without resetting world position. */
function placeActor(
  element: HTMLElement,
  x: number,
  foot: number,
  scaleX: number,
  scaleY: number,
): void {
  element.style.left = `${x}px`;
  element.style.bottom = `${layout.height - foot}px`;
  element.style.transform = `scale(${scaleX}, ${scaleY})`;
}

function paintArena(next: BattleState): void {
  const base = deriveBattleScene(next, false);
  const customAnimation = petCombatAnimation(base.petCombatSpecies).id !== 'default';
  const reducedMotion = next.preview.reducedMotion || reducedMotionPreference.matches;
  const key = next.activePet
    ? `${next.activePet.petId}:${visibleEnemyStage(next)}:${currentTheme(next)}:${base.petIdleAsset}`
    : null;
  if (next.preview.petAction !== 'ATTACK') suppressedAttackPreview = false;
  if (key !== arenaKey && arenaKey !== null && next.preview.petAction === 'ATTACK')
    suppressedAttackPreview = true;
  const manual =
    manualAttack !== undefined ||
    (next.preview.petAction !== null &&
      !((customAnimation || suppressedAttackPreview) && next.preview.petAction === 'ATTACK')) ||
    next.preview.enemyAction !== null;
  const hpInput = {
    key:
      next.activePet &&
      !document.hidden &&
      ((!next.overlay && ['VISIBLE', 'HIT'].includes(base.enemyPhase)) ||
        next.overlay?.phase === 'DEFEAT_MOTION')
        ? `${next.activePet.petId}:${visibleEnemyStage(next)}`
        : null,
    resetKey: `${next.activePet?.battleMode}:${next.preview.menu}`,
    ratio: base.enemyHpRatio,
    nowMs: nowMs(),
    reducedMotion,
    running:
      !next.overlay &&
      next.activePet?.battleMode === 'FIGHTING' &&
      next.preview.menu === 'CLOSED' &&
      !manual,
  };
  // Synchronize truth/control changes before accepting this frame's impact.
  hpMotion.frame(hpInput);
  if (key !== arenaKey) {
    clearEnemyHitReaction();
    previousPetImpact = false;
    manualAttack = undefined;
    clearEnemySlam();
    previousEnemyImpact = false;
    arenaKey = key;
  }
  const frame = arena.frame({
    layout,
    nowMs: nowMs(),
    hpRatio: base.enemyHpRatio,
    enemyHeight: base.enemyHeight,
    petFrontRatio: petGrounding.frontRatio,
    petSprite: base.petCombatSpecies,
    manualAttack,
    suspended: document.hidden || next.overlay !== null || base.enemyPhase !== 'VISIBLE',
    theme: currentTheme(next),
    key,
    running:
      next.activePet?.battleMode === 'FIGHTING' &&
      !next.overlay &&
      base.enemyPhase === 'VISIBLE' &&
      !manual &&
      !document.hidden,
    menuOpen: next.preview.menu !== 'CLOSED',
    reducedMotion,
  });
  arenaFrame = frame;
  if (!frame.previewing) manualAttack = undefined;
  // One owner controls sprites and lingering effects, including recovery frames.
  if (frame.attackTurn !== 'ENEMY') clearEnemySlam();
  if (frame.attackTurn === 'ENEMY') clearEnemyHitReaction();
  if (
    !manual &&
    (next.preview.menu !== 'CLOSED' || next.activePet?.battleMode !== 'FIGHTING' || next.overlay)
  ) {
    clearEnemyHitReaction();
  }
  if (worldOverscan !== frame.backgroundOverscan) {
    worldOverscan = frame.backgroundOverscan;
    updateWorldSize();
    positionPeekingSpectators(next);
  }
  worldPlane.style.transform = `translate(${-frame.camera.x}px, ${-frame.camera.y}px)`;
  const motion =
    !customAnimation && !suppressedAttackPreview && next.preview.petAction === 'ATTACK'
      ? next.motion
      : undefined;
  const contact = motion
    ? combatContactDistance(layout, base.enemyHeight)
    : frame.minimumSeparation;
  const offset = motion
    ? projectPetOffset(
        {
          ...layout,
          petLeft: frame.pet.x,
          enemyLeft: frame.enemy.x,
          attackDistance: Math.max(0, frame.enemy.x - frame.pet.x - contact),
        },
        motion.petOffset,
      )
    : { x: 0, y: 0 };
  // Preview offsets retain the same impact but cannot carry actors beyond the viewport.
  const separated = separateCombatants(
    frame.pet.x + offset.x,
    frame.enemy.x + (motion?.enemyOffset.x ?? 0),
    contact,
  );
  // Both preview and automatic motion share the silhouette envelope. Shift the pair,
  // not individual actors, at an edge so clamping cannot reintroduce an overlap.
  const pairShift = Math.max(
    12 - separated.petX,
    Math.min(0, layout.width - layout.enemyFrameSize - 14 - separated.enemyX),
  );
  const petX = separated.petX + pairShift;
  const petY = Math.max(layout.petSize + 8, Math.min(layout.height - 12, frame.pet.y + offset.y));
  const enemyX = separated.enemyX + pairShift;
  const enemyY = Math.max(
    base.enemyHeight * 1.2 + 8,
    Math.min(layout.height - 12, frame.enemy.y + (motion?.enemyOffset.y ?? 0)),
  );
  placeActor(
    pet,
    petX,
    petY,
    motion?.petScale.x ?? frame.pet.scaleX,
    motion?.petScale.y ?? frame.pet.scaleY,
  );
  placeActor(
    enemy,
    enemyX,
    enemyY,
    motion?.enemyScale.x ?? frame.enemy.scaleX,
    motion?.enemyScale.y ?? frame.enemy.scaleY,
  );
  root.dataset['petAnimation'] = frame.petAnimation.id;
  root.dataset['molePhase'] = frame.petAnimation.phase;
  root.dataset['petCombatPhase'] = frame.petAnimation.phase;
  const wizardBody = wizardBodyProjection(
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
    layout.petSize,
    { x: petX, foot: petY, width: layout.width, height: layout.height },
  );
  pet.style.setProperty('--wizard-x', `${wizardBody.x}px`);
  pet.style.setProperty('--wizard-y', `${wizardBody.y}px`);
  pet.style.setProperty('--wizard-sx', String(wizardBody.scaleX));
  pet.style.setProperty('--wizard-sy', String(wizardBody.scaleY));
  pet.style.setProperty('--wizard-tilt', `${wizardBody.tilt}deg`);
  pet.style.setProperty('--wizard-shadow-scale', String(wizardBody.shadowScale));
  pet.style.setProperty('--wizard-shadow-opacity', String(wizardBody.shadowOpacity));
  const spriteGround = Number.parseFloat(pet.style.getPropertyValue('--pet-ground-offset')) || 0;
  wizardMeteors.paint(
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
    {
      width: layout.width,
      height: layout.height,
      size: layout.petSize,
      caster: {
        x: petX + layout.petSize / 2 + wizardBody.x,
        y: petY - layout.petSize / 2 + spriteGround + wizardBody.y,
      },
      casterFoot: { x: petX + layout.petSize / 2, y: petY },
      target: {
        x: enemyX + layout.enemyFrameSize * 0.36,
        y: enemyY - base.enemyHeight * layout.scale * 0.55,
      },
      targetFoot: { x: enemyX + layout.enemyFrameSize * 0.36, y: enemyY },
    },
    next.preview.displayOpacity,
  );
  const hamsterPlacement = { x: petX, foot: petY, width: layout.width, height: layout.height };
  const squirrelBody = squirrelBodyProjection(
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
    layout.petSize,
    hamsterPlacement,
  );
  pet.style.setProperty('--squirrel-x', `${squirrelBody.x}px`);
  pet.style.setProperty('--squirrel-y', `${squirrelBody.y}px`);
  pet.style.setProperty('--squirrel-sx', String(squirrelBody.scaleX));
  pet.style.setProperty('--squirrel-sy', String(squirrelBody.scaleY));
  pet.style.setProperty('--squirrel-tilt', `${squirrelBody.tilt}deg`);
  pet.style.setProperty('--squirrel-shadow-scale', String(squirrelBody.shadowScale));
  pet.style.setProperty('--squirrel-shadow-opacity', String(squirrelBody.shadowOpacity));
  squirrelForest.paint(
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
    {
      width: layout.width,
      height: layout.height,
      size: layout.petSize,
      caster: {
        x: petX + layout.petSize / 2 + squirrelBody.x,
        y: petY - layout.petSize / 2 + spriteGround + squirrelBody.y,
      },
      casterFoot: { x: petX + layout.petSize / 2, y: petY },
      target: {
        x: enemyX + layout.enemyFrameSize * 0.36,
        y: enemyY - base.enemyHeight * layout.scale * 0.55,
      },
      targetFoot: { x: enemyX + layout.enemyFrameSize * 0.36, y: enemyY },
    },
    next.preview.displayOpacity,
    squirrelSprite.ghostFor(assetUrl(base.petIdleAsset)),
  );
  const hamsterBody = hamsterBodyProjection(frame.petAnimation, layout.petSize, hamsterPlacement);
  pet.style.setProperty('--hamster-x', `${hamsterBody.x}px`);
  pet.style.setProperty('--hamster-y', `${hamsterBody.y}px`);
  pet.style.setProperty('--hamster-sx', String(hamsterBody.scaleX));
  pet.style.setProperty('--hamster-sy', String(hamsterBody.scaleY));
  pet.style.setProperty('--hamster-tilt', `${hamsterBody.tilt}deg`);
  pet.style.setProperty('--hamster-shadow-scale', String(hamsterBody.shadowScale));
  pet.style.setProperty('--hamster-shadow-opacity', String(hamsterBody.shadowOpacity));
  const forward = zebraForwardProjection(frame.petAnimation, layout.petSize);
  pet.style.setProperty('--zebra-forward-scale', String(forward.scale));
  pet.style.setProperty('--zebra-forward-y', `${forward.offsetY}px`);
  pet.style.setProperty(
    '--sprout-dip',
    `${Math.round(frame.petAnimation.bodyDip * 2) * Math.max(1, Math.round(layout.petSize / 32))}px`,
  );
  sproutRoots.paint(
    frame.petAnimation,
    { x: petX + layout.petSize * 0.6, y: petY - 3 },
    { x: enemyX + layout.enemyFrameSize * 0.3, y: enemyY - 3 },
    next.activePet?.evolutionStage ?? 0,
    layout.petSize / 32,
    layout.width,
    layout.height,
  );
  zebraShockwave.paint(
    frame.petAnimation,
    { x: petX + layout.petSize * 0.6, y: petY - 3 },
    { x: enemyX + layout.enemyFrameSize * 0.05, y: enemyY - 3 },
    next.activePet?.evolutionStage ?? 0,
    layout.petSize / 32,
    layout.width,
    layout.height,
  );
  const petUnit = layout.petSize / 32;
  hamsterFood.paint(
    frame.petAnimation,
    hamsterMouthPosition(
      frame.petAnimation,
      next.activePet?.evolutionStage ?? 0,
      layout.petSize,
      Number.parseFloat(pet.style.getPropertyValue('--pet-ground-offset')) || 0,
      hamsterPlacement,
    ),
    {
      x: enemyX + layout.enemyFrameSize * 0.36,
      y: enemyY - base.enemyHeight * layout.scale * 0.55,
    },
    next.activePet?.evolutionStage ?? 0,
    petUnit,
    layout.width,
    layout.height,
  );
  const decorations = petCombatDecorations(frame.petAnimation, layout.petSize);
  pet.style.setProperty('--burrow-depth', `${decorations.burrowDepth}px`);
  pet.style.setProperty('--mole-shadow', String(decorations.shadow));
  pet.style.setProperty('--dirt-y', `${decorations.dirtY}px`);
  moleSoil.style.opacity = String(frame.petAnimation.dust);
  root.dataset['arenaPhase'] = frame.phase;
  root.dataset['attackTurn'] = frame.attackTurn ?? '';
  root.dataset['inAttackRange'] = String(frame.inAttackRange);
  root.dataset['retreating'] = frame.retreating ?? '';
  root.dataset['petWorldX'] = String(frame.world.pet.x);
  root.dataset['petWorldY'] = String(frame.world.pet.y);
  root.dataset['enemyWorldX'] = String(frame.world.enemy.x);
  root.dataset['enemyWorldY'] = String(frame.world.enemy.y);
  root.dataset['petHit'] = String(frame.petHit);
  root.dataset['enemyImpact'] = String(frame.enemyImpact);
  root.dataset['petWalking'] = String(frame.petStep !== null);
  root.dataset['enemyWalking'] = String(frame.enemyStep !== null);
  root.dataset['petStep'] = frame.petStep === null ? '' : String(frame.petStep);
  root.dataset['enemyStep'] = frame.enemyStep === null ? '' : String(frame.enemyStep);
  enemy.style.setProperty(
    '--jump-shadow-offset',
    `${Math.max(0, frame.world.enemy.y - frame.camera.y - enemyY) / frame.enemy.scaleY}px`,
  );
  root.dataset['beat'] =
    motion?.beat ?? (frame.petImpact ? 'IMPACT' : frame.petAttack ? 'STRIKE' : 'IDLE');
  root.style.setProperty(
    '--slash-opacity',
    String(motion?.slashOpacity ?? Number(frame.petImpact)),
  );
  root.style.setProperty(
    '--impact-opacity',
    String(motion?.impactFlashOpacity ?? Number(frame.petImpact)),
  );
  root.style.setProperty(
    '--speed-opacity',
    String(motion?.speedLineOpacity ?? (frame.petAttack ? 0.6 : 0)),
  );
  root.style.setProperty('--growth-x', `${petX - enemyX + layout.petSize / 2}px`);
  combatEffects.style.left = `${enemyX}px`;
  combatEffects.style.top = `${enemyY - layout.enemyFrameSize}px`;
  enemySlam.style.left = `${frame.world.enemy.x - frame.camera.x + layout.enemyFrameSize / 2}px`;
  enemySlam.style.top = `${frame.world.enemy.y - frame.camera.y}px`;
  defeatBurst.style.left = `${enemyX + layout.enemyFrameSize / 2}px`;
  defeatBurst.style.top = `${enemyY - base.enemyHeight / 2}px`;
  if (frame.petImpact && !previousPetImpact) triggerEnemyHitReaction();
  previousPetImpact = frame.petImpact;
  if (frame.enemyImpact && !previousEnemyImpact) {
    clearEnemySlam();
    enemySlam.classList.add('active');
    enemySlamTimer = window.setTimeout(clearEnemySlam, 380);
  }
  previousEnemyImpact = frame.enemyImpact;
  // Custom species share the arena clock. Mole uses native pixels; sprout and zebra use stock strips.
  const sproutAttacking = frame.petAnimation.id === 'sprout' && frame.petAnimation.phase !== 'IDLE';
  const zebraAttacking = frame.petAnimation.id === 'zebra' && frame.petAnimation.phase !== 'IDLE';
  const hamsterAttacking =
    frame.petAnimation.id === 'hamster' && frame.petAnimation.phase !== 'IDLE';
  const wizardAttacking = frame.petAnimation.id === 'wizard' && frame.petAnimation.phase !== 'IDLE';
  const squirrelAttacking =
    frame.petAnimation.id === 'squirrel' && frame.petAnimation.phase !== 'IDLE';
  const scene = deriveBattleScene(
    next,
    sproutAttacking ||
      (!customAnimation &&
        ((!suppressedAttackPreview && next.preview.petAction === 'ATTACK') || frame.petAttack)),
  );
  setImageSource(petSheet, assetUrl(scene.petAsset));
  updateSprite(scene.petSprite);
  const walking = frame.petStep !== null && !scene.petSprite.animated;
  petSheet.classList.toggle('walking-sheet', walking);
  // Frame selection follows the same planted/lifted beats as world movement,
  // including the return path. No second CSS clock that keeps walking after STOP.
  petSheet.style.transform = walking
    ? `translateX(${-((frame.petStep ?? 0) % scene.petSprite.frameCount) * layout.petSize}px)`
    : '';
  if (
    sproutAttacking ||
    zebraAttacking ||
    hamsterAttacking ||
    wizardAttacking ||
    squirrelAttacking
  ) {
    petSheet.classList.remove('animated-sheet');
    const decoded =
      petSheet.complete &&
      petSheet.currentSrc === petSheet.src &&
      petSheet.naturalWidth === petSheet.naturalHeight * scene.petSprite.frameCount;
    const spriteFrame =
      zebraAttacking || hamsterAttacking || wizardAttacking || squirrelAttacking
        ? 0
        : decoded
          ? Math.round(frame.petAnimation.spriteProgress * (scene.petSprite.frameCount - 1))
          : 0;
    petSheet.style.transform = `translateX(${-spriteFrame * layout.petSize}px)`;
  }
  const nativeSlap = moleSprite.paint(
    petSheet,
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
  );
  const nativeHoof = zebraSprite.paint(
    petSheet,
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
  );
  moleCanvas.style.opacity = nativeSlap ? '1' : '0';
  zebraCanvas.style.opacity = nativeHoof ? '1' : '0';
  const nativeCheeks = hamsterSprite.paint(
    petSheet,
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
  );
  hamsterCanvas.style.opacity = nativeCheeks ? '1' : '0';
  const nativeWizard = wizardSprite.paint(
    petSheet,
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
  );
  wizardCanvas.style.opacity = nativeWizard ? '1' : '0';
  const nativeSquirrel = squirrelSprite.paint(
    petSheet,
    frame.petAnimation,
    next.activePet?.evolutionStage ?? 0,
  );
  squirrelCanvas.style.opacity = nativeSquirrel ? '1' : '0';
  petViewport.style.visibility =
    nativeSlap || nativeHoof || nativeCheeks || nativeWizard || nativeSquirrel ? 'hidden' : '';
  paintHpBar(hpMotion.frame(hpInput));
}

function paintHpBar(frame: HpBarFrame): void {
  const width = `${frame.fillRatio * 100}%`;
  if (hpFill.style.width !== width) hpFill.style.width = width;
  hpBar.dataset['hpAnimating'] = String(frame.animating);
  hpBar.style.setProperty('--hp-tone', String(frame.surfaceMix));
  hpBar.style.setProperty('--hp-edge-opacity', String(frame.edgeOpacity));
}

function animateArena(): void {
  if (state && !document.hidden) paintArena(state);
  window.requestAnimationFrame(animateArena);
}

function triggerEnemyHitReaction(): void {
  hpMotion.hit(nowMs());
  if (enemyHitTimer !== undefined) window.clearTimeout(enemyHitTimer);
  enemy.classList.remove('hit-reaction');
  void enemy.offsetWidth;
  enemy.classList.add('hit-reaction');
  enemyHitTimer = window.setTimeout(() => {
    enemy.classList.remove('hit-reaction');
    enemyHitTimer = undefined;
  }, 420);
}

function clearEnemyHitReaction(): void {
  if (enemyHitTimer === undefined) return;
  window.clearTimeout(enemyHitTimer);
  enemyHitTimer = undefined;
  enemy.classList.remove('hit-reaction');
}

function clearEnemySlam(): void {
  if (enemySlamTimer === undefined) return;
  window.clearTimeout(enemySlamTimer);
  enemySlamTimer = undefined;
  enemySlam.classList.remove('active');
}

function updateSprite(sprite: ReturnType<typeof deriveBattleScene>['petSprite']): void {
  // While src is pending, Chromium can still paint the previous (shorter) strip.
  // Hold its first frame; never animate six attack frames over four idle frames.
  const animated = sprite.animated && petSheet.complete && petSheet.naturalWidth > 0;
  const key = `${sprite.frameCount}:${sprite.durationMs}:${animated}:${layout.petSize}`;
  if (key === spriteKey) return;
  spriteKey = key;
  petSheet.style.setProperty('--frame-count', String(sprite.frameCount));
  petSheet.style.setProperty('--frame-steps', String(sprite.frameSteps));
  petSheet.style.setProperty('--sheet-shift', `${-(sprite.frameCount - 1) * layout.petSize}px`);
  petSheet.style.setProperty('--sheet-duration', `${sprite.durationMs}ms`);
  petSheet.classList.toggle('animated-sheet', animated);
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
  if (button && button.textContent !== label) button.textContent = label;
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

function commandFor(action: ButtonAction): { command: BattleClientCommand; message: string } {
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
document.addEventListener('visibilitychange', () => {
  if (state) paintArena(state);
});

resizeBattle();
const resizeObserver = new ResizeObserver(resizeBattle);
resizeObserver.observe(root);
window.requestAnimationFrame(animateArena);
void execute({ type: 'GET_STATE', nowMs: nowMs() });
window.setInterval(() => {
  void execute({ type: 'GET_STATE', nowMs: nowMs() });
}, 80);
