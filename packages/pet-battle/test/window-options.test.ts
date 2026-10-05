import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const hostSource = new URL('../../../apps/desktop/src/main/windows.ts', import.meta.url);
const demoSource = new URL('../ui/demo-main.cjs', import.meta.url);
const optionsSource = new URL('../ui/window-options.json', import.meta.url);
const readBattleOptions = () => JSON.parse(readFileSync(optionsSource, 'utf8'));

function windowFixture() {
  const windows: WindowStub[] = [];
  class WindowStub {
    readonly options: Record<string, unknown>;
    readonly listeners = new Map<string, () => void>();
    loadedFile = '';
    showCount = 0;
    focusCount = 0;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    show() {
      this.showCount += 1;
    }
    focus() {
      this.focusCount += 1;
    }
    setMenuBarVisibility() {}
    loadFile(file: string) {
      this.loadedFile = file;
      return Promise.resolve();
    }
    once(event: string, listener: () => void) {
      this.listeners.set(event, listener);
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
    }
  }
  return { windows, BrowserWindow: WindowStub };
}

function hostFixture() {
  const source = ts.createSourceFile(
    fileURLToPath(hostSource),
    readFileSync(hostSource, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'createBattleWindow',
  );
  assert.ok(declaration, 'execute the production battle-window factory, not a copied option set');
  const subscription = source.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'subscribeBattleWindowClosed',
  );
  const compiled = ts.transpileModule(
    `let battleWindow;\nconst battleWindowClosedListeners = new Set();\n${subscription?.getText(source) ?? ''}\n${declaration.getText(source)}`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } },
  ).outputText;
  const fixture = windowFixture();
  const exposed = {} as {
    createBattleWindow(): InstanceType<typeof fixture.BrowserWindow>;
    subscribeBattleWindowClosed(listener: () => void): () => void;
  };
  runInNewContext(compiled, {
    exports: exposed,
    BrowserWindow: fixture.BrowserWindow,
    preloadPath: '/test/preload.cjs',
    battleUiDir: '/test/battle/ui',
    battleWindowOptions: readBattleOptions(),
    injectFonts() {},
    join: path.join,
  });
  return { ...fixture, ...exposed };
}

function assertBattleOptions(options: Record<string, unknown>) {
  const dimensions = Object.fromEntries(
    ['width', 'height', 'minWidth', 'minHeight', 'useContentSize', 'resizable'].map((key) => [
      key,
      options[key],
    ]),
  );
  assert.deepEqual(dimensions, {
    width: 640,
    height: 420,
    minWidth: 360,
    minHeight: 180,
    useContentSize: true,
    resizable: true,
  });
  assert.equal(options.maxWidth, undefined, '사용자 확대 크기를 새로 제한하지 않는다');
  assert.equal(options.maxHeight, undefined);
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.alwaysOnTop, true);
}

test('실제 앱 전투창은 640×420으로 열리고 360×180까지 모서리 크기 조절을 허용한다', () => {
  const fixture = hostFixture();
  const window = fixture.createBattleWindow();
  assertBattleOptions(window.options);
  assert.equal(window.loadedFile, path.join('/test/battle/ui', 'index.html'));
  const security = window.options.webPreferences as Record<string, unknown>;
  assert.equal(security.contextIsolation, true);
  assert.equal(security.nodeIntegration, false);
  assert.equal(security.sandbox, true);
  assert.equal(security.preload, path.join('/test/battle/ui', 'host-preload.cjs'));
});

test('데모도 실제 앱과 같은 기본·최소 크기와 크기 조절 옵션을 사용한다', async () => {
  const fixture = windowFixture();
  runInNewContext(readFileSync(demoSource, 'utf8'), {
    __dirname: path.dirname(fileURLToPath(demoSource)),
    process: { argv: [] },
    require(name: string) {
      if (name === 'node:fs') return {};
      if (name === 'node:path') return path;
      if (name === './window-options.json') return readBattleOptions();
      if (name === 'electron') {
        return {
          BrowserWindow: fixture.BrowserWindow,
          app: { whenReady: () => Promise.resolve(), on() {} },
        };
      }
      throw new Error(`unexpected demo import: ${name}`);
    },
  });
  await Promise.resolve();
  assert.equal(fixture.windows.length, 1);
  assertBattleOptions(fixture.windows[0]!.options);
});

test('앱과 데모는 전투 패키지가 소유한 창 설정을 공유한다', () => {
  assert.match(readFileSync(hostSource, 'utf8'), /@pet\/battle\/ui\/window-options\.json/);
  assert.match(readFileSync(demoSource, 'utf8'), /require\('\.\/window-options\.json'\)/);
  assertBattleOptions(readBattleOptions());
});

test('열린 전투창을 다시 호출해도 생성·초기화하지 않고 닫은 후에는 새 기본 창을 만든다', () => {
  const fixture = hostFixture();
  const first = fixture.createBattleWindow();
  const second = fixture.createBattleWindow();
  assert.equal(second, first);
  assert.equal(fixture.windows.length, 1);
  assert.equal(first.showCount, 1);
  assert.equal(first.focusCount, 1);
  first.listeners.get('closed')!();
  const reopened = fixture.createBattleWindow();
  assert.notEqual(reopened, first);
  assert.equal(fixture.windows.length, 2);
});

test('실제 전투창 닫기 신호를 구독·해제하며 재개방한 창에도 같은 연결을 사용한다', () => {
  const fixture = hostFixture();
  assert.equal(typeof fixture.subscribeBattleWindowClosed, 'function');
  let calls = 0;
  const unsubscribe = fixture.subscribeBattleWindowClosed(() => calls++);
  fixture.createBattleWindow().listeners.get('closed')!();
  assert.equal(calls, 1);
  fixture.createBattleWindow().listeners.get('closed')!();
  assert.equal(calls, 2);
  unsubscribe();
  unsubscribe();
  fixture.createBattleWindow().listeners.get('closed')!();
  assert.equal(calls, 2, 'disposed battle mounts must stop receiving window lifecycle signals');
});
