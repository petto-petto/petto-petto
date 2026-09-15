// Electron에서는 main 프로세스의 SQLite를, 브라우저 미리보기에서는 localStorage를 쓴다.
// 성장 엔진과 React 컴포넌트는 실제 저장소를 알 필요가 없다.
const KEY = 'pet-growth-v1';
const api = typeof window !== 'undefined' ? window.overlay : undefined;
let writeChain = Promise.resolve();

function hasLS() {
  return typeof localStorage !== 'undefined';
}

// { [petKey]: { pet, tokenBank, lastBaseXp } }
function readLegacy() {
  if (!hasLS()) return {};
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

// 첫 Electron 실행에서는 legacy 스냅샷을 main에 전달한다. main이 migration 완료를 기록한
// 경우에만 localStorage 키를 제거한다.
export async function loadAll() {
  const legacy = readLegacy();
  if (!api?.hydrateGrowth) return legacy;
  try {
    const result = await api.hydrateGrowth(legacy);
    if (result.migratedLegacy && hasLS()) localStorage.removeItem(KEY);
    return result.snapshots || {};
  } catch (error) {
    console.error('[growth-storage] SQLite 로드 실패, localStorage를 유지합니다.', error);
    return legacy;
  }
}

export function saveAll(map) {
  if (!api?.saveGrowth) {
    if (hasLS()) localStorage.setItem(KEY, JSON.stringify(map));
    return Promise.resolve();
  }
  writeChain = writeChain.catch(() => undefined).then(() => api.saveGrowth(map));
  return writeChain;
}

export function clearAll() {
  if (!api?.clearGrowth) {
    if (hasLS()) localStorage.removeItem(KEY);
    return Promise.resolve();
  }
  return api.clearGrowth().then(() => {
    if (hasLS()) localStorage.removeItem(KEY);
  });
}
