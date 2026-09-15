/**
 * `better-sqlite3`를 Electron ABI로 다시 빌드한다. `npm install` 뒤에 자동 실행된다.
 *
 * 왜 필요한가: `better-sqlite3`는 네이티브 모듈이고, npm은 이것을 **Node의** ABI로
 * 빌드한다. 앱은 Electron 위에서 도는데 Electron은 다른 ABI를 쓴다. 그대로 두면
 * `npm start`가 이렇게 죽는다.
 *
 *     NODE_MODULE_VERSION 131. This version of Node.js requires NODE_MODULE_VERSION 130.
 *
 * 이걸 자동화하지 않으면 `git pull` 한 사람마다 같은 에러를 만나고, 원인을 모르면
 * 자기 코드를 의심하며 시간을 쓴다.
 *
 * 왜 설치를 실패시키지 않는가: 이 단계는 Electron 헤더를 내려받아야 한다. CI나 컨테이너,
 * 오프라인 환경에서는 그 다운로드가 막힐 수 있는데, 그때 `npm install` 전체가 죽으면
 * 앱을 실행할 생각도 없던 작업까지 멈춘다. 그래서 실패하면 **무엇을 해야 하는지 알리고
 * 통과**시킨다. 조용히 넘기지 않는 것이 핵심이다 — 실패는 반드시 눈에 보인다.
 */

import { spawnSync } from 'node:child_process';

const SKIP_REASON =
  process.env['SKIP_NATIVE_REBUILD'] === '1'
    ? 'SKIP_NATIVE_REBUILD=1'
    : process.env['CI']
      ? 'CI 환경'
      : undefined;

if (SKIP_REASON !== undefined) {
  console.log(`[native] ${SKIP_REASON} — 네이티브 리빌드를 건너뜁니다.`);
  process.exit(0);
}

const result = spawnSync(
  'npm',
  ['run', 'rebuild:native', '--workspace', '@pet/desktop', '--silent'],
  { stdio: 'inherit', shell: false },
);

if (result.status === 0) {
  console.log('[native] better-sqlite3 를 Electron ABI 로 다시 빌드했습니다.');
  process.exit(0);
}

console.warn(
  [
    '',
    '[native] better-sqlite3 리빌드에 실패했습니다. 설치 자체는 끝났습니다.',
    '[native] 이대로 `npm start` 하면 NODE_MODULE_VERSION 오류가 납니다.',
    '[native] 앱을 실행하려면 아래를 직접 돌려 주세요.',
    '',
    '    npm run rebuild:native --workspace @pet/desktop',
    '',
  ].join('\n'),
);
