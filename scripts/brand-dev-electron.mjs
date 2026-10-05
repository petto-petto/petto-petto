/**
 * 개발용 `Electron.app`을 Petto Petto 앱처럼 보이게 한다. `npm install` 뒤에 자동 실행된다.
 *
 * 왜 필요한가: 패키징하지 않고 `electron`으로 띄우면 macOS 는 `node_modules/electron/dist/
 * Electron.app` 번들의 `Info.plist`로 앱을 알아본다. 그래서 Dock 이름은 "Electron", 활성 상태
 * 보기·Finder 아이콘은 Electron 기본 아이콘이 된다. 실행 중의 `app.setName`·`app.dock.setIcon`
 * 으로는 이 둘이 바뀌지 않는다.
 *
 * 하는 일:
 * - `CFBundleName`(메뉴 막대의 굵은 이름)을 앱 이름으로 바꾼다.
 * - 지역화 표시 이름을 켠다. Dock 툴팁과 Finder 는 "표시 이름"을 쓰는데, 지역화 표시 이름이
 *   없으면 번들 파일 이름(`Electron.app`)이 그대로 쓰인다. 파일 이름을 바꾸면 `electron` 패키지가
 *   실행 파일을 못 찾으므로, `LSHasLocalizedDisplayName`과 `<언어>.lproj/InfoPlist.strings`로
 *   이름을 준다. macOS 는 파일 이름이 `Info.plist`의 `CFBundleDisplayName`과 **같을 때만**
 *   지역화 이름을 쓴다(사용자가 파일 이름을 바꾸면 그 이름을 존중한다). 그래서
 *   `CFBundleDisplayName`은 파일 이름 그대로 두고, 보일 이름은 `InfoPlist.strings`가 준다.
 * - 번들 ID 를 바꾼다. Dock 과 LaunchServices 는 번들 ID 로 이름·아이콘을 캐시해서, `Info.plist`
 *   이름만 고치면 Dock 은 `killall Dock` 뒤에도 "Electron"을 보여 준다. 새 ID 면 새 앱으로 본다.
 *   저장 위치는 앱 이름이 아니라 `main.ts`가 고정한 경로라 데이터에는 영향이 없다.
 * - 앱 아이콘(`apps/desktop/resources/icon.icns`, `tools/app-icon.py`가 만든다)을 번들에 넣고
 *   `CFBundleIconFile`이 그것을 가리키게 한다.
 * - `lsregister -f`로 다시 등록한다. 이미 떠 있는 앱은 다시 띄워야 바뀐다.
 *
 * 서명: 이 번들은 링커 ad-hoc 서명이고 `Info.plist`와 리소스를 묶지 않는다(`codesign -dv` 의
 * `Info.plist=not bound`, `Sealed Resources=none`). 그래서 고쳐도 실행이 막히지 않는다.
 *
 * 왜 설치를 실패시키지 않는가: 보기 문제라 앱 실행을 막을 이유가 없다. 실패하면 경고만 남기고
 * 통과한다. macOS 가 아니면 할 일이 없다.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `apps/desktop/src/main/main.ts`의 `APP_NAME`과 같은 값이어야 한다. */
const APP_NAME = 'Petto Petto';
const BUNDLE_ID = 'com.petto-petto.dev';
const ICON_FILE = 'petto-petto.icns';
/** 지역화 표시 이름을 넣을 언어. 시스템 언어가 목록에 없으면 en 으로 떨어진다. */
const DISPLAY_NAME_LOCALES = ['en', 'ko', 'Base'];
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

if (process.platform !== 'darwin') process.exit(0);

function warn(reason) {
  console.warn(`[app-brand] 개발용 Electron.app 을 꾸미지 못했습니다 — ${reason}`);
  console.warn('[app-brand] 앱은 그대로 실행되지만 Dock 에 "Electron" 이름·아이콘으로 보입니다.');
  process.exit(0);
}

let binary;
try {
  // `electron` 패키지는 실행 파일 경로(…/Electron.app/Contents/MacOS/Electron)를 내보낸다.
  binary = createRequire(import.meta.url)('electron');
} catch (error) {
  warn(`electron 패키지를 찾지 못했습니다 (${error.message})`);
}

const contents = dirname(dirname(binary));
const bundle = dirname(contents);
const plist = join(contents, 'Info.plist');
if (!existsSync(plist)) warn(`${plist} 가 없습니다`);

function setKey(key, value) {
  const result = spawnSync('plutil', ['-replace', key, '-string', value, plist], {
    encoding: 'utf8',
  });
  if (result.status !== 0) warn(`${key}: ${result.stderr.trim() || result.error?.message}`);
}

setKey('CFBundleName', APP_NAME);
// 파일 이름과 같아야 지역화 표시 이름이 쓰인다(머리말 참조).
setKey('CFBundleDisplayName', basename(bundle, '.app'));
setKey('CFBundleIdentifier', BUNDLE_ID);

const localized = spawnSync(
  'plutil',
  ['-replace', 'LSHasLocalizedDisplayName', '-bool', 'YES', plist],
  {
    encoding: 'utf8',
  },
);
if (localized.status !== 0) warn(`LSHasLocalizedDisplayName: ${localized.stderr.trim()}`);
const strings = `CFBundleDisplayName = "${APP_NAME}";\nCFBundleName = "${APP_NAME}";\n`;
for (const locale of DISPLAY_NAME_LOCALES) {
  const directory = join(contents, 'Resources', `${locale}.lproj`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'InfoPlist.strings'), strings);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const icon = join(root, 'apps', 'desktop', 'resources', 'icon.icns');
if (existsSync(icon)) {
  copyFileSync(icon, join(contents, 'Resources', ICON_FILE));
  setKey('CFBundleIconFile', ICON_FILE);
} else {
  console.warn(`[app-brand] ${icon} 가 없어 아이콘은 그대로 둡니다.`);
}

const registered = spawnSync(LSREGISTER, ['-f', bundle], { encoding: 'utf8' });
if (registered.status !== 0) {
  warn(`LaunchServices 재등록 실패: ${registered.stderr.trim() || registered.error?.message}`);
}

console.log(
  `[app-brand] 개발용 Electron.app 을 "${APP_NAME}"(${BUNDLE_ID})로 꾸미고 다시 등록했습니다.`,
);
