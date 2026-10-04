// Electron에서는 main 프로세스의 SQLite를, 브라우저 미리보기에서는 localStorage를 쓴다.
// 성장 엔진과 React 컴포넌트는 실제 저장소를 알 필요가 없다.
//
// 키는 **개체 id**다(`useGrowth.js` 참조). 종을 키로 쓰던 시절의 localStorage 값은 모양이
// 달라 무시된다 — 그 데이터는 이미 v1 때 SQLite로 옮겨졌고, 남은 것은 브라우저 미리보기
// 전용이라 잃을 것이 없다.
const KEY = 'pet-growth-owned-v1';
const api = typeof window !== 'undefined' ? window.overlay : undefined;
let writeChain = Promise.resolve();

function hasLS() {
  return typeof localStorage !== 'undefined';
}

// { [ownedPetId]: { petKey, pet, tokenBank, lastBaseXp } }
export async function loadAll() {
  if (api?.loadGrowth) {
    try {
      return (await api.loadGrowth()) || {};
    } catch (error) {
      console.error('[growth-storage] SQLite 로드 실패, 빈 상태로 시작합니다.', error);
      return {};
    }
  }
  if (!hasLS()) return {};
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
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

// 초기화도 같은 체인을 지난다. 진행 중인 저장과 순서가 엇갈리면 방금 지운 자리에 옛
// 스냅샷이 다시 쓰인다.
export function clearAll() {
  if (!api?.clearGrowth) {
    if (hasLS()) localStorage.removeItem(KEY);
    return Promise.resolve();
  }
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => api.clearGrowth())
    .then(() => {
      if (hasLS()) localStorage.removeItem(KEY);
    });
  return writeChain;
}
