// 가벼운 로컬 저장 — 펫별 성장 상태를 localStorage 에 보관.
// Electron 렌더러의 localStorage 는 userData(사용자 로컬)에 영속되므로 재시작에도 유지된다.
// 저장 경계를 이 파일 하나로 격리 → 나중에 실제 DB(SQLite 등)로 교체 시 여기만 바꾸면 된다.
const KEY = 'pet-growth-v1';

function hasLS() { return typeof localStorage !== 'undefined'; }

// { [petKey]: { pet, tokenBank, lastBaseXp } }
export function loadAll() {
  if (!hasLS()) return {};
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function saveAll(map) {
  if (!hasLS()) return;
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 용량/권한 무시 */ }
}

export function clearAll() {
  if (!hasLS()) return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
