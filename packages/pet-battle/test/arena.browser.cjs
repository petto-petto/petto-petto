// Optional semantic check: isolated headless Chrome + HTTP demo, never Electron or user data.
// Build @pet/battle, then: node packages/pet-battle/test/arena.browser.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile, realpath, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const repository = path.resolve(__dirname, '../../..');
const allowedRoot = path.resolve(__dirname, '..');
const sharedPetRoot = path.resolve(repository, 'apps/desktop/renderer/assets/pets');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP connect timeout'));
    }, 5000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        socket.close();
        reject(new Error('CDP connect failed'));
      },
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === 'Runtime.exceptionThrown')
      errors.push(response.params.exceptionDetails.text);
    const call = pending.get(response.id);
    if (!call) return;
    pending.delete(response.id);
    clearTimeout(call.timer);
    if (response.error) call.reject(new Error(JSON.stringify(response.error)));
    else call.resolve(response.result);
  });
  return {
    errors,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('CDP closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}

// Runs inside the actual renderer. Bounds are checked per animation frame, not just at rest.
function sampleArena(durationMs, origin = performance.now()) {
  const started = performance.now();
  const samples = [];
  const alphaCache = new Map();
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const opaqueBounds = (image, sheet = false) => {
    if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return null;
    const frameWidth = sheet ? image.naturalHeight : image.naturalWidth;
    const key = `${image.currentSrc || image.src}:${frameWidth}`;
    if (alphaCache.has(key)) return alphaCache.get(key);
    // This deliberately does not use the production grounding/front-ratio
    // helper. Fold every square idle frame into one conservative silhouette.
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = frameWidth;
    let right = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
        const frameX = x % frameWidth;
        left = Math.min(left, frameX);
        right = Math.max(right, frameX + 1);
      }
    }
    if (right <= left) throw new Error(`No opaque silhouette in ${image.src}`);
    const bounds = { left: left / frameWidth, right: right / frameWidth };
    alphaCache.set(key, bounds);
    return bounds;
  };
  return new Promise((resolve) => {
    function frame() {
      const root = document.querySelector('#battle-overlay');
      const pet = document.querySelector('#pet');
      const enemy = document.querySelector('#enemy');
      const world = document.querySelector('#battle-world');
      const sheet = document.querySelector('#pet-sheet');
      const petViewport = rect(document.querySelector('.pet-viewport'));
      const enemyImage = document.querySelector('#enemy-image');
      const enemyImageRect = rect(enemyImage);
      const petAlpha = opaqueBounds(sheet, true);
      const enemyAlpha = opaqueBounds(enemyImage);
      samples.push({
        at: performance.now() - origin,
        phase: root.dataset.arenaPhase,
        attackTurn: root.dataset.attackTurn ?? '',
        inAttackRange: root.dataset.inAttackRange === 'true',
        retreating: root.dataset.retreating,
        enemyPhase: root.dataset.enemyPhase,
        petAction: root.dataset.petAction,
        petHit: root.dataset.petHit === 'true',
        enemyImpact: root.dataset.enemyImpact === 'true',
        petWalking: root.dataset.petWalking === 'true',
        enemyWalking: root.dataset.enemyWalking === 'true',
        petStep: root.dataset.petStep,
        enemyStep: root.dataset.enemyStep,
        beat: root.dataset.beat,
        pet: rect(pet),
        petViewport,
        enemy: rect(enemy),
        enemyImage: enemyImageRect,
        petSource: sheet.src,
        petAlpha,
        enemyAlpha,
        opaqueGap:
          petAlpha && enemyAlpha
            ? enemyImageRect.x +
              enemyAlpha.left * enemyImageRect.width -
              (petViewport.x + petAlpha.right * petViewport.width)
            : null,
        petPose: pet.style.transform,
        enemyPose: enemy.style.transform,
        // Ground coordinates exclude camera, recoil and footfall lift. They
        // distinguish independently planned paths from a shared screen scroll.
        petWorldX: Number(root.dataset.petWorldX),
        petWorldY: Number(root.dataset.petWorldY),
        enemyWorldX: Number(root.dataset.enemyWorldX),
        enemyWorldY: Number(root.dataset.enemyWorldY),
        sheetTransform: getComputedStyle(sheet).transform,
        sheetAnimation: getComputedStyle(sheet).animationName,
        world: rect(world),
        camera: world.style.transform,
        hpBar: rect(document.querySelector('.enemy-hp')),
        stageLabel: rect(document.querySelector('#stage-label')),
        attackSprite: /attack\.png$/.test(sheet.src),
        slashVisible: [...document.querySelectorAll('.slash')].some(
          (piece) => Number(getComputedStyle(piece).opacity) > 0,
        ),
        enemyHitReaction: enemy.classList.contains('hit-reaction'),
        animatedSprite: sheet.classList.contains('animated-sheet'),
        petSize: parseFloat(getComputedStyle(pet).width),
        enemySlam: [...document.querySelectorAll('.enemy-slam i')].some(
          (piece) => Number(getComputedStyle(piece).opacity) > 0,
        ),
        enemySlamActive: document.querySelector('.enemy-slam').classList.contains('active'),
        hp: document.querySelector('#enemy-hp-label').textContent,
      });
      if (performance.now() - started >= durationMs) resolve(samples);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

function assertContained(samples, width, height) {
  for (const sample of samples) {
    for (const name of ['pet', 'enemy']) {
      const r = sample[name];
      assert.ok(
        r.x >= 0 && r.y >= 0 && r.right <= width && r.bottom <= height,
        `${name} escaped ${width}x${height}: ${JSON.stringify(sample)}`,
      );
    }
    assert.equal(sample.petSize, 96, 'camera must never scale the combat pet frame');
    assert.ok(
      sample.world.x <= 2 &&
        sample.world.y <= 2 &&
        sample.world.right >= width - 2 &&
        sample.world.bottom >= height - 2,
      `background uncovered an edge: ${JSON.stringify(sample.world)}`,
    );
  }
}

function assertCycle(samples, expectedRetreating) {
  const phases = [...new Set(samples.map((sample) => sample.phase))];
  for (const phase of [
    'RETREAT',
    'PET_ATTACK',
    'PET_RECOVER',
    'CROUCH',
    'JUMP',
    'SLAM',
    'RECOVER',
  ]) {
    assert.ok(phases.includes(phase), `missing ${phase}; observed ${phases.join(',')}`);
  }
  assert.ok(
    samples.every((sample) => sample.retreating === expectedRetreating),
    'HP selects the correct retreating character',
  );
  assert.ok(
    samples.some(
      (sample) => sample.phase === 'PET_ATTACK' && sample.attackSprite && sample.animatedSprite,
    ),
    'pet actually plays its attack sprite',
  );
  assert.ok(
    samples.some((sample) => sample.beat === 'IMPACT'),
    'pet attack produces visible impact',
  );
  assert.ok(
    samples.some((sample) => sample.enemyImpact && sample.enemySlam),
    'enemy landing produces ground effect',
  );
  assert.ok(
    samples.some((sample) => sample.petHit),
    'enemy landing produces pet hit reaction',
  );
  assert.ok(new Set(samples.map((sample) => sample.camera)).size > 5, 'camera follows movement');
  const cameraFollow = assertPetCamera(samples, `HP ${samples[0].hp} combat cycle`);
  assert.ok(cameraFollow.walkingMoves > 0, 'camera follows the pet while it walks');
  assert.ok(
    cameraFollow.nonWalkingMoves > 0,
    'delayed camera follow continues after the pet stops walking',
  );
  for (const phase of ['PET_ATTACK', 'PET_RECOVER', 'CROUCH', 'JUMP', 'SLAM']) {
    assert.ok(
      cameraFollow.nonWalkingPhases.includes(phase),
      `${phase} must be sampled independently of pet footsteps`,
    );
  }
  assert.equal(
    new Set(samples.map((sample) => sample.hp)).size,
    1,
    'choreography never changes HP',
  );
  const walking = assertWalking(samples);
  const independentMovement = assertIndependentMovement(samples, expectedRetreating);
  const directedSlam = assertDirectedSlam(samples);
  const attackTurns = assertAttackTurns(samples);
  const phaseDurations = assertWalkAndAttackTiming(samples);
  const closeSlam = assertCloseSlam(samples);
  const minimumBodyGap = assertSeparated(samples, 'automatic attack and slam');
  return {
    phases,
    frames: samples.length,
    retreating: expectedRetreating,
    hp: samples[0].hp,
    cameraFollow,
    walking,
    independentMovement,
    directedSlam,
    attackTurns,
    phaseDurations,
    closeSlam,
    minimumBodyGap,
  };
}

function assertWalkAndAttackTiming(samples) {
  const expected = {
    PET_ATTACK: 550,
    PET_RECOVER: 200,
    CROUCH: 100,
    JUMP: 450,
    SLAM: 250,
  };
  const observed = [];
  let phase = samples[0].phase;
  let enteredAt;
  for (const sample of samples.slice(1)) {
    if (sample.phase === phase) continue;
    // The first/final segment may be clipped by the observation window. Only
    // measure phases whose entry and exit were both observed, rather than
    // treating sampling startup as the beginning of a character's movement.
    if (enteredAt !== undefined && phase in expected) {
      const durationMs = sample.at - enteredAt;
      assert.ok(
        Math.abs(durationMs - expected[phase]) <= 90,
        `${phase} duration must remain ${expected[phase]}ms: observed ${durationMs}ms`,
      );
      observed.push({ phase, durationMs });
    }
    phase = sample.phase;
    enteredAt = sample.at;
  }
  assert.ok(
    observed.some((segment) => ['PET_ATTACK', 'JUMP'].includes(segment.phase)),
    'observe at least one complete unchanged attack segment',
  );
  return observed;
}

function assertAttackTurns(samples) {
  const turnFrames = { PET: 0, ENEMY: 0, waiting: 0 };
  let petRecoveryFrames = 0;
  for (const sample of samples) {
    const label = `${sample.phase} at ${sample.at}ms`;
    assert.ok(['', 'PET', 'ENEMY'].includes(sample.attackTurn), `${label}: invalid attack owner`);
    if (['PET_ATTACK', 'PET_RECOVER'].includes(sample.phase)) {
      assert.equal(sample.attackTurn, 'PET', `${label}: pet owns its attack and recovery`);
    } else if (['CROUCH', 'JUMP', 'SLAM'].includes(sample.phase)) {
      assert.equal(sample.attackTurn, 'ENEMY', `${label}: enemy owns its windup and slam`);
    } else if (['RETREAT', 'CHASE', 'IDLE'].includes(sample.phase)) {
      assert.equal(sample.attackTurn, '', `${label}: approaching characters cannot attack`);
    }
    if (sample.attackTurn !== '') {
      turnFrames[sample.attackTurn]++;
      assert.equal(sample.inAttackRange, true, `${label}: attack requires ground contact range`);
      assert.equal(sample.petWalking, false, `${label}: pet must finish walking before attack`);
      assert.equal(sample.enemyWalking, false, `${label}: enemy must finish walking before attack`);
    } else {
      turnFrames.waiting++;
    }
    if (sample.attackTurn === 'ENEMY') {
      assert.equal(sample.attackSprite, false, `${label}: pet cannot swing during enemy's turn`);
      assert.equal(sample.slashVisible, false, `${label}: no pet slash during enemy's turn`);
      assert.equal(
        sample.enemyHitReaction,
        false,
        `${label}: enemy's old hit reaction must finish before its attack`,
      );
    }
    if (sample.attackTurn === 'PET') {
      assert.equal(sample.enemySlam, false, `${label}: no enemy dust during pet's turn`);
      assert.equal(
        sample.enemySlamActive,
        false,
        `${label}: no stale enemy slam during pet's turn`,
      );
    }
    if (sample.attackSprite || sample.slashVisible || sample.beat === 'IMPACT') {
      assert.equal(
        sample.attackTurn,
        'PET',
        `${label}: visible pet attacks need exclusive ownership`,
      );
    }
    if (sample.enemyImpact || sample.petHit || sample.enemySlamActive) {
      assert.equal(
        sample.attackTurn,
        'ENEMY',
        `${label}: visible enemy attacks need exclusive ownership`,
      );
    }
    if (sample.phase === 'PET_RECOVER') petRecoveryFrames++;
  }
  assert.ok(turnFrames.PET > 1, 'pet must receive a complete attack turn');
  assert.ok(turnFrames.ENEMY > 1, 'enemy must receive a separate attack turn');
  assert.ok(petRecoveryFrames > 1, 'pet recovery must finish before the enemy starts attacking');
  return { ...turnFrames, petRecoveryFrames };
}

function assertIndependentMovement(samples, expectedRetreating) {
  const leader = expectedRetreating === 'PET' ? 'pet' : 'enemy';
  const follower = leader === 'pet' ? 'enemy' : 'pet';
  const direction = expectedRetreating === 'PET' ? -1 : 1;
  const walkingFrames = { pet: 0, enemy: 0, concurrent: 0, unequalVelocity: 0 };
  const speedSamples = { pet: [], enemy: [] };
  const trajectories = { pet: [], enemy: [] };
  for (const [index, sample] of samples.entries()) {
    for (const actor of ['pet', 'enemy'])
      for (const axis of ['X', 'Y'])
        assert.ok(Number.isFinite(sample[`${actor}World${axis}`]), 'finite ground telemetry');
    if (sample.petWalking && sample.enemyWalking) walkingFrames.concurrent++;
    const previous = samples[index - 1];
    for (const actor of ['pet', 'enemy']) {
      if (previous) {
        const elapsed = sample.at - previous.at;
        const distance = Math.hypot(
          sample[`${actor}WorldX`] - previous[`${actor}WorldX`],
          sample[`${actor}WorldY`] - previous[`${actor}WorldY`],
        );
        assert.ok(
          distance <= 12 + Math.max(0, elapsed) * 0.15,
          `${actor} teleported between ${previous.phase} and ${sample.phase}: ${distance}px in ${elapsed}ms`,
        );
      }
      if (sample[`${actor}Walking`]) {
        walkingFrames[actor]++;
        trajectories[actor].push({ x: sample[`${actor}WorldX`], y: sample[`${actor}WorldY`] });
      }
      // Attack recoil is allowed; walking never resets both actors back home.
      if (
        !previous ||
        !sample[`${actor}Walking`] ||
        !previous[`${actor}Walking`] ||
        sample.attackTurn !== '' ||
        previous.attackTurn !== ''
      )
        continue;
      const dx = sample[`${actor}WorldX`] - previous[`${actor}WorldX`];
      const dy = sample[`${actor}WorldY`] - previous[`${actor}WorldY`];
      assert.ok(
        dx * direction >= -1 / 64,
        `${actor} walked in the wrong direction or reset home at HP ${sample.hp}: ${dx}px`,
      );
      const delta = sample.at - previous.at;
      if (delta > 0) speedSamples[actor].push((Math.hypot(dx, dy) * 1000) / delta);
    }
    if (
      previous &&
      sample.petWalking &&
      previous.petWalking &&
      sample.enemyWalking &&
      previous.enemyWalking
    ) {
      const petDistance = Math.hypot(
        sample.petWorldX - previous.petWorldX,
        sample.petWorldY - previous.petWorldY,
      );
      const enemyDistance = Math.hypot(
        sample.enemyWorldX - previous.enemyWorldX,
        sample.enemyWorldY - previous.enemyWorldY,
      );
      if (Math.abs(petDistance - enemyDistance) > 0.01) walkingFrames.unequalVelocity++;
    }
  }
  assert.ok(walkingFrames.pet > 1 && walkingFrames.enemy > 1, 'both actors visibly move');
  assert.ok(walkingFrames.concurrent > 1, 'follower starts before the retreating actor finishes');
  assert.ok(walkingFrames.unequalVelocity > 1, 'actors have different independent velocities');
  const curvature = {};
  for (const actor of ['pet', 'enemy']) {
    const points = trajectories[actor];
    const first = points[0];
    const last = points.at(-1);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.hypot(dx, dy);
    curvature[actor] = Math.max(
      ...points.map((point) =>
        length === 0 ? 0 : Math.abs(dy * (point.x - first.x) - dx * (point.y - first.y)) / length,
      ),
    );
    if (samples[0].world.height > 300) {
      assert.ok(
        curvature[actor] > 0.1,
        `${actor} ground path cannot be a fixed straight/diagonal line`,
      );
    }
  }
  const medianSpeed = Object.fromEntries(
    Object.entries(speedSamples).map(([actor, speeds]) => {
      const sorted = speeds.toSorted((a, b) => a - b);
      return [actor, sorted[Math.floor(sorted.length / 2)]];
    }),
  );
  return { leader, follower, walkingFrames, curvature, medianSpeed };
}

function assertDirectedSlam(samples) {
  const launchIndex = samples.findIndex(
    (sample, index) => sample.phase === 'JUMP' && samples[index - 1]?.phase === 'CROUCH',
  );
  assert.ok(launchIndex >= 0, 'a complete enemy launch must be observed');
  const impactIndex = samples.findIndex(
    (sample, index) => index > launchIndex && sample.phase === 'SLAM',
  );
  assert.ok(impactIndex > launchIndex, 'the observed enemy launch must reach the pet');
  const launch = samples[launchIndex];
  const impact = samples[impactIndex];
  const initialDistance = Math.abs(launch.enemyWorldX - launch.petWorldX);
  const impactDistance = Math.abs(impact.enemyWorldX - impact.petWorldX);
  assert.ok(
    impactDistance < initialDistance - 1,
    `enemy must jump toward the pet, not slam in place: ${initialDistance}px -> ${impactDistance}px`,
  );
  for (const sample of samples.slice(launchIndex, impactIndex + 1)) {
    assert.ok(
      Math.abs(sample.petWorldX - launch.petWorldX) < 0.001,
      `enemy approach must not displace the waiting pet: ${launch.petWorldX} -> ${sample.petWorldX}`,
    );
  }
  return { initialDistance, impactDistance, approach: initialDistance - impactDistance };
}

function assertPetCamera(samples, label) {
  let walkingMoves = 0;
  let nonWalkingMoves = 0;
  const nonWalkingPhases = new Set();
  const movingPhases = new Set();
  const first = samples[0];
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    for (const hud of ['hpBar', 'stageLabel']) {
      for (const field of ['x', 'y', 'width', 'height']) {
        assert.ok(
          Math.abs(current[hud][field] - first[hud][field]) < 0.01,
          `${label}: ${hud}.${field} must remain outside the moving camera plane`,
        );
      }
    }
    if (current.petWalking) {
      if (current.camera !== previous.camera) walkingMoves++;
      continue;
    }
    if (previous.petWalking) continue;
    nonWalkingPhases.add(current.phase);
    if (current.camera !== previous.camera) {
      nonWalkingMoves++;
      movingPhases.add(current.phase);
    }
  }
  return {
    walkingMoves,
    nonWalkingMoves,
    nonWalkingPhases: [...nonWalkingPhases],
    movingPhases: [...movingPhases],
  };
}

function assertWalking(samples) {
  const evidence = {};
  for (const actor of ['pet', 'enemy']) {
    const walking = samples.filter((sample) => sample[`${actor}Walking`]);
    assert.ok(walking.length > 1, `${actor} must visibly step while retreating/following`);
    const steps = new Set(walking.map((sample) => sample[`${actor}Step`]));
    assert.ok(
      [...steps].every((step) => typeof step === 'string' && /^\d+$/.test(step)),
      `${actor} exposes a concrete footfall phase while walking`,
    );
    assert.ok(steps.size > 1, `${actor} footfalls must advance during movement`);
    assert.ok(
      new Set(walking.map((sample) => sample[`${actor}Pose`])).size > 1,
      `${actor} must change its visible stance instead of sliding during movement`,
    );
    if (actor === 'pet') {
      assert.ok(
        walking.every((sample) => !sample.attackSprite && !sample.animatedSprite),
        'walking must not play the attack sheet',
      );
      assert.ok(
        walking.every((sample) => sample.sheetAnimation === 'none'),
        'walking frames follow footfalls, not an unrelated CSS animation timer',
      );
      assert.ok(
        new Set(walking.map((sample) => sample.sheetTransform)).size > 1,
        'pet sprite frames must advance with footfalls',
      );
    }
    evidence[actor] = { frames: walking.length, steps: [...steps] };
  }
  return evidence;
}

function assertSeparated(samples, label, manual = false) {
  const contact = samples.filter(
    (sample) =>
      sample.enemyPhase === 'VISIBLE' &&
      (manual
        ? sample.petAction === 'ATTACK'
        : sample.phase === 'PET_ATTACK' ||
          sample.attackTurn === 'ENEMY' ||
          sample.phase === 'RECOVER'),
  );
  assert.ok(contact.length > 0, `${label}: no contact frames were observed`);
  let minimumGap = Infinity;
  for (const sample of contact) {
    // Keep the existing conservative envelope for pet attacks. Enemy landings
    // may enter transparent sprite padding, but never the actual opaque body.
    // DOM rectangles include each actor's squash/recoil scale before projection.
    const useOpaqueBody = !manual && (sample.attackTurn === 'ENEMY' || sample.phase === 'RECOVER');
    if (useOpaqueBody) {
      assert.equal(sample.attackSprite, false, 'enemy approach/recovery samples the idle sheet');
      assert.notEqual(sample.opaqueGap, null, 'loaded alpha bounds are required for enemy contact');
    }
    const gap = useOpaqueBody ? sample.opaqueGap : sample.enemyImage.x - sample.petViewport.right;
    minimumGap = Math.min(minimumGap, gap);
    assert.ok(gap >= 0, `${label}: bodies overlap by ${-gap}px: ${JSON.stringify(sample)}`);
  }
  return minimumGap;
}

function assertCloseSlam(samples) {
  const impacts = samples.filter((sample) => sample.enemyImpact);
  assert.ok(impacts.length > 0, 'observe an actual landing, not only the airborne approach');
  for (const sample of impacts) {
    assert.equal(sample.attackSprite, false, 'landing uses the real idle-pet silhouette');
    assert.notEqual(sample.opaqueGap, null, 'independent alpha measurements must be available');
    assert.ok(
      sample.opaqueGap >= 3.5 && sample.opaqueGap <= 10.5,
      `enemy must land just in front of opaque pet pixels (about 4–10px), not its transparent frame: ${JSON.stringify(sample)}`,
    );
    assert.equal(sample.petWalking, false, 'the enemy approaches without dragging the pet');
    assert.equal(sample.petSize, 96, 'close landing must not resize the pet frame');
  }
  return {
    frames: impacts.length,
    minimumOpaqueGap: Math.min(...impacts.map((sample) => sample.opaqueGap)),
    maximumOpaqueGap: Math.max(...impacts.map((sample) => sample.opaqueGap)),
    petSource: impacts[0].petSource,
    petOpaqueFront: impacts[0].petAlpha.right,
  };
}

function assertFrozen(samples, label, expectCameraCatchUp = false) {
  const stable = samples.slice(Math.min(3, samples.length - 1));
  const first = stable[0];
  const camera = assertPetCamera(stable, label);
  for (const sample of stable) {
    assert.equal(sample.phase, 'IDLE', `${label} stops automatic choreography`);
    assert.equal(sample.attackTurn, '', `${label} cancels attack ownership`);
    assert.equal(sample.petHit, false);
    assert.equal(sample.enemyImpact, false);
    assert.equal(sample.animatedSprite, false);
    assert.equal(sample.sheetAnimation, 'none', `${label} stops sprite frame animation`);
    for (const actor of ['pet', 'enemy']) {
      assert.equal(sample[`${actor}Walking`], false, `${label} stops ${actor} footfalls`);
      assert.equal(sample[`${actor}Step`], '', `${label} resets ${actor} footfall phase`);
      for (const axis of ['X', 'Y']) {
        const field = `${actor}World${axis}`;
        assert.ok(
          Math.abs(sample[field] - first[field]) < 0.001,
          `${label}: ${field} kept moving: ${first[field]} -> ${sample[field]} at ${sample.at}ms`,
        );
      }
      for (const field of ['x', 'y']) {
        const actorShift = sample[actor][field] - first[actor][field];
        const backgroundShift = sample.world[field] - first.world[field];
        assert.ok(
          Math.abs(actorShift - backgroundShift) < 0.03,
          `${label}: stopped ${actor} and background must share camera movement (${actorShift} vs ${backgroundShift}px)`,
        );
      }
    }
    assert.equal(sample.sheetTransform, first.sheetTransform, `${label} freezes idle sprite`);
  }
  if (expectCameraCatchUp) {
    assert.ok(
      camera.nonWalkingMoves > 5,
      `${label}: camera must finish delayed follow while paused`,
    );
    const tail = stable.filter((sample) => sample.at >= stable.at(-1).at - 200);
    const settledTravel = Math.hypot(
      tail.at(-1).world.x - tail[0].world.x,
      tail.at(-1).world.y - tail[0].world.y,
    );
    assert.ok(
      settledTravel < 1,
      `${label}: camera should settle onto the stopped pet, ${settledTravel}px`,
    );
  }
  return camera;
}

// Keep authoritative HP and fixed bar geometry separate from decorative inner motion.
function sampleHpBar(durationMs) {
  const started = performance.now();
  const samples = [];
  return new Promise((resolve) => {
    function frame() {
      const bar = document.querySelector('.enemy-hp');
      const fill = document.querySelector('#enemy-hp-fill');
      const label = document.querySelector('#enemy-hp-label');
      const track = document.querySelector('.enemy-hp-track');
      const style = getComputedStyle(bar);
      const fillStyle = getComputedStyle(fill);
      const surface = getComputedStyle(fill, '::before');
      const edge = getComputedStyle(fill, '::after');
      const transform = new DOMMatrixReadOnly(
        style.transform === 'none' ? undefined : style.transform,
      );
      const surfaceTransform = new DOMMatrixReadOnly(
        surface.transform === 'none' ? undefined : surface.transform,
      );
      const fillTransform = new DOMMatrixReadOnly(
        fillStyle.transform === 'none' ? undefined : fillStyle.transform,
      );
      const edgeTransform = new DOMMatrixReadOnly(
        edge.transform === 'none' ? undefined : edge.transform,
      );
      const rect = (element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      samples.push({
        at: performance.now() - started,
        fill: parseFloat(fill.style.width),
        label: label.textContent,
        actualHp: window.__hpState?.enemyHpRatio,
        animating: bar.dataset.hpAnimating === 'true',
        tone: parseFloat(style.getPropertyValue('--hp-tone')) || 0,
        edgeSignal: parseFloat(style.getPropertyValue('--hp-edge-opacity')) || 0,
        barShiftX: transform.m41,
        barShiftY: transform.m42,
        barRect: rect(bar),
        trackRect: rect(track),
        labelRect: rect(label),
        fillRect: rect(fill),
        fillOverflow: fillStyle.overflow,
        fillShiftX: fillTransform.m41,
        fillShiftY: fillTransform.m42,
        fillBackground: fillStyle.backgroundImage,
        surfaceShiftX: surfaceTransform.m41,
        surfaceShiftY: surfaceTransform.m42,
        surfaceBackground: surface.backgroundImage,
        surfaceOpacity: Number(surface.opacity),
        surfacePosition: surface.backgroundPosition,
        edgeRight: parseFloat(edge.right),
        edgeWidth: parseFloat(edge.width),
        edgeOpacity: Number(edge.opacity),
        edgeBackground: `${edge.backgroundImage} ${edge.backgroundColor}`,
        edgePattern:
          edge.clipPath !== 'none' ||
          edge.maskImage !== 'none' ||
          edge.backgroundImage.includes('repeating'),
        edgeShiftX: edgeTransform.m41,
        edgeShiftY: edgeTransform.m42,
        edgeShadow: edge.boxShadow,
        edgeFilter: edge.filter,
      });
      if (performance.now() - started >= durationMs) resolve(samples);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

function assertHpSettled(sample, percent, label) {
  assert.ok(Math.abs(sample.fill - percent) < 0.02, `${label}: fill restores to ${percent}%`);
  assert.equal(sample.animating, false, `${label}: HP animation finishes`);
  assert.equal(sample.tone, 0, `${label}: green tone returns to its quiet base`);
  assert.equal(sample.edgeSignal, 0, `${label}: endpoint chip settles`);
  assert.equal(sample.barShiftX, 0, `${label}: whole HP bar stops moving horizontally`);
  assert.equal(sample.barShiftY, 0, `${label}: whole HP bar stops moving vertically`);
  assert.equal(sample.surfaceShiftX, 0, `${label}: inner surface settles horizontally`);
  assert.equal(sample.surfaceShiftY, 0, `${label}: inner surface settles vertically`);
  assert.equal(sample.fillShiftX, 0, `${label}: green fill never moves horizontally`);
  assert.equal(sample.fillShiftY, 0, `${label}: green fill never moves vertically`);
  assert.equal(sample.edgeOpacity, 0, `${label}: tiny endpoint chips disappear`);
}

function assertHpQuiet(samples, percent, label, continuous = false) {
  assert.ok(
    samples.every((sample) => sample.label === `${percent}%`),
    `${label}: label stays actual`,
  );
  assert.ok(
    samples.every((sample) => Math.abs(sample.actualHp * 100 - percent) < 0.001),
    `${label}: visual tone never mutates real HP`,
  );
  assert.ok(
    samples.some((sample) => sample.animating),
    `${label}: quiet visual feedback starts`,
  );
  assert.ok(
    samples.every((sample) => Math.abs(sample.fill - percent) < 0.02),
    `${label}: fill length stays at actual HP instead of faking damage and refilling`,
  );
  const first = samples[0];
  for (const sample of samples) {
    assert.equal(sample.barShiftX, 0, `${label}: outer bar never shakes horizontally`);
    assert.equal(sample.barShiftY, 0, `${label}: outer bar never shakes vertically`);
    for (const part of ['barRect', 'trackRect', 'labelRect', 'fillRect']) {
      for (const field of ['x', 'y', 'width', 'height']) {
        assert.ok(
          Math.abs(sample[part][field] - first[part][field]) < 0.02,
          `${label}: ${part}.${field} stays fixed while only color density changes`,
        );
      }
    }
    assert.equal(sample.fillOverflow, 'hidden', `${label}: chips stay clipped inside true HP`);
    for (const part of ['fill', 'surface', 'edge']) {
      assert.equal(sample[`${part}ShiftX`], 0, `${label}: ${part} never shifts horizontally`);
      assert.equal(sample[`${part}ShiftY`], 0, `${label}: ${part} never shifts vertically`);
    }
    assert.equal(
      sample.surfacePosition,
      first.surfacePosition,
      `${label}: gradient does not scroll`,
    );
    assert.ok(sample.tone >= 0 && sample.tone <= 1, `${label}: bounded green tone`);
    assert.ok(
      sample.edgeOpacity >= 0 && sample.edgeOpacity <= 0.281,
      `${label}: tiny chip never becomes a bright flash`,
    );
    assert.ok(
      sample.edgeSignal >= 0 && sample.edgeSignal <= 0.281,
      `${label}: bounded chip signal`,
    );
    assert.equal(
      sample.edgeRight,
      0,
      `${label}: tiny chips remain at the current filled right edge`,
    );
    assert.ok(
      sample.edgeWidth > 0 &&
        sample.edgeWidth <= 2.01 &&
        sample.edgeWidth <= sample.fillRect.width * 0.25 + 0.02,
      `${label}: chips occupy at most two pixels and one quarter of a narrow HP fill`,
    );
    assert.ok(sample.edgePattern, `${label}: endpoint is sparse pixel chips, not a flat stripe`);
    assert.equal(sample.edgeShadow, 'none', `${label}: chip has no spreading glow`);
    assert.equal(sample.edgeFilter, 'none', `${label}: chip has no blur or glow filter`);
    const greenColors = [
      ...`${sample.fillBackground} ${sample.surfaceBackground}`.matchAll(
        /rgba?\((\d+), (\d+), (\d+)/g,
      ),
    ];
    assert.ok(greenColors.length >= 2, `${label}: actual green gradients exist`);
    for (const [, r, g, b] of greenColors) {
      assert.ok(
        Number(g) >= Number(r) && Number(g) >= Number(b),
        `${label}: density animation stays green`,
      );
    }
    const chipColors = [...sample.edgeBackground.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)];
    assert.ok(chipColors.length > 0, `${label}: dark chips are painted`);
    for (const color of chipColors) {
      assert.ok(
        color.slice(1).every((channel) => Number(channel) <= 100),
        `${label}: no yellow/red or bright endpoint band`,
      );
    }
  }
  assert.ok(
    samples.some((sample) => sample.edgeOpacity > 0.01),
    `${label}: subtle chips are visible without changing fill length`,
  );
  let tonePeriods = [];
  if (continuous) {
    const tones = samples.map((sample) => sample.tone);
    assert.ok(
      Math.min(...tones) < 0.03 && Math.max(...tones) > 0.97,
      `${label}: gradient completes a light-dark-light cycle`,
    );
    assert.ok(
      new Set(samples.map((sample) => sample.surfaceOpacity)).size > 40,
      `${label}: visible gradient density changes smoothly`,
    );
    const crossings = [];
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1];
      const current = samples[index];
      if (previous.tone < 0.5 && current.tone >= 0.5) crossings.push(current.at);
      assert.ok(
        Math.abs(current.tone - previous.tone) <=
          (Math.PI * (current.at - previous.at)) / 3600 + 0.025,
        `${label}: attacks cannot reset the quiet color phase`,
      );
    }
    tonePeriods = crossings.slice(1).map((time, index) => time - crossings[index]);
    assert.ok(
      tonePeriods.length > 0 && tonePeriods.every((period) => period >= 3400 && period <= 3800),
      `${label}: color cycle stays around 3.6s instead of fast flashing: ${tonePeriods}`,
    );
  } else {
    assertHpSettled(samples.at(-1), percent, label);
  }
  return {
    frames: samples.length,
    fill: samples.at(-1).fill,
    continuous,
    fixedOuterBar: true,
    edgeWidth: first.edgeWidth,
    maximumEdgeOpacity: Math.max(...samples.map((sample) => sample.edgeOpacity)),
    tonePeriods,
  };
}

function assertContinuousHpDrop(samples, percent, label) {
  assert.ok(
    samples.every((frame) => frame.label === `${percent}%`),
    `${label}: number immediately shows authoritative HP`,
  );
  assert.ok(
    samples.every((frame) => Math.abs(frame.actualHp * 100 - percent) < 0.001),
    `${label}: presentation never changes authoritative HP`,
  );
  const moving = samples.filter((frame) => frame.fill > percent + 0.02);
  const distinct = new Set(moving.map((frame) => frame.fill.toFixed(4)));
  assert.ok(
    distinct.size > 8,
    `${label}: continuous fill interpolation, not five discrete steps (${distinct.size} values)`,
  );
  for (const [index, frame] of samples.entries()) {
    assert.ok(frame.fill >= percent - 0.02 && frame.fill <= 100.02, `${label}: no overshoot`);
    if (index > 0)
      assert.ok(
        frame.fill <= samples[index - 1].fill + 0.02,
        `${label}: displayed HP never refills during damage`,
      );
    assert.equal(frame.barShiftY, 0);
    assert.equal(frame.fillShiftY, 0);
    assert.equal(frame.surfaceShiftY, 0);
  }
  assertHpSettled(samples.at(-1), percent, label);
  return {
    frames: samples.length,
    uniqueIntermediateWidths: distinct.size,
    finalFill: samples.at(-1).fill,
  };
}

async function checkHpMotion(cdp, evaluate, waitFor, click, menu, screenshot) {
  // Real demo command handling exercises HIT/STOP/opacity; only authoritative
  // HP is overridden so a server-side drop can be observed without a database.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      const ready = import('/packages/pet-battle/dist/testing/demo-gateway.js').then(({ DemoBattleGateway }) => new DemoBattleGateway());
      window.__hpFixture = { enemyHpRatio: 1 };
      window.petBattle = { execute: async (command) => {
        const gateway = await ready;
        const result = await gateway.execute(command);
        result.state.enemyHpRatio = window.__hpFixture.enemyHpRatio;
        if (window.__hpFixture.activeStage !== undefined)
          result.state.activePet.stage = window.__hpFixture.activeStage;
        if (window.__hpFixture.overlay !== undefined)
          result.state.overlay = structuredClone(window.__hpFixture.overlay);
        if (window.__hpFixture.petSprites !== undefined)
          result.state.petSprites = structuredClone(window.__hpFixture.petSprites);
        if (window.__hpFixture.evolutionStage !== undefined)
          result.state.activePet.evolutionStage = window.__hpFixture.evolutionStage;
        window.__hpState = structuredClone(result.state);
        return result;
      } };
    })();`,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 420,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.reload');
  await waitFor(
    "Boolean(window.__hpState && document.querySelector('#battle-overlay')?.dataset.arenaPhase)",
    'HP motion fixture',
  );
  assert.equal(
    await evaluate("Boolean(document.querySelector('#enemy-hp-trail'))"),
    false,
    'HP bar has no bright delayed trail',
  );
  const sample = (ms) => evaluate(`(${sampleHpBar})(${ms})`);
  const hpAnimating = "document.querySelector('.enemy-hp').dataset.hpAnimating === 'true'";
  await waitFor(hpAnimating, 'running battle starts quiet green density changes', 10000);
  const automatic = assertHpQuiet(await sample(7300), 100, 'running battle', true);
  const captureHpFrame = async (name) => {
    await evaluate(`(() => {
      window.__hpRealNow = Date.now;
      const capturedAt = Date.now();
      Date.now = () => capturedAt;
    })()`);
    try {
      return await screenshot(name);
    } finally {
      await evaluate('Date.now = window.__hpRealNow; delete window.__hpRealNow');
    }
  };
  const toneScreenshots = [];
  for (const [name, condition] of [
    ['hp-green-tone-deep', '> 0.97'],
    ['hp-green-tone-light', '< 0.03'],
  ]) {
    await waitFor(
      `Number(getComputedStyle(document.querySelector('.enemy-hp')).getPropertyValue('--hp-tone')) ${condition}`,
      'natural green gradient extremum for visual comparison',
    );
    toneScreenshots.push(await captureHpFrame(name));
  }

  await menu('pet', true);
  await click('[data-action="STOP"]');
  await menu('pet', false);
  await menu('enemy', true);
  await click('[data-action="HIT"]');
  await waitFor(
    `document.querySelector('#battle-overlay').dataset.enemyPhase === 'HIT' && ${hpAnimating}`,
    'manual HIT starts HP pulse while paused with menu open',
  );
  const manual = assertHpQuiet(await sample(850), 100, 'manual paused HIT');
  assert.equal(await evaluate('window.__hpState.activePet.battleMode'), 'PAUSED');
  assert.equal(await evaluate("document.querySelector('#enemy-menu').hidden"), false);

  await menu('enemy', false);
  await menu('pet', true);
  await click('[data-action="ATTACK"]');
  await waitFor(
    `document.querySelector('#battle-overlay').dataset.petAction === 'ATTACK' && ${hpAnimating}`,
    'paused manual attack starts subtle endpoint feedback with pet menu open',
  );
  assert.equal(await evaluate('window.__hpState.activePet.battleMode'), 'PAUSED');
  assert.equal(await evaluate('window.__hpState.preview.menu'), 'PET');
  await click('[data-action="STOP"]');
  await waitFor(
    `document.querySelector('#battle-overlay').dataset.petAction === 'IDLE' && !(${hpAnimating})`,
    'STOP explicitly cancels manual feedback even when already paused with the same menu',
    250,
  );
  for (const frame of await sample(300)) assertHpSettled(frame, 100, 'already-paused STOP');
  assert.equal(await evaluate('window.__hpState.preview.menu'), 'PET');
  await menu('pet', false);
  await menu('enemy', true);

  await evaluate('window.__hpFixture.enemyHpRatio = 0.6');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '60%'",
    'actual HP drop updates its number immediately',
  );
  const actualDrop = assertContinuousHpDrop(await sample(950), 60, 'actual HP drop');

  await click('[data-action="HIT"]');
  await waitFor(hpAnimating, 'manual HIT at 60% starts tiny dark chips');
  const partial = assertHpQuiet(await sample(850), 60, '60% current endpoint');
  await click('[data-action="HIT"]');
  await waitFor(
    "Number(getComputedStyle(document.querySelector('#enemy-hp-fill'), '::after').opacity) > 0.15",
    '60% tiny endpoint chips are visible before capture',
  );
  // Freeze an actual rendered feedback frame while Chrome captures it; do not
  // force CSS values or let the quiet pixel pulse expire during capture.
  const endpointScreenshot = await captureHpFrame('hp-quiet-endpoint-60-percent');

  // Use actual shared evolution assets with unchanged owned pet/stage identity.
  // Predecode both idle sheets so this probes presentation identity, not IO delay.
  const evolutionSprites = [];
  for (const stage of [1, 2]) {
    const sprites = {};
    for (const action of ['idle', 'attack']) {
      const file = path.join(
        sharedPetRoot,
        `common/mole_digger/stage${stage}/pet_003_s${stage}_${action}`,
      );
      const metadata = JSON.parse(await readFile(`${file}.json`, 'utf8'));
      sprites[action] = {
        asset: `/${path.relative(repository, `${file}.png`).split(path.sep).join('/')}`,
        frameCount: metadata.frameCount,
      };
    }
    evolutionSprites.push(sprites);
  }
  await evaluate(`Promise.all(${JSON.stringify(evolutionSprites.map((sprites) => sprites.idle.asset))}.map(source => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(true); image.onerror = () => reject(new Error('Evolution fixture asset missing')); image.src = source;
  })))`);
  await evaluate(`(() => {
    const fixture = window.__hpFixture;
    fixture.evolutionStage = 0;
    fixture.petSprites = { [window.__hpState.activePet.petId]: ${JSON.stringify(evolutionSprites[0])} };
  })()`);
  await waitFor(
    "document.querySelector('#pet-sheet').currentSrc.endsWith('pet_003_s1_idle.png')",
    'shared pre-evolution idle is active',
  );
  const evolutionIdentity = await evaluate(
    '({ petId: window.__hpState.activePet.petId, stage: window.__hpState.activePet.stage })',
  );
  await evaluate('window.__hpFixture.enemyHpRatio = 0.2');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '20%'",
    'actual drop starts before evolution image swap',
  );
  const beforeEvolution = await sample(180);
  await evaluate(`(() => {
    const fixture = window.__hpFixture;
    fixture.evolutionStage = 1;
    fixture.petSprites = { [window.__hpState.activePet.petId]: ${JSON.stringify(evolutionSprites[1])} };
  })()`);
  await waitFor(
    "document.querySelector('#pet-sheet').currentSrc.endsWith('pet_003_s2_idle.png') && window.__hpState.activePet.evolutionStage === 1",
    'shared evolution idle replaces only visual asset',
  );
  const evolutionFrames = await sample(950);
  assert.ok(
    evolutionFrames[0].fill > 20.05,
    'evolution asset swap must not prematurely snap the in-flight damage to its target',
  );
  assert.ok(
    evolutionFrames[0].fill <= beforeEvolution.at(-1).fill + 0.02,
    'evolution asset swap must not restart damage from a larger HP width',
  );
  assert.deepEqual(
    await evaluate(
      '({ petId: window.__hpState.activePet.petId, stage: window.__hpState.activePet.stage })',
    ),
    evolutionIdentity,
    'evolution keeps the battle identity',
  );
  const evolution = assertContinuousHpDrop(evolutionFrames, 20, 'same-pet evolution asset swap');
  await evaluate('window.__hpFixture.enemyHpRatio = 0.6');
  await waitFor(
    `document.querySelector('#enemy-hp-label').textContent === '60%' && !(${hpAnimating})`,
    'restore authoritative HP after evolution fixture',
  );

  await evaluate('window.__hpFixture.enemyHpRatio = 0.02');
  await waitFor(
    `document.querySelector('#enemy-hp-label').textContent === '2%' && !(${hpAnimating})`,
    'narrow real HP settles before endpoint feedback',
  );
  await click('[data-action="HIT"]');
  await waitFor(hpAnimating, 'manual HIT at 2% starts tiny endpoint chips');
  const narrow = assertHpQuiet(await sample(850), 2, '2% current endpoint');
  await evaluate('window.__hpFixture.enemyHpRatio = 0.6');
  await waitFor(
    `document.querySelector('#enemy-hp-label').textContent === '60%' && !(${hpAnimating})`,
    'restore real HP for opacity and STOP checks',
  );

  await evaluate('window.__hpFixture.enemyHpRatio = 0.4');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '40%'",
    'first actual target before retarget',
  );
  const beforeRetarget = await sample(180);
  await evaluate('window.__hpFixture.enemyHpRatio = 0.2');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '20%'",
    'next actual target while fill is draining',
  );
  const retargetFrames = await sample(950);
  assert.ok(
    retargetFrames[0].fill <= beforeRetarget.at(-1).fill + 0.02,
    'retarget resumes from current display without jumping back up',
  );
  const retarget = assertContinuousHpDrop(retargetFrames, 20, 'continuous retarget');
  await evaluate('window.__hpFixture.enemyHpRatio = 0');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '0%'",
    'authoritative zero HP updates immediately',
  );
  const zero = assertContinuousHpDrop(await sample(950), 0, 'same-enemy actual zero');
  await evaluate('window.__hpFixture.enemyHpRatio = 0.2');
  await waitFor(
    `document.querySelector('#enemy-hp-label').textContent === '20%' && !(${hpAnimating})`,
    'restore authoritative HP before actual conquest shape',
  );
  await evaluate(`(() => {
    const fixture = window.__hpFixture;
    const defeatedStage = window.__hpState.activePet.stage;
    fixture.enemyHpRatio = 0;
    fixture.activeStage = defeatedStage + 1;
    fixture.overlay = { phase: 'DEFEAT_MOTION', elapsed: 0, defeatedStage, nextStage: defeatedStage + 1 };
  })()`);
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '0%' && window.__hpState.overlay?.phase === 'DEFEAT_MOTION'",
    'real conquest shape commits zero/stage before visual drain finishes',
  );
  const conquestState = await evaluate(
    '({ hp: window.__hpState.enemyHpRatio, stage: window.__hpState.activePet.stage, overlay: window.__hpState.overlay })',
  );
  assert.equal(conquestState.hp, 0, 'authoritative HP reaches zero immediately');
  assert.equal(
    conquestState.stage,
    conquestState.overlay.nextStage,
    'authoritative battle stage has already advanced',
  );
  assert.equal(conquestState.overlay.defeatedStage + 1, conquestState.stage);
  const conquest = {
    ...assertContinuousHpDrop(await sample(950), 0, 'real DEFEAT_MOTION conquest payload'),
    state: conquestState,
  };
  await evaluate('window.__hpFixture.overlay = null');
  await evaluate('window.__hpFixture.enemyHpRatio = 0.6');
  await waitFor(
    `document.querySelector('#enemy-hp-label').textContent === '60%' && !(${hpAnimating})`,
    'actual increase snaps before opacity check',
  );

  await evaluate(`(() => {
    const opacity = document.querySelector('#display-opacity');
    opacity.value = '35';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(
    "Math.abs(Number(getComputedStyle(document.querySelector('.enemy-hp')).opacity) - 0.35) < 0.001",
    'HP bar inherits display opacity',
  );
  const opacity = await evaluate(`({
    bar: Number(getComputedStyle(document.querySelector('.enemy-hp')).opacity),
    enemy: Number(getComputedStyle(document.querySelector('#enemy')).opacity),
    pet: Number(getComputedStyle(document.querySelector('#pet')).opacity),
    fillInBar: document.querySelector('.enemy-hp').contains(document.querySelector('#enemy-hp-fill')),
  })`);
  assert.deepEqual(opacity, { bar: 0.35, enemy: 0.35, pet: 1, fillInBar: true });

  await menu('enemy', false);
  await menu('pet', true);
  await click('[data-action="START"]');
  await menu('pet', false);
  await waitFor(
    `document.querySelector('#battle-overlay').dataset.beat === 'IMPACT' && ${hpAnimating}`,
    'next automatic hit before STOP cancellation',
    10000,
  );
  // Dispatch the actual STOP button directly so menu opening cannot be the
  // reason the animation is cancelled before the STOP command is exercised.
  await click('[data-action="STOP"]');
  await waitFor(
    `window.__hpState.activePet.battleMode === 'PAUSED' && !(${hpAnimating})`,
    'STOP cancels pending HP animation',
  );
  const stopped = await sample(300);
  for (const frame of stopped) assertHpSettled(frame, 60, 'STOP');

  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await evaluate('window.__hpFixture.enemyHpRatio = 0.25');
  await waitFor(
    "document.querySelector('#enemy-hp-label').textContent === '25%'",
    'reduced motion actual HP drop',
  );
  const reduced = await sample(200);
  for (const frame of reduced) assertHpSettled(frame, 25, 'reduced-motion actual HP');
  await menu('enemy', true);
  await click('[data-action="HIT"]');
  await waitFor(
    "document.querySelector('#battle-overlay').dataset.enemyPhase === 'HIT'",
    'reduced-motion manual HIT',
  );
  for (const frame of await sample(550)) assertHpSettled(frame, 25, 'reduced-motion HIT');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  return {
    automatic,
    manual,
    partial,
    narrow,
    endpointScreenshot,
    toneScreenshots,
    actualDrop,
    retarget,
    zero,
    evolution,
    conquest,
    opacity,
    stopCancels: true,
    pausedManualStopCancels: true,
    reducedMotionImmediate: true,
  };
}

// An in-memory public gateway fixture lets renderer identity changes be tested without a host.
async function checkIdentityAndSlam(cdp, evaluate, waitFor) {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires isolated HTTP');
      const ready = import('/packages/pet-battle/dist/testing/demo-gateway.js').then(async ({ DemoBattleGateway }) => {
        const result = await new DemoBattleGateway().execute({ type: 'GET_STATE', nowMs: Date.now() });
        window.__arenaFixture = result.state;
      });
      window.petBattle = { execute: async () => {
        await ready;
        return { state: structuredClone(window.__arenaFixture), events: [] };
      } };
    })();`,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 420,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.reload');
  await waitFor(
    "Boolean(window.__arenaFixture && document.querySelector('#battle-overlay')?.dataset.arenaPhase)",
    'in-memory gateway fixture',
  );
  const spectatorChecks = [];
  for (const stage of [1, 4, 22, 1]) {
    const color = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'INDIGO', 'PURPLE', 'RAINBOW'][
      Math.floor((stage - 1) / 3) % 8
    ];
    await evaluate(
      `window.__arenaFixture.activePet.stage = ${stage}; window.__arenaFixture.enemyColor = '${color}'`,
    );
    const label = `COLOR ${(Math.floor((stage - 1) / 3) % 8) + 1}/8 · SIZE ${((stage - 1) % 3) + 1}/3`;
    await waitFor(
      `document.querySelector('#stage-label').textContent === '${label}'`,
      'stage refresh without defeated enemy spectators',
    );
    const observed = await evaluate(`({
      extraEnemies: document.querySelectorAll('#defeated-enemy-spectators, .enemy-fan, .defeated-fan').length,
      currentEnemy: document.querySelectorAll('#enemy-image').length,
      peekingLayer: document.querySelectorAll('#pet-spectators').length,
    })`);
    assert.deepEqual(observed, { extraEnemies: 0, currentEnemy: 1, peekingLayer: 1 });
    spectatorChecks.push({ stage, ...observed });
  }
  const switched = await evaluate(`(() => new Promise((resolve, reject) => {
    const began = performance.now();
    let changedAt;
    function frame() {
      const root = document.querySelector('#battle-overlay');
      const enemy = document.querySelector('#enemy');
      if (changedAt === undefined && root.dataset.beat === 'IMPACT' && enemy.classList.contains('hit-reaction')) {
        changedAt = performance.now();
        const state = window.__arenaFixture;
        state.activePet = { ...state.activePet, petId: 'fixture-replacement', displayName: '교체 펫', rarity: 'RARE' };
        state.roster = [state.activePet];
        state.spectatorPetIds = [];
      }
      if (changedAt !== undefined && document.querySelector('#pet-sheet').src.includes('rare-idle.png')) {
        resolve({
          elapsed: performance.now() - changedAt,
          hitReaction: enemy.classList.contains('hit-reaction'),
          phase: root.dataset.arenaPhase,
          petSource: document.querySelector('#pet-sheet').src,
          enemySource: document.querySelector('#enemy-image').src,
        });
        return;
      }
      if (performance.now() - began > 10000) return reject(new Error('Identity fixture did not switch at impact'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }))()`);
  assert.equal(
    switched.hitReaction,
    false,
    'a replacement pet/theme must not inherit enemy hit CSS',
  );
  assert.ok(
    ['RETREAT', 'CHASE'].includes(switched.phase),
    'identity switch clears the attack and starts a fresh independent approach',
  );
  assert.ok(
    switched.elapsed < 350,
    'identity was observed before the old 420ms reaction could expire',
  );
  assert.match(switched.petSource, /rare-idle\.png$/);
  assert.match(
    switched.enemySource,
    /red-steady\.png$/,
    'pet replacement is isolated from stage/theme changes',
  );
  const slam = await evaluate(`(() => new Promise((resolve, reject) => {
    const began = performance.now();
    let impactAt;
    let after200;
    function frame() {
      const root = document.querySelector('#battle-overlay');
      const effect = document.querySelector('.enemy-slam');
      if (impactAt === undefined && root.dataset.enemyImpact === 'true') impactAt = performance.now();
      const elapsed = impactAt === undefined ? -1 : performance.now() - impactAt;
      if (elapsed >= 200 && after200 === undefined) {
        after200 = {
          elapsed,
          impactFlag: root.dataset.enemyImpact === 'true',
          active: effect.classList.contains('active'),
          visible: [...effect.children].some(piece => Number(getComputedStyle(piece).opacity) > 0),
        };
      }
      if (elapsed >= 400) {
        resolve({ after200, after400: { elapsed, active: effect.classList.contains('active') } });
        return;
      }
      if (performance.now() - began > 10000) return reject(new Error('Slam fixture did not complete'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }))()`);
  assert.equal(slam.after200.impactFlag, false, '130ms impact signal has ended');
  assert.equal(slam.after200.active, true, '380ms dust effect outlives the impact signal');
  assert.equal(slam.after200.visible, true, 'dust remains visible around 200ms');
  assert.equal(slam.after400.active, false, 'dust effect is cleaned up after its duration');
  return { spectatorChecks, identitySwitch: switched, slamLifetime: slam };
}

async function main() {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      const name = decodeURIComponent(requestUrl.pathname);
      const file = await realpath(path.resolve(repository, `.${name}`));
      const type = types[path.extname(file)];
      const allowed =
        file.startsWith(`${allowedRoot}${path.sep}`) ||
        (file.startsWith(`${sharedPetRoot}${path.sep}`) && type === 'image/png');
      if (!allowed || !type) {
        response.writeHead(403).end();
        return;
      }
      // Isolated sprite swap fixture: bound latency to local PNGs in this package.
      const spriteDelay = Number(requestUrl.searchParams.get('sprite-delay-ms'));
      if (type === 'image/png' && Number.isFinite(spriteDelay) && spriteDelay > 0) {
        await delay(Math.min(1000, spriteDelay));
      }
      response
        .writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' })
        .end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  let profile, child, exited, cdp, evidence;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    profile = await mkdtemp(path.join(tmpdir(), 'pet-battle-arena-profile-'));
    child = spawn(
      process.env.BATTLE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    exited = new Promise((resolve) => child.once('exit', resolve));
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 10000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited before startup (${code ?? signal}): ${stderr}`));
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-8192);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const address = new URL(endpoint);
    const pages = await fetch(`http://${address.host}/json/list`, {
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
    cdp = await connect(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      return result.result.value;
    };
    const waitFor = async (expression, label, timeout = 5000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        await delay(30);
      }
      throw new Error(`Timed out: ${label}`);
    };
    const click = (selector) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const menu = async (target, open) => {
      const hidden = `document.querySelector('#${target}-menu').hidden`;
      if ((await evaluate(hidden)) === open) await click(`#${target}`);
      await waitFor(`${hidden} === ${!open}`, `${target} menu ${open ? 'open' : 'close'}`);
    };
    const sample = async (ms) => {
      const origin = await evaluate('performance.now()');
      const frames = [];
      for (let remaining = ms; remaining > 0; remaining -= 8000)
        frames.push(
          ...(await evaluate(`(${sampleArena})(${Math.min(remaining, 8000)}, ${origin})`)),
        );
      return frames;
    };
    const screenshot = async (name) => {
      evidence ??= await mkdtemp(path.join(tmpdir(), 'pet-battle-arena-evidence-'));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(evidence, `${name}.png`);
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      return file;
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 420,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/packages/pet-battle/dist/ui/index.html`,
    });
    await waitFor(
      "document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth > 0 && document.querySelector('#battle-overlay')?.dataset.arenaPhase",
      'arena renderer loaded',
    );
    assert.equal(await evaluate('Boolean(window.petBattle)'), false, 'must use isolated HTTP demo');
    assert.equal(
      await evaluate(
        "document.querySelector('#battle-background').parentElement === document.querySelector('#pet-spectators').parentElement && document.querySelector('#battle-background').parentElement.id === 'battle-world'",
      ),
      true,
      'background and tree spectators share the camera plane',
    );
    if (process.argv.includes('--mole-only')) {
      const { checkMoleCombat } = require('./mole-combat.browser.cjs');
      const mole = await checkMoleCombat(cdp, evaluate, waitFor, screenshot);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated mole combat; no Electron or user DB',
            mole,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--continuity-only')) {
      const { checkPositionContinuity } = require('./position-continuity.browser.cjs');
      const continuity = await checkPositionContinuity(cdp, evaluate, waitFor, screenshot);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated resize and pet selection continuity; no Electron or user DB',
            continuity,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--ambient-only')) {
      const { checkAmbientDialogue } = require('./ambient-dialogue.browser.cjs');
      const ambientDialogue = await checkAmbientDialogue(cdp, evaluate, waitFor, screenshot);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated ambient speech; no Electron or user DB',
            ambientDialogue,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--image-isolation-only')) {
      const { checkImageIsolation } = require('./image-isolation.browser.cjs');
      const images = await checkImageIsolation(cdp, evaluate, waitFor);
      assert.deepEqual(cdp.errors, []);
      console.log(JSON.stringify({ result: 'PASS', mode: 'image isolation', images }, null, 2));
      return;
    }
    if (process.argv.includes('--sprite-only')) {
      const { checkSpriteOverlap } = require('./sprite-overlap.browser.cjs');
      const sprites = await checkSpriteOverlap(cdp, evaluate, waitFor, screenshot);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify({ result: 'PASS', mode: 'isolated sprite transitions', sprites }, null, 2),
      );
      return;
    }
    if (process.argv.includes('--cadence-only')) {
      const { checkAttackCadence } = require('./attack-cadence.browser.cjs');
      const cadence = await checkAttackCadence(cdp, evaluate, waitFor);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated headless frame-gap fixture; no Electron or user DB',
            cadence,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--hp-only')) {
      const hpMotion = await checkHpMotion(cdp, evaluate, waitFor, click, menu, screenshot);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated headless HP presentation; no Electron or user DB',
            hpMotion,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--fixture-only')) {
      const fixtures = await checkIdentityAndSlam(cdp, evaluate, waitFor);
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated headless in-memory gateway; no Electron or user DB',
            fixtures,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (process.argv.includes('--camera-only')) {
      const frames = await sample(16000);
      assertContained(frames, 640, 420);
      const cycle = assertCycle(frames, 'PET');
      const pausedFollow = [];
      for (const control of ['menu', 'STOP']) {
        await cdp.send('Page.reload');
        await waitFor(
          "document.querySelector('#pet-sheet')?.complete && document.querySelector('#pet-sheet').naturalWidth > 0 && document.querySelector('#battle-overlay')?.dataset.petWalking === 'true'",
          `${control}: fresh walking pet`,
        );
        // Stop before the 500ms history delay has elapsed. The camera must then
        // catch up while the actors remain motionless, instead of freezing at 0.
        await evaluate(`new Promise(resolve => {
          const began = performance.now();
          function frame() {
            if (performance.now() - began >= 200) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        })`);
        await menu('pet', true);
        if (control === 'STOP') {
          await click('[data-action="STOP"]');
          await menu('pet', false);
        }
        const paused = await sample(1600);
        assertContained(paused, 640, 420);
        pausedFollow.push({ control, ...assertFrozen(paused, control, true) });
      }
      assert.deepEqual(cdp.errors, []);
      console.log(
        JSON.stringify(
          {
            result: 'PASS',
            mode: 'isolated phase-independent delayed pet camera; no Electron or user DB',
            cycle,
            pausedFollow,
            errors: cdp.errors,
          },
          null,
          2,
        ),
      );
      return;
    }
    const results = [];
    const manualAttacks = [];
    const screenshots = [];
    for (const [width, height, enemyHeight, petAsset] of [
      [360, 180, 80, 'common'],
      [640, 420, 64, 'rare'],
      [960, 540, 56, 'epic'],
      [360, 640, 80, 'common'],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitFor(
        `innerWidth === ${width} && innerHeight === ${height} && document.querySelector('#battle-world').clientWidth === ${width + 60}`,
        'viewport and overscan plane resize',
      );
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      await menu('pet', true);
      for (let attempt = 0; attempt < 3; attempt++) {
        const currentSource = await evaluate("document.querySelector('#pet-sheet').src");
        if (currentSource.endsWith(`/${petAsset}-idle.png`)) break;
        await click('[data-action="PET_ASSET"]');
        await waitFor(
          `document.querySelector('#pet-sheet').src !== ${JSON.stringify(currentSource)}`,
          'alternate pet silhouette for close-slam checks',
        );
      }
      await waitFor(
        `document.querySelector('#pet-sheet').src.endsWith('/${petAsset}-idle.png') && document.querySelector('#pet-sheet').complete && document.querySelector('#pet-sheet').naturalWidth > 0`,
        `${petAsset} idle sprite loaded for independent alpha measurement`,
      );
      await menu('pet', false);
      await menu('enemy', true);
      for (let attempt = 0; attempt < 3; attempt++) {
        const currentHeight = await evaluate(
          "parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height)",
        );
        if (currentHeight === enemyHeight) break;
        await click('[data-action="SIZE"]');
        await waitFor(
          `parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height) !== ${currentHeight}`,
          'enemy size for contact checks',
        );
      }
      await menu('enemy', false);
      const frames = await sample(16000);
      assertContained(frames, width, height);
      results.push({ width, height, enemyHeight, petAsset, ...assertCycle(frames, 'PET') });
      if (width === 360 && height === 180) {
        await waitFor(
          "document.querySelector('#battle-overlay').dataset.beat === 'IMPACT'",
          'open menu during enemy hit reaction',
          10000,
        );
      }
      await menu('pet', true);
      assertFrozen(await sample(550), `${width}x${height} open menu`);
      await click('[data-action="STOP"]');
      await menu('pet', false);
      assertFrozen(await sample(550), `${width}x${height} STOP`);
      screenshots.push(await screenshot(`${width}x${height}-stopped`));
      await menu('pet', true);
      await click('[data-action="ATTACK"]');
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.petAction === 'ATTACK'",
        'manual attack preview starts while paused',
      );
      const attackFrames = await sample(1050);
      assertContained(attackFrames, width, height);
      assert.ok(
        attackFrames.some((sample) => sample.beat === 'IMPACT'),
        'manual attack preview must reach impact',
      );
      manualAttacks.push({
        width,
        height,
        enemyHeight,
        frames: attackFrames.length,
        minimumBodyGap: assertSeparated(attackFrames, `${width}x${height} manual attack`, true),
      });
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.petAction === 'IDLE'",
        'manual attack preview finishes',
      );
      await click('[data-action="START"]');
      await menu('pet', false);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 420,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const hp of [60, 25]) {
      // Each HP profile starts with the same available ground. The previous
      // profile may have reached the arena edge; no in-game walk-back reset is
      // expected or introduced merely to repeat this fixture.
      await cdp.send('Page.reload');
      await waitFor(
        "document.querySelector('#battle-overlay')?.dataset.arenaPhase && document.querySelector('#enemy-hp-label').textContent === '100%'",
        'fresh isolated HP profile',
      );
      await menu('enemy', true);
      for (const value of hp === 60 ? [60] : [60, 25]) {
        await click('[data-action="HP"]');
        await waitFor(
          `document.querySelector('#enemy-hp-label').textContent === '${value}%'`,
          `HP preview ${value}`,
        );
      }
      await waitFor(
        `document.querySelector('#enemy-hp-label').textContent === '${hp}%'`,
        `HP ${hp}`,
      );
      await menu('enemy', false);
      await waitFor(
        "document.querySelector('#battle-overlay').dataset.arenaPhase !== 'IDLE' && document.querySelector('#battle-overlay').dataset.retreating === 'ENEMY'",
        'HP preview hit completes and the next cycle selects the enemy leader',
        10000,
      );
      const frames = await sample(16000);
      assertContained(frames, 640, 420);
      results.push({ width: 640, height: 420, ...assertCycle(frames, 'ENEMY') });
    }
    await waitFor(
      "document.querySelector('#battle-overlay').dataset.arenaPhase === 'JUMP'",
      'jump screenshot',
      10000,
    );
    screenshots.push(await screenshot('enemy-jump'));
    await waitFor(
      "document.querySelector('#battle-overlay').dataset.enemyImpact === 'true'",
      'slam screenshot',
      10000,
    );
    screenshots.push(await screenshot('enemy-slam'));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 180,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      "document.querySelector('#battle-world').clientWidth === 420",
      'minimum window for transition checks',
    );
    await menu('enemy', true);
    for (let attempts = 0; attempts < 3; attempts++) {
      const height = await evaluate(
        "parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height)",
      );
      if (height === 80) break;
      await click('[data-action="SIZE"]');
      await waitFor(
        `parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height) !== ${height}`,
        'large enemy for transition bounds',
      );
    }
    assert.equal(
      await evaluate("parseFloat(getComputedStyle(document.querySelector('#enemy-image')).height)"),
      80,
    );
    const stageBeforePreview = await evaluate("document.querySelector('#stage-label').textContent");
    await click('[data-action="DEFEAT"]');
    const defeat = await sample(1100);
    assertContained(defeat, 360, 180);
    await click('[data-action="SPAWN"]');
    const spawnSamples = await sample(1100);
    assertContained(spawnSamples, 360, 180);
    assert.equal(
      await evaluate("document.querySelector('#stage-label').textContent"),
      stageBeforePreview,
      'manual defeat/spawn must not advance actual progression',
    );
    const hpMotion = await checkHpMotion(cdp, evaluate, waitFor, click, menu, screenshot);
    const fixtures = await checkIdentityAndSlam(cdp, evaluate, waitFor);
    const { checkAttackCadence } = require('./attack-cadence.browser.cjs');
    const cadence = await checkAttackCadence(cdp, evaluate, waitFor);
    const { checkSpriteOverlap } = require('./sprite-overlap.browser.cjs');
    const sprites = await checkSpriteOverlap(cdp, evaluate, waitFor, screenshot);
    const { checkAmbientDialogue } = require('./ambient-dialogue.browser.cjs');
    const ambientDialogue = await checkAmbientDialogue(cdp, evaluate, waitFor, screenshot);
    assert.deepEqual(cdp.errors, []);
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          mode: 'isolated headless HTTP demo; no Electron or user DB',
          cycles: results,
          manualAttacks,
          menuFreeze: true,
          stopFreeze: true,
          minimumTransitions: {
            enemyHeight: 80,
            defeatFrames: defeat.length,
            spawnFrames: spawnSamples.length,
          },
          fixtures,
          hpMotion,
          cadence,
          sprites,
          ambientDialogue,
          screenshots,
          errors: cdp.errors,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (cdp) {
      try {
        evidence ??= await mkdtemp(path.join(tmpdir(), 'pet-battle-arena-evidence-'));
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(evidence, 'failure.png');
        await writeFile(file, Buffer.from(shot.data, 'base64'));
        console.error(`Failure screenshot: ${file}`);
      } catch {
        // Preserve the original assertion if Chrome itself is no longer available.
      }
    }
    throw error;
  } finally {
    cdp?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(1500)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (profile) await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
