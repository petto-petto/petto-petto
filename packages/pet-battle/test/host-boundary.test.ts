import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('앱은 패키지의 Node 진입점만 조립하고 전투 규칙·바이너리 경로를 소유하지 않는다', () => {
  const main = read('../../../apps/desktop/src/main/main.ts');
  assert.match(main, /import \{ mountBattle \} from '@pet\/battle\/node'/);
  assert.doesNotMatch(main, /battle-rules\.json|pet-battle-engine|battleRoot/);
  assert.equal(
    existsSync(new URL('../../../apps/desktop/src/main/battle.ts', import.meta.url)),
    false,
  );
  const pkg = JSON.parse(read('../package.json'));
  assert.deepEqual(pkg.exports['./node'], { types: './dist/node.d.ts', default: './dist/node.js' });
});

test('공통 preload는 더 이상 다른 기능 창에 전투 명령 권한을 노출하지 않는다', () => {
  const common = read('../../../apps/desktop/src/preload/preload.cjs');
  assert.doesNotMatch(common, /exposeInMainWorld\('petBattle'/);
  assert.match(common, /openBattle:.*battle:open/);
});

test('전투 전용 sandbox preload는 Electron만 읽고 command 포트만 노출한다', async () => {
  const exposed = new Map<string, { execute(command: unknown): Promise<unknown> }>();
  const calls: unknown[][] = [];
  runInNewContext(read('../ui/host-preload.cjs'), {
    require(name: string) {
      assert.equal(name, 'electron', 'sandbox preload must not load Node or package modules');
      return {
        contextBridge: {
          exposeInMainWorld: (key: string, value: never) => exposed.set(key, value),
        },
        ipcRenderer: {
          invoke: async (...args: unknown[]) => {
            calls.push(args);
            return { ok: true };
          },
        },
      };
    },
  });
  assert.deepEqual([...exposed.keys()], ['petBattle']);
  const bridge = exposed.get('petBattle')!;
  assert.deepEqual(Object.keys(bridge), ['execute']);
  const command = { type: 'GET_STATE' };
  assert.deepEqual(await bridge.execute(command), { ok: true });
  assert.deepEqual(calls, [['battle:command', command]]);
});
