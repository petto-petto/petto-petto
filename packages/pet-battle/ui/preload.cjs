const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { contextBridge } = require('electron');

const client = import(
  pathToFileURL(path.join(__dirname, '..', 'app', 'battle-engine.js')).href
).then(async ({ ElectronBattleEngine }) => {
  const engine = new ElectronBattleEngine();
  // Explicit demo-only roster; the real host always uses owner snapshots.
  for (const [petId, displayName, rarity] of [
    ['mio', '미오', 'COMMON'],
    ['lumi', '루미', 'RARE'],
    ['nova', '노바', 'EPIC'],
    ['mori', '모리', 'COMMON'],
  ]) {
    await engine.execute({
      type: 'UPSERT_PET',
      petId,
      displayName,
      rarity,
      level: 1,
      sprite: '',
      evolutionStage: 0,
    });
  }
  await engine.execute({ type: 'SET_PET_SPECTATORS', petIds: ['lumi', 'nova', 'mori'] });
  return engine;
});

contextBridge.exposeInMainWorld('petBattle', {
  execute(command) {
    return client.then((battle) => battle.execute(command));
  },
});
