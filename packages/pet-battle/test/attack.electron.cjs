// Build desktop + @pet/battle, then run with Electron (in-process battle engine).
// Uses only a temporary SQLite database and Electron profile, never app user data.
const assert = require('node:assert/strict');
const { accessSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');

const repo = path.resolve(__dirname, '../../..');
const directory =
  process.env.PETTO_BATTLE_TEST_PROFILE ||
  mkdtempSync(path.join(tmpdir(), 'petto-battle-host-smoke-'));
const artifactDirectory = process.env.PETTO_BATTLE_TEST_ARTIFACT_DIR;
app.setPath('userData', directory);
app.setPath('sessionData', directory);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let database;
let closeBattle;
let cleaned = false;

async function within(promise, label, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function evaluate(window, expression) {
  assert.equal(window.isDestroyed(), false, 'battle window must remain alive');
  return within(window.webContents.executeJavaScript(expression), 'renderer response');
}

async function waitFor(window, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(window, expression)) return;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

async function loaded(window) {
  const contents = window.webContents;
  if (contents.getURL().startsWith('file:') && !contents.isLoadingMainFrame()) return;
  let finished;
  let failed;
  try {
    await within(
      new Promise((resolve, reject) => {
        finished = resolve;
        failed = (_event, code, description) => reject(new Error(`${code}: ${description}`));
        contents.once('did-finish-load', finished);
        contents.once('did-fail-load', failed);
      }),
      'host battle document load',
    );
  } finally {
    contents.removeListener('did-finish-load', finished);
    contents.removeListener('did-fail-load', failed);
  }
}

async function click(window, selector) {
  await waitFor(
    window,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return bounds.width > 0 && bounds.height > 0 && hit && element.contains(hit);
    })()`,
    `clickable ${selector}`,
  );
  const point = await evaluate(
    window,
    `(() => {
      const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2)};
    })()`,
  );
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
}

async function petAction(window, action) {
  if (await evaluate(window, 'document.querySelector("#pet-menu").hidden')) {
    await click(window, '#pet');
  }
  await click(window, `[data-action="${action}"]`);
}

function command(window, value) {
  return evaluate(window, `window.petBattle.execute(${JSON.stringify(value)})`);
}

function state(window) {
  return command(window, { type: 'GET_STATE', nowMs: Date.now() }).then((result) => result.state);
}

async function recordZebraAttack(window, stage, automatic = false) {
  await evaluate(
    window,
    `(() => {
    const root = document.querySelector('#battle-overlay');
    const image = document.querySelector('#pet-sheet');
    const hoof = document.querySelector('.zebra-native-sprite');
    const reference = document.createElement('canvas');
    reference.width = reference.height = 32;
    const context = reference.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32, 0, 0, 32, 32);
    const base = context.getImageData(0, 0, 32, 32).data;
    const bounds = ${JSON.stringify(stage === 1 ? [18, 21, 21, 24] : stage === 2 ? [18, 21, 23, 26] : [23, 26, 27, 30])};
    const samples = [];
    let started = 0;
    let lastTime = 0;
    let wasLifted = false;
    const landings = [];
    let bodyChangedMax = 0;
    let invisibleFrames = 0;
    const sources = new Set();
    const gaps = [];
    const baseWidth = hoof.getBoundingClientRect().width;
    let forwardAt = null, forwardEndedAt = null, waveAt = null;
    let wasForward = false, maxScale = 1;
    let maxWavePixels = 0, maxWaveHeight = 0;
    window.__zebraRecording = undefined;
    const tick = (at) => {
      const active = root.dataset.petCombatPhase !== 'IDLE';
      if (!started && !active) { requestAnimationFrame(tick); return; }
      if (!started) started = at;
      if (lastTime) gaps.push(at - lastTime);
      lastTime = at;
      if (!active && samples.length) {
        const times = [0, 100, 160, 200, 260, 360, 420, 470, 600, 850];
        const strip = document.createElement('canvas');
        strip.width = times.length * 96; strip.height = 120;
        const view = strip.getContext('2d');
        view.imageSmoothingEnabled = false;
        view.fillStyle = '#181c2c'; view.fillRect(0, 0, strip.width, strip.height);
        times.forEach((time, index) => {
          const sample = samples.reduce((best, next) =>
            Math.abs(next.at - time) < Math.abs(best.at - time) ? next : best);
          const frame = context.createImageData(32, 32);
          frame.data.set(sample.pixels); context.putImageData(frame, 0, 0);
          view.drawImage(reference, index * 96, 0, 96, 96);
          view.fillStyle = '#ffffff'; view.font = '12px sans-serif';
          view.fillText(Math.round(sample.at) + 'ms', index * 96 + 20, 112);
        });
        const sorted = [...gaps].sort((a, b) => a - b);
        window.__zebraRecording = { landings, bodyChangedMax, invisibleFrames,
          forwardAt, forwardEndedAt, waveAt, maxScale, maxWavePixels, maxWaveHeight,
          sources: [...sources], frames: samples.length,
          maxGap: Math.max(...gaps), p95Gap: sorted[Math.floor(sorted.length * 0.95)],
          filmstrip: strip.toDataURL('image/png').split(',')[1] };
        return;
      }
      const pixels = hoof.getContext('2d').getImageData(0, 0, 32, 32).data;
      let legChanged = 0, bodyChanged = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const pixel = (y * 32 + x) * 4;
        const changed = pixels.slice(pixel, pixel + 4).some((value, channel) => value !== base[pixel + channel]);
        if (!changed) continue;
        if (x >= bounds[0] && x <= bounds[1] && y >= bounds[2] && y <= bounds[3]) legChanged++;
        else bodyChanged++;
      }
      if (wasLifted && !legChanged) landings.push(at - started);
      wasLifted = legChanged > 0;
      bodyChangedMax = Math.max(bodyChangedMax, bodyChanged);
      const scale = hoof.getBoundingClientRect().width / baseWidth;
      const forward = scale > 1.001;
      if (forward && forwardAt === null) forwardAt = at - started;
      if (wasForward && !forward) forwardEndedAt = at - started;
      if (root.dataset.petCombatPhase === 'ZEBRA_WAVE' && waveAt === null) waveAt = at - started;
      if (root.dataset.petCombatPhase === 'ZEBRA_WAVE' && samples.length % 3 === 0) {
        const wave=document.querySelector('.zebra-shockwave'),data=wave.getContext('2d').getImageData(0,0,wave.width,wave.height).data;
        let count=0,minY=wave.height,maxY=0;
        for(let y=0;y<wave.height;y++)for(let x=0;x<wave.width;x++)if(data[(y*wave.width+x)*4+3]>0){count++;minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
        maxWavePixels=Math.max(maxWavePixels,count);maxWaveHeight=Math.max(maxWaveHeight,maxY-minY);
      }
      wasForward = forward;
      maxScale = Math.max(maxScale, scale);
      const visible = Number(hoof.style.opacity) === 1 ||
        getComputedStyle(document.querySelector('.pet-viewport')).visibility === 'visible';
      if (!visible) invisibleFrames++;
      sources.add(image.currentSrc);
      samples.push({ at: at - started, pixels: Array.from(pixels) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`,
  );
  await petAction(window, automatic ? 'START' : 'ATTACK');
  await waitFor(window, 'Boolean(window.__zebraRecording)', 'record complete zebra attack');
  const report = await evaluate(window, 'window.__zebraRecording');
  const { filmstrip, ...metrics } = report;
  const label = `zebra-stage${stage}-${automatic ? 'automatic' : 'motion'}`;
  console.log(`ZEBRA RECORD ${label}: ${JSON.stringify(metrics)}`);
  if (artifactDirectory) {
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(path.join(artifactDirectory, `${label}.png`), Buffer.from(filmstrip, 'base64'));
    writeFileSync(path.join(artifactDirectory, `${label}.json`), JSON.stringify(metrics, null, 2));
  }
  return metrics;
}

async function recordHamsterAttack(window, stage, automatic = false) {
  const top = [11, 13, 13][stage - 1];
  const bottom = [16, 18, 19][stage - 1];
  const mouth = stage === 1 ? { x: 15, y: 14 } : stage === 2 ? { x: 15, y: 16 } : { x: 16, y: 17 };
  await evaluate(
    window,
    `(() => {
    const root = document.querySelector('#battle-overlay');
    const image = document.querySelector('#pet-sheet');
    const native = document.querySelector('.hamster-native-sprite');
    const food = document.querySelector('.hamster-food');
    const reference = document.createElement('canvas'); reference.width = reference.height = 32;
    const context = reference.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32, 0, 0, 32, 32);
    const base = context.getImageData(0, 0, 32, 32).data;
    const mouth = ${JSON.stringify(mouth)};
    const eyeLeft = ${stage === 3 ? 11 : 10}, eyeRight = ${stage === 3 ? 22 : 21};
    let started = 0, lastAt = 0, fixedChangedMax = 0, invisibleFrames = 0;
    let maxPuff = 0, shots = 0, impacts = 0, wasShot = false, wasImpact = false;
    let foodVisible = false, burstVisible = false;
    const pet = document.querySelector('#pet');
    const number = name => Number.parseFloat(pet.style.getPropertyValue(name)) || 0;
    let maxHop = 0, maxRecoil = 0, maxTilt = 0, minScaleY = 1;
    const phases = [], sources = new Set(), gaps = [];
    window.__hamsterRecording = undefined;
    const tick = at => {
      const phase = root.dataset.petCombatPhase;
      if (!started && phase === 'IDLE') { requestAnimationFrame(tick); return; }
      if (!started) started = at;
      if (lastAt) gaps.push(at - lastAt); lastAt = at;
      if (phase === 'IDLE') {
        const sorted = [...gaps].sort((a,b) => a-b);
        window.__hamsterRecording = { fixedChangedMax, invisibleFrames, maxPuff, shots, impacts,
          maxHop, maxRecoil, maxTilt, minScaleY,
          endProjection: [number('--hamster-x'), number('--hamster-y'), number('--hamster-sx'), number('--hamster-sy'), number('--hamster-tilt')],
          foodVisible, burstVisible, phases, sources: [...sources], p95Gap: sorted[Math.floor(sorted.length * 0.95)] };
        return;
      }
      if (phases.at(-1) !== phase) phases.push(phase);
      const pixels = native.getContext('2d').getImageData(0,0,32,32).data;
      let fixedChanged = 0;
      for (let y=0; y<32; y++) for (let x=0; x<32; x++) {
        const inMouth = Math.abs(x-mouth.x)<=1 && Math.abs(y-mouth.y)<=1;
        const fixed = y<${top} || y>=${bottom} || (x>eyeLeft && x<eyeRight && !inMouth);
        if (!fixed) continue;
        const pixel=(y*32+x)*4;
        if (pixels.slice(pixel,pixel+4).some((value,channel) => value !== base[pixel+channel])) fixedChanged++;
      }
      fixedChangedMax = Math.max(fixedChangedMax,fixedChanged);
      maxHop = Math.max(maxHop, -number('--hamster-y'));
      maxRecoil = Math.max(maxRecoil, -number('--hamster-x'));
      maxTilt = Math.max(maxTilt, Math.abs(number('--hamster-tilt')));
      minScaleY = Math.min(minScaleY, number('--hamster-sy'));
      if (Number(native.style.opacity)!==1 && getComputedStyle(document.querySelector('.pet-viewport')).visibility!=='visible') invisibleFrames++;
      maxPuff = Math.max(maxPuff, Number(native.dataset.cheekPuff) || 0);
      const shot = phase==='HAMSTER_FIRE', impact=root.dataset.beat==='IMPACT';
      if (shot && !wasShot) shots++;
      if (impact && !wasImpact) impacts++;
      wasShot=shot; wasImpact=impact;
      foodVisible ||= shot && !food.hidden;
      burstVisible ||= phase==='HAMSTER_BURST' && !food.hidden;
      sources.add(image.currentSrc);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`,
  );
  await petAction(window, automatic ? 'START' : 'ATTACK');
  await waitFor(window, 'Boolean(window.__hamsterRecording)', 'complete hamster attack recording');
  const report = await evaluate(window, 'window.__hamsterRecording');
  console.log(
    `HAMSTER RECORD stage ${stage} ${automatic ? 'automatic' : 'manual'}: ${JSON.stringify(report)}`,
  );
  return report;
}

async function recordWizardAttack(window, stage, automatic = false) {
  await evaluate(
    window,
    `(() => {
    const root=document.querySelector('#battle-overlay'),native=document.querySelector('.wizard-native-sprite');
    const image=document.querySelector('#pet-sheet'),sky=document.querySelector('.wizard-sky'),storm=document.querySelector('.wizard-meteors'),pet=document.querySelector('#pet');
    const size=image.naturalHeight;
    const ref=document.createElement('canvas');ref.width=ref.height=size;
    const ctx=ref.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,size,size,0,0,size,size);
    const base=ctx.getImageData(0,0,size,size).data;
    let started=0,last=0,invisible=0,faceChanges=0,impacts=0,previousHit=false,maxMeteors=0,maxLift=0,maxCast=0;
    let checkedCoverage=false,coverage=[false,false,false,false];
    const phases=[],gaps=[],sources=new Set();
    window.__wizardRecording=undefined;
    const tick=at=>{
      const phase=root.dataset.petCombatPhase;
      if(!started&&phase==='IDLE'){requestAnimationFrame(tick);return;}
      if(!started)started=at;if(last)gaps.push(at-last);last=at;
      if(phase==='IDLE'){
        const sorted=[...gaps].sort((a,b)=>a-b);
        window.__wizardRecording={size,invisible,faceChanges,impacts,maxMeteors,maxLift,maxCast,coverage,phases,sources:[...sources],
          p95Gap:sorted[Math.floor(sorted.length*.95)],cleared:sky.hidden&&storm.hidden,
          finalY:Number.parseFloat(pet.style.getPropertyValue('--wizard-y'))||0};return;
      }
      if(phases.at(-1)!==phase)phases.push(phase);
      const used=Number(native.style.opacity)===1;
      if(!used&&getComputedStyle(document.querySelector('.pet-viewport')).visibility!=='visible')invisible++;
      if(used){
        const pixels=native.getContext('2d').getImageData(0,0,size,size).data;
        const from=size===48?18:10,to=size===48?30:20;let changed=0;
        for(let y=8;y<22;y++)for(let x=from;x<=to;x++){
          const p=(y*size+x)*4;if(pixels.slice(p,p+4).some((v,c)=>v!==base[p+c]))changed++;
        }
        faceChanges=Math.max(faceChanges,changed);
      }
      const hit=root.dataset.beat==='IMPACT';if(hit&&!previousHit)impacts++;previousHit=hit;
      maxMeteors=Math.max(maxMeteors,Number(storm.dataset.meteorCount)||0);
      maxLift=Math.max(maxLift,-Number.parseFloat(pet.style.getPropertyValue('--wizard-y'))||0);
      maxCast=Math.max(maxCast,Number(native.dataset.castProgress)||0);
      if(!checkedCoverage&&phase==='WIZARD_RAIN'&&Number(storm.dataset.spellMs)>1500){
        checkedCoverage=true;const data=storm.getContext('2d').getImageData(0,0,storm.width,storm.height).data;
        for(let y=0;y<storm.height;y++)for(let x=0;x<storm.width;x++)if(data[(y*storm.width+x)*4+3]>0)coverage[Math.min(3,Math.floor(x/storm.width*4))]=true;
      }
      sources.add(image.currentSrc);requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  })()`,
  );
  await petAction(window, automatic ? 'START' : 'ATTACK');
  await waitFor(
    window,
    'Boolean(window.__wizardRecording)',
    'complete wizard spell recording',
    15000,
  );
  const report = await evaluate(window, 'window.__wizardRecording');
  console.log(
    `WIZARD RECORD stage ${stage} ${automatic ? 'automatic' : 'manual'}: ${JSON.stringify(report)}`,
  );
  return report;
}

async function recordSquirrelAttack(window, stage, automatic = false) {
  await evaluate(
    window,
    `(() => {
    const root=document.querySelector('#battle-overlay'),native=document.querySelector('.squirrel-native-sprite');
    const image=document.querySelector('#pet-sheet'),grove=document.querySelector('.squirrel-grove'),storm=document.querySelector('.squirrel-storm'),pet=document.querySelector('#pet');
    const size=image.naturalHeight,ref=document.createElement('canvas');ref.width=ref.height=size;
    const ctx=ref.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,size,size,0,0,size,size);
    const base=ctx.getImageData(0,0,size,size).data;
    let started=false,last=0,invisible=0,faceChanges=0,impacts=0,previousHit=false,maxClones=0,maxBlades=0,maxLeap=0,maxSweep=0;
    let checkedCoverage=false,coverage=[false,false,false,false];const phases=[],gaps=[],sources=new Set();
    window.__squirrelRecording=undefined;
    const tick=at=>{
      const phase=root.dataset.petCombatPhase;if(!started&&phase==='IDLE'){requestAnimationFrame(tick);return;}
      started=true;if(last)gaps.push(at-last);last=at;
      if(phase==='IDLE'){
        const sorted=[...gaps].sort((a,b)=>a-b);
        window.__squirrelRecording={size,invisible,faceChanges,impacts,maxClones,maxBlades,maxLeap,maxSweep,coverage,phases,sources:[...sources],
          p95Gap:sorted[Math.floor(sorted.length*.95)],cleared:grove.hidden&&storm.hidden,
          finalY:Number.parseFloat(pet.style.getPropertyValue('--squirrel-y'))||0};return;
      }
      if(phases.at(-1)!==phase)phases.push(phase);
      const used=Number(native.style.opacity)===1;
      if(!used&&getComputedStyle(document.querySelector('.pet-viewport')).visibility!=='visible')invisible++;
      if(used){
        const pixels=native.getContext('2d').getImageData(0,0,native.width,native.height).data;
        const from=size===48?18:10,to=size===48?28:18;let changed=0;
        for(let y=8;y<22;y++)for(let x=from;x<=to;x++){
          const p=(y*native.width+x)*4,b=(y*size+x)*4;if(pixels.slice(p,p+4).some((v,c)=>v!==base[b+c]))changed++;
        }faceChanges=Math.max(faceChanges,changed);
      }
      const hit=root.dataset.beat==='IMPACT';if(hit&&!previousHit)impacts++;previousHit=hit;
      maxClones=Math.max(maxClones,Number(storm.dataset.cloneCount)||0);maxBlades=Math.max(maxBlades,Number(storm.dataset.bladeCount)||0);
      maxLeap=Math.max(maxLeap,-Number.parseFloat(pet.style.getPropertyValue('--squirrel-y'))||0);maxSweep=Math.max(maxSweep,Number(native.dataset.tailSweep)||0);
      if(!checkedCoverage&&phase==='SQUIRREL_CLONES'&&Number(storm.dataset.spellMs)>1300){
        checkedCoverage=true;const data=grove.getContext('2d').getImageData(0,0,grove.width,grove.height).data;
        for(let y=0;y<grove.height;y++)for(let x=0;x<grove.width;x++){
          const p=(y*grove.width+x)*4;
          if(data[p+3]>0&&(data[p]>100||data[p+1]>100))coverage[Math.min(3,Math.floor(x/grove.width*4))]=true;
        }
      }
      sources.add(image.currentSrc);requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  })()`,
  );
  await petAction(window, automatic ? 'START' : 'ATTACK');
  await waitFor(
    window,
    'Boolean(window.__squirrelRecording)',
    'complete squirrel spell recording',
    15000,
  );
  const report = await evaluate(window, 'window.__squirrelRecording');
  console.log(
    `SQUIRREL RECORD stage ${stage} ${automatic ? 'automatic' : 'manual'}: ${JSON.stringify(report)}`,
  );
  return report;
}

async function waitForImpact(window) {
  await waitFor(
    window,
    `(() => {
      const root = document.querySelector('#battle-overlay');
      const slash = document.querySelector('.slash');
      if (!root || !slash) return false;
      const bounds = slash.getBoundingClientRect();
      return root.dataset.beat === 'IMPACT' && Number(getComputedStyle(slash).opacity) > 0 &&
        bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
        document.querySelector('#pet-sheet').classList.contains('animated-sheet');
    })()`,
    'visible attack sprite and slash',
    15_000,
  );
}

const stoppedExpression = `(() => {
  const root = document.querySelector('#battle-overlay');
  const slash = document.querySelector('.slash');
  return root.dataset.beat === 'IDLE' && Number(getComputedStyle(slash).opacity) === 0 &&
    !document.querySelector('#pet-sheet').classList.contains('animated-sheet');
})()`;

async function verifyStopped(window) {
  await waitFor(window, stoppedExpression, 'stopped animation');
  assert.equal((await state(window)).activePet.battleMode, 'PAUSED');
  // This bounded observation asserts that motion stays stopped, not just one idle frame.
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    assert.equal(await evaluate(window, stoppedExpression), true, 'STOP must remain effective');
    await delay(25);
  }
}

async function verifyAttack(window, label) {
  const decodedAssets = `['#battle-background', '#enemy-image', '#pet-sheet'].every(selector => {
    const image = document.querySelector(selector);
    return image?.complete && image.naturalWidth > 0;
  })`;
  try {
    await waitFor(window, decodedAssets, 'background, enemy and pet assets decoded');
  } catch (error) {
    const diagnostics = await evaluate(
      window,
      `({url: location.href, notice: document.querySelector('#battle-notice')?.textContent,
        images: ['#battle-background', '#enemy-image', '#pet-sheet'].map(selector => {
          const image = document.querySelector(selector);
          return {selector, src: image?.src, complete: image?.complete,
            naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight};
        })})`,
    );
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }
  await waitForImpact(window);
  await petAction(window, 'STOP');
  await waitFor(
    window,
    'document.querySelector("[data-action=STOP]").textContent === "OFF"',
    'STOP response',
  );
  await verifyStopped(window);
  await petAction(window, 'START');
  await waitFor(window, 'document.querySelector("#pet-menu").hidden', 'START closes menu');
  await waitForImpact(window);
  assert.equal((await state(window)).activePet.battleMode, 'FIGHTING');
  await petAction(window, 'STOP');
  await waitFor(
    window,
    'document.querySelector("[data-action=STOP]").textContent === "OFF"',
    'second STOP response',
  );
  await verifyStopped(window);
  await petAction(window, 'ATTACK');
  await waitForImpact(window);
  await waitFor(
    window,
    'document.querySelector("#battle-overlay").dataset.petAction === "IDLE"',
    'manual attack completes',
  );
  await verifyStopped(window);
  console.log(`PASS ${label}: startup attack / STOP / START / manual attack / visible slash`);
}

async function verifyPet(window, pet, growthStatus = 'LINKED') {
  const snapshot = await state(window);
  assert.equal(snapshot.activePet.petId, pet.ownedPetId);
  assert.equal(snapshot.activePet.level, pet.level);
  assert.equal(snapshot.activePet.evolutionStage, pet.evolutionStage);
  assert.equal(snapshot.growthStatus, growthStatus);
  const stage = pet.evolutionStage + 1;
  const sheets = snapshot.petSprites[pet.ownedPetId];
  for (const motion of ['idle', 'attack']) {
    const expected = path.join(
      repo,
      'apps/desktop/renderer/assets/pets',
      pet.rarity.toLowerCase(),
      pet.sprite,
      `stage${stage}`,
      `pet_${pet.speciesId}_s${stage}_${motion}.png`,
    );
    assert.equal(fileURLToPath(sheets[motion].asset), expected);
    assert.ok(Number.isInteger(sheets[motion].frameCount) && sheets[motion].frameCount > 0);
    accessSync(expected);
  }
  await waitFor(
    window,
    `(() => {
      const image = document.querySelector('#pet-sheet');
      return image && image.complete && image.naturalWidth > 0 &&
        ${JSON.stringify([sheets.idle.asset, sheets.attack.asset])}.includes(image.src) &&
        !document.querySelector('#pet').hidden &&
        (${JSON.stringify(growthStatus)} === 'UNLINKED' || document.querySelector('#battle-notice').hidden);
    })()`,
    `rendered ${growthStatus} ${pet.sprite} stage ${stage}`,
  );
}

async function verifyRoomPet(window, view) {
  await verifyPet(
    window,
    {
      ownedPetId: view.ownedPetId,
      speciesId: view.petId,
      rarity: view.rarity,
      sprite: view.slug,
      level: view.level,
      evolutionStage: view.stage - 1,
    },
    'UNLINKED',
  );
  assert.equal((await state(window)).activePet.displayName, view.name);
  await waitFor(
    window,
    `(() => {
      const notice = document.querySelector('#battle-notice');
      return notice && !notice.hidden && Number(getComputedStyle(notice).opacity) > 0 &&
        notice.textContent === '성장 정보 연결 대기 · 모션 미리보기';
    })()`,
    'unlinked growth notice',
  );
}

async function capturePreview(window, name) {
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true });
  const image = await window.webContents.capturePage();
  const filePath = path.join(artifactDirectory, `${name}.png`);
  writeFileSync(filePath, image.toPNG());
  console.log(`ARTIFACT ${filePath}`);
}

async function nextAttackPose(window) {
  // A slow capturePage must not make a later, short pose disappear from the
  // screenshot test. Continuous recorders above still verify the full sequence.
  await waitFor(
    window,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase==='IDLE'",
    'previous pose completes',
  );
  await petAction(window, 'ATTACK');
}

async function captureHamsterPose(window, expression, name) {
  // capturePage can finish after a short beat has passed. Sample each pose in
  // its own attack; the separate continuous recorder verifies the full sequence.
  await petAction(window, 'ATTACK');
  await waitFor(window, expression, `hamster ${name}`);
  await capturePreview(window, name);
  await waitFor(
    window,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'IDLE' && document.querySelector('.hamster-food').hidden && getComputedStyle(document.querySelector('.pet-viewport')).visibility === 'visible'",
    'hamster clears and restores original',
  );
}

async function closeFromUi(window, label) {
  let onClosed;
  const closed = new Promise((resolve) => {
    onClosed = resolve;
    window.once('closed', onClosed);
  });
  try {
    await click(window, '.window-close');
    await within(closed, `${label} close button`, 3_000);
  } finally {
    window.removeListener('closed', onClosed);
  }
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  closeBattle?.();
  ipcMain.removeHandler('battle:open');
  for (const channel of ['room:scene', 'room:open', 'room:setActivePet']) {
    ipcMain.removeHandler(channel);
  }
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  database?.close();
  // The parent runner removes its profile after Electron releases Windows cache handles.
  if (!process.env.PETTO_BATTLE_TEST_PROFILE) rmSync(directory, { recursive: true, force: true });
}

const watchdog = setTimeout(() => {
  console.error('FAIL battle host smoke exceeded 180 seconds');
  try {
    cleanup();
  } finally {
    app.exit(1);
  }
}, 180_000);

async function run() {
  const desktop = (file) =>
    import(pathToFileURL(path.join(repo, 'apps/desktop/dist/main', file)).href);
  const [
    host,
    { SqliteFileDatabase },
    { APP_MIGRATIONS },
    { SqlitePetClient },
    { SqliteGrowthReadClient },
    { PetRepository },
    { PetGrowthRepository },
    { OVERLAY_GROWTH_RULES },
    { mountBattle },
    { PetClientRoomAdapter, RoomSelectionAdapter },
    { RoomState, mountRoom },
    { RoomCollectionPort },
  ] = await Promise.all([
    desktop('windows.js'),
    desktop('persistence/sqlite-file.js'),
    desktop('persistence/migrations/index.js'),
    desktop('clients/sqlite-pet-client.js'),
    desktop('clients/sqlite-growth-read-client.js'),
    desktop('persistence/repositories/pet-repository.js'),
    desktop('persistence/repositories/pet-growth-repository.js'),
    desktop('growth-rules.js'),
    import('@pet/battle/node'),
    import('@pet/room'),
    desktop('room.js'),
    desktop('collection.js'),
  ]);
  database = new SqliteFileDatabase({
    filePath: path.join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  const pets = new SqlitePetClient(new PetRepository(database));
  const growthRepository = new PetGrowthRepository(database);
  const growth = new SqliteGrowthReadClient(growthRepository);
  const roomPets = new PetClientRoomAdapter(pets);
  const [mole, initialGenericEpic, initialSprout, initialZebra, initialHamster, initialWizard] =
    pets.createOwnedPets(['003', '001', '004', '002', '005', '006']);
  const genericEpic = pets.updateGrowth(initialGenericEpic.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  pets.setActivePet(mole.ownedPetId);
  const room = new RoomState({ now: () => new Date() }, new RoomCollectionPort(), pets, () =>
    growthRepository.growth(),
  );
  const roomHost = { showRoom() {}, navigate() {}, broadcast: host.broadcast };
  growthRepository.adoptRoster(room.growthSeeds());
  const profiles = growthRepository.loadAll();
  Object.assign(profiles[genericEpic.ownedPetId].pet, {
    level: genericEpic.level,
    totalXp: genericEpic.totalXp,
    xpIntoLevel: genericEpic.xpIntoLevel,
    evolutionStage: genericEpic.evolutionStage,
  });
  growthRepository.saveAll(profiles);
  room.applyGrowth(growthRepository.growth(), roomHost);
  mountRoom(room, roomHost);
  closeBattle = mountBattle(roomPets, ipcMain, {
    growth,
    petAssetsDir: host.petAssetsDir,
    selection: new RoomSelectionAdapter(() => room.scene().pets),
    levelXpCosts: Array.from({ length: OVERLAY_GROWTH_RULES.maxLevel }, (_, i) =>
      OVERLAY_GROWTH_RULES.requiredXp(i + 1),
    ),
    isBattleSender: (id) => host.getBattleWindow()?.webContents.id === id,
    lifecycle: {
      onQuit(listener) {
        app.once('before-quit', listener);
        return () => app.removeListener('before-quit', listener);
      },
      onWindowClosed: host.subscribeBattleWindowClosed,
    },
  });
  let battleLoaded;
  ipcMain.handle('battle:open', () => {
    const window = host.createBattleWindow();
    battleLoaded = loaded(window);
  });
  const overlay = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(repo, 'apps/desktop/src/preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  await within(overlay.loadURL('about:blank'), 'overlay document load');
  await evaluate(overlay, `window.petApi.setActivePet(${JSON.stringify(mole.ownedPetId)})`);
  assert.equal(pets.getActivePet().ownedPetId, mole.ownedPetId);
  await evaluate(overlay, 'window.overlay.openBattle()');
  const battle = host.getBattleWindow();
  assert.ok(battle, 'overlay.openBattle must create the real host window');
  await battleLoaded;
  await waitFor(
    battle,
    'Boolean(window.petBattle && window.petBattle.execute)',
    'sandbox battle bridge',
  );
  assert.deepEqual(await evaluate(battle, '[typeof require, typeof process]'), [
    'undefined',
    'undefined',
  ]);
  await waitFor(battle, '!document.hidden', 'host battle window shown');
  assert.deepEqual(battle.getContentSize(), [640, 420]);
  await verifyPet(battle, mole);
  await evaluate(overlay, `window.petApi.setActivePet(${JSON.stringify(genericEpic.ownedPetId)})`);
  await verifyPet(battle, genericEpic);
  await capturePreview(battle, 'linked-room-epic');
  assert.equal(host.getBattleWindow(), battle, 'linked room selection updates the running window');
  assert.equal(pets.getActivePet().ownedPetId, genericEpic.ownedPetId);
  const sharedBefore = pets.listOwnedPets();
  const selectedRoomSnapshot = room.scene();
  await assert.rejects(
    command(battle, {
      type: 'GROWTH_XP_ADDED',
      petId: genericEpic.ownedPetId,
      amount: 99999,
      nowMs: 0,
    }),
    /허용하지/,
  );
  // The shared EPIC fixture is now a custom acorn squirrel. Generic fallback
  // coverage remains in the standalone host; this host exercises its real species.
  await petAction(battle, 'STOP');
  await waitFor(
    battle,
    "document.querySelector('[data-action=STOP]').textContent==='OFF'",
    'pause shared squirrel',
  );
  const linkedSquirrel = await recordSquirrelAttack(battle, 2, true);
  assert.equal(linkedSquirrel.impacts, 1);
  assert.equal(linkedSquirrel.invisible, 0);
  await petAction(battle, 'STOP');
  await verifyStopped(battle);
  await command(battle, { type: 'SET_DISPLAY_OPACITY', percent: 35 });
  assert.equal(
    pets.getOwnedPet(genericEpic.ownedPetId).totalXp,
    384,
    'battle controls must not grant owner XP',
  );
  assert.deepEqual(pets.listOwnedPets(), sharedBefore);
  assert.deepEqual(room.scene(), selectedRoomSnapshot);
  await closeFromUi(battle, 'host battle');
  assert.equal(overlay.isDestroyed(), false);
  assert.equal(host.getBattleWindow(), undefined);
  console.log(
    'PASS host selection / shared stage assets / growth write rejection / X closes only battle',
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const reopened = host.getBattleWindow();
  await battleLoaded;
  await verifyPet(reopened, genericEpic);
  await verifyStopped(reopened);
  assert.equal((await state(reopened)).preview.displayOpacity, 0.35);
  await closeFromUi(reopened, 'reopened host battle');
  console.log('PASS host lifecycle: window close/reopen preserves STOP and opacity');

  await evaluate(
    overlay,
    `window.petApi.setActivePet(${JSON.stringify(initialSprout.ownedPetId)})`,
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const sproutWindow = host.getBattleWindow();
  await battleLoaded;
  await command(sproutWindow, { type: 'SET_DISPLAY_OPACITY', percent: 100 });
  for (const evolutionStage of [0, 1, 2]) {
    const profiles = growthRepository.loadAll();
    Object.assign(profiles[initialSprout.ownedPetId].pet, {
      level: 40,
      evolutionStage,
      totalXp: 0,
    });
    growthRepository.saveAll(profiles);
    room.applyGrowth(growthRepository.growth(), roomHost);
    await verifyPet(sproutWindow, pets.getOwnedPet(initialSprout.ownedPetId));
    const before = await state(sproutWindow);
    await command(sproutWindow, { type: 'PREVIEW_PET', action: 'ATTACK', nowMs: Date.now() });
    await waitFor(
      sproutWindow,
      "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'ROOT_STRIKE' && document.querySelector('#battle-overlay').dataset.beat === 'IMPACT' && !document.querySelector('.sprout-roots').hidden",
      `sprout stage ${evolutionStage + 1} root strike`,
    );
    const pixels = await evaluate(
      sproutWindow,
      `(() => {
      const canvas = document.querySelector('.sprout-roots');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.filter((value, index) => index % 4 === 3 && value > 0).length;
    })()`,
    );
    assert.ok(pixels > 0, 'root attack must render visible hard pixels');
    await capturePreview(sproutWindow, `sprout-stage${evolutionStage + 1}-roots`);
    await waitFor(
      sproutWindow,
      "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'IDLE' && document.querySelector('.sprout-roots').hidden",
      'sprout one-shot retracts and clears roots',
    );
    const after = await state(sproutWindow);
    assert.equal(after.activePet.syncedTotalXp, before.activePet.syncedTotalXp);
    assert.equal(after.enemyHpRatio, before.enemyHpRatio);
    assert.equal(after.activePet.stage, before.activePet.stage);
  }
  await command(sproutWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  await command(sproutWindow, { type: 'PREVIEW_PET', action: 'ATTACK', nowMs: Date.now() });
  await waitFor(
    sproutWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'ROOT_STRIKE'",
    'reduced sprout retains attack timing',
  );
  assert.equal(
    await evaluate(sproutWindow, "document.querySelector('.sprout-roots').hidden"),
    true,
  );
  await closeFromUi(sproutWindow, 'sprout battle');
  console.log(
    'PASS sprout stages 1/2/3: visible roots / one-shot recovery / no XP or HP writes / reduced motion',
  );

  await evaluate(overlay, `window.petApi.setActivePet(${JSON.stringify(initialZebra.ownedPetId)})`);
  await evaluate(overlay, 'window.overlay.openBattle()');
  const zebraWindow = host.getBattleWindow();
  await battleLoaded;
  await command(zebraWindow, { type: 'SET_DISPLAY_OPACITY', percent: 100 });
  if ((await state(zebraWindow)).preview.reducedMotion)
    await command(zebraWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  await waitFor(
    zebraWindow,
    `(() => {
        const root = document.querySelector('#battle-overlay');
        const viewport = document.querySelector('.pet-viewport');
        const image = document.querySelector('#pet-sheet');
        return root.dataset.petAnimation === 'zebra' && root.dataset.petCombatPhase === 'IDLE' &&
          getComputedStyle(viewport).visibility === 'visible' &&
          image.complete && image.naturalWidth > 0;
      })()`,
    'zebra original sprite stays visible while its custom attack canvas is idle',
  );
  let previousWavePixels = 0;
  for (const evolutionStage of [0, 1, 2]) {
    const profiles = growthRepository.loadAll();
    Object.assign(profiles[initialZebra.ownedPetId].pet, {
      level: 40,
      evolutionStage,
      totalXp: 0,
    });
    growthRepository.saveAll(profiles);
    room.applyGrowth(growthRepository.growth(), roomHost);
    const zebra = pets.getOwnedPet(initialZebra.ownedPetId);
    await verifyPet(zebraWindow, zebra);
    await petAction(zebraWindow, 'STOP');
    await waitFor(
      zebraWindow,
      "document.querySelector('[data-action=STOP]').textContent === 'OFF'",
      'pause zebra before manual recording',
    );
    const before = await state(zebraWindow);
    const recording = await recordZebraAttack(zebraWindow, evolutionStage + 1);
    assert.equal(
      recording.bodyChangedMax,
      0,
      'every torso pixel must stay identical throughout the actual UI attack',
    );
    assert.equal(recording.invisibleFrames, 0, 'zebra must never disappear during the attack');
    assert.equal(recording.landings.length, 2, 'UI attack must land the left hoof exactly twice');
    assert.ok(
      recording.landings[1] - recording.landings[0] >= 240,
      'hoof stomps need two distinct beats',
    );
    assert.equal(recording.sources.length, 1, 'attack must not swap the pet image source');
    assert.ok(recording.forwardAt >= recording.landings[1], 'forward pop begins after both stomps');
    assert.ok(
      recording.maxScale > 1.08 && recording.maxScale < 1.12,
      'the visible sprite briefly approaches the viewer',
    );
    assert.ok(
      recording.forwardEndedAt !== null && recording.waveAt >= recording.forwardEndedAt,
      'wave follows the forward pop recovery',
    );
    await petAction(zebraWindow, 'ATTACK');
    const stage = evolutionStage + 1;
    await waitFor(
      zebraWindow,
      `(() => {
        const root = document.querySelector('#battle-overlay');
        const hoof = document.querySelector('.zebra-native-sprite');
        const body = document.querySelector('.pet-body-clip');
        const viewport = document.querySelector('.pet-viewport');
        const pixels = hoof.getContext('2d').getImageData(0, 0, 32, 32).data;
        let visible = false;
        for (let alpha = 3; alpha < pixels.length; alpha += 4) visible ||= pixels[alpha] > 0;
        return root.dataset.petAnimation === 'zebra' && Number(hoof.dataset.hoofLift) > 0.8 &&
            Number(hoof.dataset.frameIndex) === 0 &&
          !document.querySelector('#pet').hidden && Number(hoof.style.opacity) === 1 && visible &&
            getComputedStyle(body).transform === 'none' &&
            getComputedStyle(viewport).visibility === 'hidden';
      })()`,
      `zebra stage ${stage} isolates its left hoof from the torso`,
    );
    await capturePreview(zebraWindow, `zebra-stage${stage}-left-hoof-lift`);
    await nextAttackPose(zebraWindow);
    await waitFor(
      zebraWindow,
      `document.querySelector('#battle-overlay').dataset.petCombatPhase === 'ZEBRA_APPROACH' && Number(document.querySelector('#pet').style.getPropertyValue('--zebra-forward-scale')) > 1.08`,
      `zebra stage ${stage} viewer-facing pop`,
    );
    await capturePreview(zebraWindow, `zebra-stage${stage}-front-pop`);
    await nextAttackPose(zebraWindow);
    await waitFor(
      zebraWindow,
      `(() => {
        const root = document.querySelector('#battle-overlay');
        const canvas = document.querySelector('.zebra-shockwave');
        const image = document.querySelector('#pet-sheet');
        return root.dataset.petAnimation === 'zebra' &&
          root.dataset.petCombatPhase === 'ZEBRA_WAVE' &&
          !canvas.hidden && image.complete && image.naturalWidth > 0 &&
            image.currentSrc.endsWith('pet_002_s${stage}_idle.png');
      })()`,
      `zebra stage ${stage} hoof stomp and shockwave`,
    );
    const effect = await evaluate(
      zebraWindow,
      `(() => {
        const canvas = document.querySelector('.zebra-shockwave');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const xs = [], ys = [];
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] > 0) { xs.push(x); ys.push(y); }
        }
        return { count: xs.length, height: Math.max(...ys) - Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) };
      })()`,
    );
    assert.ok(effect.count > 0, 'captured wave has visible pixels');
    // Compare the continuous attack maxima, not different moments in a growing wave.
    assert.ok(
      recording.maxWavePixels > previousWavePixels,
      `stage ${stage} adds visible shockwave details`,
    );
    previousWavePixels = recording.maxWavePixels;
    if (stage === 3)
      assert.ok(recording.maxWaveHeight >= 60, 'stage 3 renders a tall crescent arc');
    await capturePreview(zebraWindow, `zebra-stage${stage}-shockwave`);
    await waitFor(
      zebraWindow,
      `(() => {
        const root = document.querySelector('#battle-overlay');
        const viewport = document.querySelector('.pet-viewport');
        return root.dataset.petCombatPhase === 'IDLE' &&
          document.querySelector('.zebra-shockwave').hidden &&
          getComputedStyle(viewport).visibility === 'visible';
      })()`,
      `zebra stage ${stage} attack clears`,
    );
    const after = await state(zebraWindow);
    assert.equal(after.activePet.syncedTotalXp, before.activePet.syncedTotalXp);
    assert.equal(after.enemyHpRatio, before.enemyHpRatio);
    assert.equal(after.activePet.stage, before.activePet.stage);
  }
  const automaticRecording = await recordZebraAttack(zebraWindow, 3, true);
  assert.equal(
    automaticRecording.bodyChangedMax,
    0,
    'automatic attack must keep every torso pixel fixed',
  );
  assert.equal(automaticRecording.landings.length, 2, 'automatic attack must stomp exactly twice');
  assert.ok(automaticRecording.landings[1] - automaticRecording.landings[0] >= 240);
  assert.equal(automaticRecording.invisibleFrames, 0);
  assert.ok(automaticRecording.forwardAt >= automaticRecording.landings[1]);
  assert.ok(automaticRecording.maxScale > 1.08 && automaticRecording.maxScale < 1.12);
  assert.ok(
    automaticRecording.forwardEndedAt !== null &&
      automaticRecording.waveAt >= automaticRecording.forwardEndedAt,
  );
  await petAction(zebraWindow, 'STOP');
  await waitFor(
    zebraWindow,
    "document.querySelector('[data-action=STOP]').textContent === 'OFF'",
    'stop automatic zebra after recording',
  );
  await command(zebraWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  await petAction(zebraWindow, 'ATTACK');
  await waitFor(
    zebraWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'ZEBRA_WAVE' && document.querySelector('#battle-overlay').dataset.beat === 'IMPACT'",
    'reduced zebra retains hoof contact',
  );
  assert.equal(
    await evaluate(zebraWindow, "document.querySelector('.zebra-shockwave').hidden"),
    true,
  );
  await closeFromUi(zebraWindow, 'zebra battle');
  console.log(
    'PASS zebra stages 1/2/3: manual and automatic double hoof stomp / unchanged torso pixels / striped shockwave / recovery / no XP or HP writes / reduced motion',
  );

  await evaluate(
    overlay,
    `window.petApi.setActivePet(${JSON.stringify(initialHamster.ownedPetId)})`,
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const hamsterWindow = host.getBattleWindow();
  await battleLoaded;
  await command(hamsterWindow, { type: 'SET_DISPLAY_OPACITY', percent: 100 });
  if ((await state(hamsterWindow)).preview.reducedMotion)
    await command(hamsterWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  for (const evolutionStage of [0, 1, 2]) {
    const profiles = growthRepository.loadAll();
    Object.assign(profiles[initialHamster.ownedPetId].pet, {
      level: 40,
      evolutionStage,
      totalXp: 0,
    });
    growthRepository.saveAll(profiles);
    room.applyGrowth(growthRepository.growth(), roomHost);
    await verifyPet(hamsterWindow, pets.getOwnedPet(initialHamster.ownedPetId));
    await petAction(hamsterWindow, 'STOP');
    await waitFor(
      hamsterWindow,
      "document.querySelector('[data-action=STOP]').textContent === 'OFF'",
      'pause hamster',
    );
    const before = await state(hamsterWindow);
    const report = await recordHamsterAttack(hamsterWindow, evolutionStage + 1);
    assert.equal(report.fixedChangedMax, 0, 'every torso, foot, ear and eye pixel stays fixed');
    assert.equal(report.invisibleFrames, 0);
    assert.equal(report.maxPuff, 1);
    assert.ok(
      report.maxHop >= 21 &&
        report.maxRecoil >= 9 &&
        report.maxTilt >= 6 &&
        report.minScaleY < 0.91,
      'hamster visibly crouches, jumps, recoils and lands',
    );
    assert.deepEqual(report.endProjection, [0, 0, 1, 1, 0], 'whole-body motion resets at the end');
    assert.equal(report.shots, 1);
    assert.equal(report.impacts, 1);
    assert.equal(report.foodVisible, true);
    assert.equal(report.burstVisible, true);
    assert.deepEqual(report.phases, [
      'HAMSTER_PUFF',
      'HAMSTER_HOLD',
      'HAMSTER_FIRE',
      'HAMSTER_BURST',
      'HAMSTER_RECOVER',
    ]);
    assert.equal(report.sources.length, 1);
    assert.ok(report.sources[0].endsWith(`pet_005_s${evolutionStage + 1}_idle.png`));
    for (const [name, expression] of [
      [
        'puff',
        "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_HOLD' && document.querySelector('.hamster-native-sprite').dataset.cheekPuff === '1'",
      ],
      [
        'recoil',
        "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_FIRE' && Number.parseFloat(document.querySelector('#pet').style.getPropertyValue('--hamster-x')) <= -9 && Number.parseFloat(document.querySelector('#pet').style.getPropertyValue('--hamster-tilt')) <= -6",
      ],
      [
        'food',
        "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_FIRE' && Number(document.querySelector('.hamster-food').dataset.flight) > 0.55 && !document.querySelector('.hamster-food').hidden",
      ],
      [
        'burst',
        "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_BURST' && !document.querySelector('.hamster-food').hidden",
      ],
      [
        'landing',
        "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_BURST' && Number(document.querySelector('#pet').style.getPropertyValue('--hamster-sy')) < 0.9",
      ],
    ])
      await captureHamsterPose(
        hamsterWindow,
        expression,
        `hamster-stage${evolutionStage + 1}-${name}`,
      );
    const after = await state(hamsterWindow);
    assert.equal(after.activePet.syncedTotalXp, before.activePet.syncedTotalXp);
    assert.equal(after.enemyHpRatio, before.enemyHpRatio);
    assert.equal(after.activePet.stage, before.activePet.stage);
  }
  const hamsterAutomatic = await recordHamsterAttack(hamsterWindow, 3, true);
  assert.equal(hamsterAutomatic.fixedChangedMax, 0);
  assert.equal(hamsterAutomatic.invisibleFrames, 0);
  assert.equal(hamsterAutomatic.shots, 1);
  assert.equal(hamsterAutomatic.impacts, 1);
  assert.ok(
    hamsterAutomatic.maxHop > 0 &&
      hamsterAutomatic.maxTilt >= 6 &&
      hamsterAutomatic.minScaleY < 0.91,
  );
  assert.deepEqual(hamsterAutomatic.endProjection, [0, 0, 1, 1, 0]);
  await waitFor(
    hamsterWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_FIRE' && Number(document.querySelector('.hamster-food').dataset.flight) > 0.55 && document.querySelector('#pet-menu').hidden",
    'automatic hamster shot with menu closed',
  );
  await capturePreview(hamsterWindow, 'hamster-stage3-automatic-food');
  await petAction(hamsterWindow, 'STOP');
  await waitFor(
    hamsterWindow,
    "document.querySelector('[data-action=STOP]').textContent === 'OFF'",
    'stop hamster automatic',
  );
  await petAction(hamsterWindow, 'ATTACK');
  await waitFor(
    hamsterWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'HAMSTER_HOLD'",
    'cancel puff mid-attack',
  );
  await petAction(hamsterWindow, 'STOP');
  await waitFor(
    hamsterWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase === 'IDLE' && document.querySelector('.hamster-food').hidden && document.querySelector('.hamster-native-sprite').style.opacity === '0' && getComputedStyle(document.querySelector('.pet-viewport')).visibility === 'visible'",
    'STOP restores original hamster',
  );
  await command(hamsterWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  const reducedHamster = await recordHamsterAttack(hamsterWindow, 3);
  assert.equal(reducedHamster.fixedChangedMax, 0);
  assert.equal(reducedHamster.maxPuff, 0);
  assert.equal(reducedHamster.maxHop, 0);
  assert.equal(reducedHamster.maxRecoil, 0);
  assert.equal(reducedHamster.maxTilt, 0);
  assert.equal(reducedHamster.minScaleY, 1);
  assert.equal(reducedHamster.foodVisible, false);
  assert.equal(reducedHamster.burstVisible, false);
  assert.equal(reducedHamster.impacts, 1);
  await closeFromUi(hamsterWindow, 'hamster battle');
  console.log(
    'PASS hamster stages 1/2/3: crouch / hop / cannon recoil / landing / native pixels preserved / single shot and hit / manual and automatic / STOP and reduced motion / unchanged XP and HP',
  );

  await evaluate(
    overlay,
    `window.petApi.setActivePet(${JSON.stringify(initialWizard.ownedPetId)})`,
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const wizardWindow = host.getBattleWindow();
  await battleLoaded;
  await command(wizardWindow, { type: 'SET_DISPLAY_OPACITY', percent: 100 });
  if ((await state(wizardWindow)).preview.reducedMotion)
    await command(wizardWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  for (const evolutionStage of [0, 1, 2]) {
    const profiles = growthRepository.loadAll();
    Object.assign(profiles[initialWizard.ownedPetId].pet, {
      level: 40,
      evolutionStage,
      totalXp: 0,
    });
    growthRepository.saveAll(profiles);
    room.applyGrowth(growthRepository.growth(), roomHost);
    await verifyPet(wizardWindow, pets.getOwnedPet(initialWizard.ownedPetId));
    await petAction(wizardWindow, 'STOP');
    await waitFor(
      wizardWindow,
      "document.querySelector('[data-action=STOP]').textContent==='OFF'",
      'pause wizard',
    );
    const before = await state(wizardWindow),
      report = await recordWizardAttack(wizardWindow, evolutionStage + 1);
    assert.equal(report.size, evolutionStage === 2 ? 48 : 32);
    assert.equal(report.invisible, 0);
    assert.equal(report.faceChanges, 0);
    assert.equal(report.impacts, 1);
    assert.ok(report.maxMeteors > 0 && report.maxMeteors <= 24);
    assert.ok(report.maxLift >= 24);
    assert.equal(report.maxCast, 1);
    assert.deepEqual(report.coverage, [true, true, true, true]);
    assert.equal(report.cleared, true);
    assert.equal(report.finalY, 0);
    assert.deepEqual(report.phases, [
      'WIZARD_CHARGE',
      'WIZARD_CAST',
      'WIZARD_RAIN',
      'WIZARD_FINISH',
      'WIZARD_BURST',
      'WIZARD_RETURN',
    ]);
    assert.equal(report.sources.length, 1);
    assert.ok(report.sources[0].endsWith(`pet_006_s${evolutionStage + 1}_idle.png`));
    for (const [phase, label, at] of [
      ['WIZARD_RAIN', 'rain', 1350],
      ['WIZARD_FINISH', 'meteor', 2050],
      ['WIZARD_BURST', 'burst', 2400],
    ]) {
      await nextAttackPose(wizardWindow);
      await waitFor(
        wizardWindow,
        `document.querySelector('#battle-overlay').dataset.petCombatPhase==='${phase}' && Number(document.querySelector('.wizard-meteors').dataset.spellMs)>=${at}`,
        'wizard ' + label,
      );
      await capturePreview(wizardWindow, `wizard-stage${evolutionStage + 1}-${label}`);
    }
    await waitFor(
      wizardWindow,
      "document.querySelector('#battle-overlay').dataset.petCombatPhase==='IDLE'&&document.querySelector('.wizard-sky').hidden&&document.querySelector('.wizard-meteors').hidden",
      'wizard spell clears',
    );
    const after = await state(wizardWindow);
    assert.equal(after.activePet.syncedTotalXp, before.activePet.syncedTotalXp);
    assert.equal(after.enemyHpRatio, before.enemyHpRatio);
    assert.equal(after.activePet.stage, before.activePet.stage);
  }
  const wizardAutomatic = await recordWizardAttack(wizardWindow, 3, true);
  assert.equal(wizardAutomatic.impacts, 1);
  assert.equal(wizardAutomatic.invisible, 0);
  assert.deepEqual(wizardAutomatic.coverage, [true, true, true, true]);
  assert.equal(wizardAutomatic.cleared, true);
  await petAction(wizardWindow, 'STOP');
  await waitFor(
    wizardWindow,
    "document.querySelector('[data-action=STOP]').textContent==='OFF'",
    'pause wizard after auto',
  );
  await petAction(wizardWindow, 'ATTACK');
  await waitFor(
    wizardWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase==='WIZARD_RAIN'",
    'cancel live meteor rain',
  );
  await petAction(wizardWindow, 'STOP');
  await waitFor(
    wizardWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase==='IDLE'&&document.querySelector('.wizard-sky').hidden&&document.querySelector('.wizard-meteors').hidden&&getComputedStyle(document.querySelector('.pet-viewport')).visibility==='visible'",
    'STOP clears wizard weather and restores pet',
  );
  await command(wizardWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  const wizardReduced = await recordWizardAttack(wizardWindow, 3);
  assert.equal(wizardReduced.impacts, 1);
  assert.equal(wizardReduced.maxMeteors, 0);
  assert.equal(wizardReduced.maxLift, 0);
  assert.equal(wizardReduced.invisible, 0);
  await closeFromUi(wizardWindow, 'wizard battle');
  console.log(
    'PASS wizard stages 1/2/3: native 32/48px forms / full-width meteor rain / single main hit / manual and automatic / STOP and reduced motion / unchanged HP and XP',
  );

  await evaluate(
    overlay,
    `window.petApi.setActivePet(${JSON.stringify(initialGenericEpic.ownedPetId)})`,
  );
  await evaluate(overlay, 'window.overlay.openBattle()');
  const squirrelWindow = host.getBattleWindow();
  await battleLoaded;
  await command(squirrelWindow, { type: 'SET_DISPLAY_OPACITY', percent: 100 });
  if ((await state(squirrelWindow)).preview.reducedMotion)
    await command(squirrelWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  for (const evolutionStage of [0, 1, 2]) {
    const profiles = growthRepository.loadAll();
    Object.assign(profiles[initialGenericEpic.ownedPetId].pet, {
      level: 40,
      evolutionStage,
      totalXp: 0,
    });
    growthRepository.saveAll(profiles);
    room.applyGrowth(growthRepository.growth(), roomHost);
    await verifyPet(squirrelWindow, pets.getOwnedPet(initialGenericEpic.ownedPetId));
    await petAction(squirrelWindow, 'STOP');
    await waitFor(
      squirrelWindow,
      "document.querySelector('[data-action=STOP]').textContent==='OFF'",
      'pause squirrel',
    );
    const before = await state(squirrelWindow),
      report = await recordSquirrelAttack(squirrelWindow, evolutionStage + 1);
    assert.equal(report.size, evolutionStage === 2 ? 48 : 32);
    assert.equal(report.invisible, 0);
    assert.equal(report.faceChanges, 0);
    assert.equal(report.impacts, 1);
    assert.equal(report.maxClones, 2 + evolutionStage);
    assert.ok(report.maxBlades > 0 && report.maxBlades <= 24);
    assert.ok(report.maxLeap >= 24);
    assert.equal(report.maxSweep, 1);
    assert.deepEqual(report.coverage, [true, true, true, true]);
    assert.equal(report.cleared, true);
    assert.equal(report.finalY, 0);
    assert.deepEqual(report.phases, [
      'SQUIRREL_SIGN',
      'SQUIRREL_DOMAIN',
      'SQUIRREL_CLONES',
      'SQUIRREL_SEAL',
      'SQUIRREL_BURST',
      'SQUIRREL_RETURN',
    ]);
    assert.equal(report.sources.length, 1);
    assert.ok(report.sources[0].endsWith(`pet_001_s${evolutionStage + 1}_idle.png`));
    for (const [phase, label, at] of [
      ['SQUIRREL_CLONES', 'forest', 1250],
      ['SQUIRREL_SEAL', 'seal', 2100],
      ['SQUIRREL_BURST', 'burst', 2480],
    ]) {
      await nextAttackPose(squirrelWindow);
      await waitFor(
        squirrelWindow,
        `document.querySelector('#battle-overlay').dataset.petCombatPhase==='${phase}'&&Number(document.querySelector('.squirrel-storm').dataset.spellMs)>=${at}`,
        'squirrel ' + label,
      );
      await capturePreview(squirrelWindow, `squirrel-stage${evolutionStage + 1}-${label}`);
    }
    await waitFor(
      squirrelWindow,
      "document.querySelector('#battle-overlay').dataset.petCombatPhase==='IDLE'&&document.querySelector('.squirrel-grove').hidden&&document.querySelector('.squirrel-storm').hidden",
      'squirrel clears',
    );
    const after = await state(squirrelWindow);
    assert.equal(after.activePet.syncedTotalXp, before.activePet.syncedTotalXp);
    assert.equal(after.enemyHpRatio, before.enemyHpRatio);
    assert.equal(after.activePet.stage, before.activePet.stage);
  }
  const squirrelAuto = await recordSquirrelAttack(squirrelWindow, 3, true);
  assert.equal(squirrelAuto.impacts, 1);
  assert.equal(squirrelAuto.invisible, 0);
  assert.equal(squirrelAuto.maxClones, 4);
  assert.equal(squirrelAuto.cleared, true);
  await petAction(squirrelWindow, 'STOP');
  await waitFor(
    squirrelWindow,
    "document.querySelector('[data-action=STOP]').textContent==='OFF'",
    'pause squirrel after auto',
  );
  await petAction(squirrelWindow, 'ATTACK');
  await waitFor(
    squirrelWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase==='SQUIRREL_CLONES'",
    'cancel live forest',
  );
  await petAction(squirrelWindow, 'STOP');
  await waitFor(
    squirrelWindow,
    "document.querySelector('#battle-overlay').dataset.petCombatPhase==='IDLE'&&document.querySelector('.squirrel-grove').hidden&&document.querySelector('.squirrel-storm').hidden&&getComputedStyle(document.querySelector('.pet-viewport')).visibility==='visible'",
    'STOP clears forest and restores pet',
  );
  await command(squirrelWindow, { type: 'TOGGLE_REDUCED_MOTION' });
  const squirrelReduced = await recordSquirrelAttack(squirrelWindow, 3);
  assert.equal(squirrelReduced.impacts, 1);
  assert.equal(squirrelReduced.maxClones, 0);
  assert.equal(squirrelReduced.maxBlades, 0);
  assert.equal(squirrelReduced.maxLeap, 0);
  assert.equal(squirrelReduced.invisible, 0);
  await closeFromUi(squirrelWindow, 'squirrel battle');
  console.log(
    'PASS squirrel stages 1/2/3: native face / forest domain / 2-3-4 clones / crossed acorn blades / tail seal / single hit / manual and automatic / STOP and reduced motion / unchanged HP and XP',
  );

  const standalone = new BrowserWindow({
    width: 640,
    height: 420,
    useContentSize: true,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist/ui/preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  await within(
    standalone.loadFile(path.join(__dirname, '../dist/ui/index.html')),
    'standalone document load',
  );
  standalone.show();
  await waitFor(
    standalone,
    'Boolean(window.petBattle) && !document.hidden',
    'standalone Electron bridge',
  );
  await verifyAttack(standalone, 'Electron standalone');
  await closeFromUi(standalone, 'standalone battle');
  assert.equal(overlay.isDestroyed(), false);
  console.log('PASS Electron standalone: X closes only battle window');
}

app
  .whenReady()
  .then(run)
  .then(() => {
    clearTimeout(watchdog);
    cleanup();
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(watchdog);
    console.error(error);
    try {
      cleanup();
    } finally {
      app.exit(1);
    }
  });
