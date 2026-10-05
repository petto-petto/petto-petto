/**
 * 이사만루체(공게임즈) 폰트 파일을 내려받는다. `npm install` 뒤와 `npm run build` 앞에 실행된다.
 *
 * 왜 저장소에 넣지 않는가: 이사만루체 라이선스는 앱에 넣어 쓰는 임베딩은 허용하지만 폰트 파일의
 * 복제·재배포는 금지한다. 이 저장소는 공개 저장소라 파일을 커밋하면 재배포가 된다. 그래서
 * 파일은 `.gitignore`로 빼고, 각자의 설치에서 눈누 CDN으로부터 받는다.
 *
 * 왜 설치를 실패시키지 않는가: 오프라인이나 CI에서 다운로드가 막혀도 앱과 무관한 작업까지
 * 멈추면 안 된다. 실패하면 무엇을 해야 하는지 알리고 통과시킨다. 폰트가 없으면 화면은 시스템
 * 기본 폰트로 보인다.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(root, 'apps', 'desktop', 'renderer', 'assets', 'fonts');
const CDN = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-10@1.0';
/** `apps/desktop/src/main/windows.ts`의 `injectFonts`가 이 이름으로 읽는다. */
const FILES = ['GongGothicLight.woff', 'GongGothicMedium.woff', 'GongGothicBold.woff'];

mkdirSync(fontsDir, { recursive: true });

let failed = 0;
for (const file of FILES) {
  const target = join(fontsDir, file);
  if (existsSync(target)) continue;
  try {
    const response = await fetch(`${CDN}/${file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    console.log(`[fonts] ${file} 받음`);
  } catch (error) {
    failed += 1;
    console.warn(`[fonts] ${file}을(를) 받지 못했습니다 — ${String(error)}`);
  }
}

if (failed > 0) {
  console.warn('[fonts] 네트워크가 되는 곳에서 `npm run fonts:fetch`를 다시 실행하세요.');
}
