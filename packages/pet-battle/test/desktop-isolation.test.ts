import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('앱과 전투 패키지는 Electron 실행 경로만 제공한다', () => {
  const root = JSON.parse(read('../../../package.json'));
  const battle = JSON.parse(read('../package.json'));
  assert.doesNotMatch(root.scripts.build, /cargo|build:rust/);
  assert.match(root.scripts.start, /npm run build/);
  assert.equal(battle.scripts['build:rust'], undefined);
  assert.equal(battle.scripts['test:rust'], undefined);
  assert.doesNotMatch(JSON.stringify(battle.scripts), /cargo|sidecar|client-rust/);
  for (const removed of [
    'rust',
    'assets',
    'src/runtime',
    'src/ipc',
    'src/integration',
    'src/adapters',
    'src/controller',
  ]) {
    assert.equal(existsSync(new URL('../' + removed, import.meta.url)), false, removed);
  }
  assert.doesNotMatch(battle.scripts.demo, /cargo|build:rust/);
  assert.deepEqual(battle.exports['./ui'], {
    types: './ui/index.html',
    default: './dist/ui/index.html',
  });
  assert.equal(battle.exports['./assets/*'], './dist/ui/assets/*');
  assert.match(battle.scripts['build:ui'], /scripts\/build-ui\.mjs/);
  assert.match(root.scripts.build, /build:ui.*@pet\/battle/);
  assert.ok(
    existsSync(new URL('../ui/assets/backgrounds/v2/mushroom-forest.png', import.meta.url)),
  );
  assert.ok(existsSync(new URL('../src/testing/demo-gateway.ts', import.meta.url)));
  assert.ok(
    existsSync(
      new URL('../ui/art/backgrounds/generated/bg_201_mushroom_forest/scene.json', import.meta.url),
    ),
  );
  assert.ok(existsSync(new URL('../ui/art/enemies/rainbow-muted-preview.html', import.meta.url)));
  assert.equal(
    existsSync(new URL('../ui/assets/source/enemies/shadow-slime-idle-v2.png', import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(
      new URL(
        '../ui/assets/backgrounds/generated/bg_201_mushroom_forest/scene.json',
        import.meta.url,
      ),
    ),
    false,
  );
});

test('앱은 소유자의 선택·성장 조회 Adapter를 전투에 주입한다', () => {
  const main = read('../../../apps/desktop/src/main/main.ts');
  assert.match(main, /mountBattle\(new PetClientRoomAdapter\(pets\), ipcMain/);
  assert.match(main, /new SqliteGrowthReadClient\(growthRepository\)/);
  assert.match(main, /const battleRoom = room;/);
  assert.match(main, /selection: new RoomSelectionAdapter\(\(\) => battleRoom.scene\(\).pets\)/);
  for (const file of ['room.ts', 'room-state.ts', 'collection.ts']) {
    assert.doesNotMatch(read('../../../apps/desktop/src/main/' + file), /@pet\/battle|mountBattle/);
  }
});

test('앱은 전투 전용 전역 종료 상태 대신 패키지에 수명 신호를 주입한다', () => {
  const main = read('../../../apps/desktop/src/main/main.ts');
  assert.doesNotMatch(main, /let closeBattle|closeBattle\?\./);
  assert.match(main, /onQuit\(/);
  assert.match(main, /onWindowClosed: subscribeBattleWindowClosed/);
  assert.match(main, /state\?\.idle\(\)/, 'latest main aggregation shutdown must remain');
});

test('전투창 닫기 신호는 전투 창에서만 발행하며 해제할 수 있다', () => {
  const windows = read('../../../apps/desktop/src/main/windows.ts');
  assert.match(windows, /export function subscribeBattleWindowClosed/);
  assert.match(windows, /battleWindowClosedListeners\.delete\(listener\)/);
  const battleFactory = windows.slice(
    windows.indexOf('export function createBattleWindow'),
    windows.indexOf('export function createRoomWindow'),
  );
  assert.match(battleFactory, /battleWindow\.on\('closed'/);
  assert.match(battleFactory, /for \(const listener of battleWindowClosedListeners\)/);
});
