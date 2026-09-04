// Electron 메인 — 투명·항상최상단·클릭통과 오버레이 창
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { applyStationaryCollectionBehavior } = require('./mac-window.cjs');
const { SqliteFileDatabase } = require('./database/sqlite-file.cjs');
const { PetGrowthRepository } = require('./persistence/pet-growth-repository.cjs');
const { registerGrowthIpc } = require('./ipc/growth-ipc.cjs');

const DEV = !!process.env.ELECTRON_DEV;

let win = null;
let growthRepository = null;

// ---- 창 위치·모니터 기억 (userData 에 좌표 저장) ----
const STATE_FILE = 'overlay-state.json';
function statePath() {
  return path.join(app.getPath('userData'), STATE_FILE);
}
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}
function saveWindowState(bounds) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ x: bounds.x, y: bounds.y }));
  } catch {
    /* ignore */
  }
}
// 저장 좌표가 현재 연결된 디스플레이 안에 있는지(창 중심 기준). 모니터 분리/재배치 시 화면 밖 방지.
function isVisibleOn(bounds) {
  const cx = bounds.x + bounds.width / 2,
    cy = bounds.y + bounds.height / 2;
  return screen.getAllDisplays().some((d) => {
    const r = d.bounds;
    return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
  });
}

function createWindow() {
  // 펫을 담는 작은 투명 창. 드래그하면 창 자체가 이동 → 다른 모니터로도 넘어감(스팬 아님, macOS 제약 없음).
  const { workArea } = screen.getPrimaryDisplay();
  const W = 460,
    H = 520;
  // 기본은 기본 모니터 우하단. 저장된 위치가 있고 현재 디스플레이 안이면 복원(모니터도 함께 복원됨).
  let pos = { x: workArea.x + workArea.width - W, y: workArea.y + workArea.height - H };
  const saved = loadWindowState();
  if (
    saved &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    isVisibleOn({ x: saved.x, y: saved.y, width: W, height: H })
  ) {
    pos = { x: saved.x, y: saved.y };
  }
  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: W,
    height: H,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 기본은 클릭 통과(forward: 이동 이벤트는 계속 받아 렌더러가 hit-test). 펫/메뉴 위에서만 입력 활성화.
  win.setIgnoreMouseEvents(true, { forward: true });

  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // macOS: NSWindow 를 stationary 로 만들어 배경 클릭/Show Desktop 에도 안 사라지게 (koffi FFI, Clawd 방식)
  if (process.platform === 'darwin') {
    const applyStationary = () => applyStationaryCollectionBehavior(win);
    applyStationary();
    win.once('ready-to-show', applyStationary);
    win.webContents.once('did-finish-load', applyStationary);
  }
}

ipcMain.on('set-interactive', (_e, interactive) => {
  if (win) win.setIgnoreMouseEvents(!interactive, { forward: true });
});

// 드래그 = 창 이동 (스크린 절대 좌표 기준). 다른 모니터로도 이동 가능.
let dragOrigin = null;
ipcMain.on('drag-start', (_e, p) => {
  if (!win) return;
  const b = win.getBounds();
  dragOrigin = { wx: b.x, wy: b.y, sx: p.sx, sy: p.sy };
});
ipcMain.on('drag-move', (_e, p) => {
  if (!win || !dragOrigin) return;
  const b = win.getBounds();
  let x = dragOrigin.wx + (p.sx - dragOrigin.sx);
  let y = dragOrigin.wy + (p.sy - dragOrigin.sy);
  // 모든 디스플레이(union) 안에서 창 "중심"이 유지되도록 clamp → 어느 모니터로든 이동 가능, 완전 이탈 방지
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const d of screen.getAllDisplays()) {
    const r = d.bounds;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX !== Infinity) {
    x = Math.max(minX - b.width / 2, Math.min(x, maxX - b.width / 2));
    y = Math.max(minY - b.height / 2, Math.min(y, maxY - b.height / 2));
  }
  win.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on('drag-end', () => {
  dragOrigin = null;
  if (win) saveWindowState(win.getBounds()); // 이동 끝나면 현재 위치 기억
});

ipcMain.on('overlay-quit', () => app.quit());

app.whenReady().then(() => {
  const database = new SqliteFileDatabase({
    filePath: path.join(app.getPath('userData'), 'pet-overlay.sqlite'),
  });
  growthRepository = new PetGrowthRepository(database);
  growthRepository.open();
  registerGrowthIpc(growthRepository);
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', () => {
  growthRepository?.close();
});
