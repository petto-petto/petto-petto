// 오프스크린(show:false) 캡처 스크립트 — 프로토타입 비주얼 QA용
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.env.SHOT_DIR || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);

async function shot(win, name) {
  const img = await win.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name, img.getSize());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 560, height: 600, show: false,
    backgroundColor: '#0a0d18',
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await sleep(1800);

  await shot(win, 'shot-idle.png');

  // dev 패널 열고 +200 XP
  await js(win, `(()=>{document.querySelector('.dev-toggle')?.click();return 1})()`);
  await sleep(150);
  await js(win, `(()=>{const b=[...document.querySelectorAll('.dev-btns button')].find(x=>x.textContent.includes('+200'));b&&b.click();return 1})()`);
  await sleep(400);

  // 우클릭(contextmenu) → 원형 메뉴
  await js(win, `(()=>{const p=document.querySelector('.pet');p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return 1})()`);
  await sleep(450);
  await shot(win, 'shot-menu.png');

  // 메뉴 닫고 진화 실행 → VFX
  await js(win, `(()=>{const p=document.querySelector('.pet');p.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));return 1})()`);
  await sleep(150);
  const evo = await js(win, `(()=>{const b=[...document.querySelectorAll('.dev-btns button')].find(x=>x.textContent.includes('진화 실행'));if(b&&!b.disabled){b.click();return 'evolve'}return 'disabled'})()`);
  console.log('evolve:', evo);
  await sleep(500);
  await shot(win, 'shot-evolve.png');

  await sleep(50);
  app.quit();
});

setTimeout(() => app.quit(), 20000);
