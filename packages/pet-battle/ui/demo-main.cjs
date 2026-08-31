const fs = require('node:fs');
const path = require('node:path');

const { app, BrowserWindow } = require('electron');

function capturePathFromArguments() {
  const index = process.argv.indexOf('--capture');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 360,
    height: 180,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => {
    window.show();
    const capturePath = capturePathFromArguments();
    if (!capturePath) return;
    setTimeout(() => {
      void window.webContents.capturePage().then((image) => {
        fs.writeFileSync(capturePath, image.toPNG());
        app.quit();
      });
    }, 300);
  });
  void window.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
