const { ipcMain } = require('electron');

/** renderer가 사용할 성장 저장 API를 명시적인 세 채널로만 제한한다. */
function registerGrowthIpc(repository) {
  ipcMain.handle('growth:hydrate', (_event, legacySnapshots) =>
    repository.hydrate(legacySnapshots),
  );
  ipcMain.handle('growth:save-all', (_event, snapshots) => {
    repository.saveAll(snapshots);
  });
  ipcMain.handle('growth:clear-all', () => {
    repository.clearAll();
  });
  ipcMain.handle('overlay:load-state', () => repository.loadOverlayState());
  ipcMain.handle('overlay:save-state', (_event, state) => {
    repository.saveOverlayState(state);
  });
}

module.exports = { registerGrowthIpc };
