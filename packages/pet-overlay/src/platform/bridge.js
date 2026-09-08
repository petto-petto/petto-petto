// 렌더러 <-> Electron 브리지. Electron이 아니면(브라우저 미리보기) 안전한 no-op.
const api = typeof window !== 'undefined' ? window.overlay : undefined;

export const isElectron = !!api;

export function setInteractive(v) {
  api?.setInteractive?.(v);
}
export function focusWindow() {
  api?.focusWindow?.();
}
export function onMenuClose(cb) {
  if (api?.onMenuClose) return api.onMenuClose(cb);
  return () => {};
}
export function dragStart(sx, sy) {
  api?.dragStart?.(sx, sy);
}
export function dragMove(sx, sy) {
  api?.dragMove?.(sx, sy);
}
export function dragEnd() {
  api?.dragEnd?.();
}
export function quit() {
  api?.quit?.();
}
export function openPanel(screen) {
  return api?.openPanel?.(screen) ?? Promise.resolve();
}
export function openPetRoom() {
  return api?.openPetRoom?.() ?? Promise.resolve();
}
export function openBattle() {
  return api?.openBattle?.() ?? Promise.resolve();
}

/**
 * 명부 조회·활성 펫 지정·활성 펫 변경 구독.
 *
 * 활성 펫은 오버레이가 정하지 않는다. `setActivePet` 은 호출만 하고, 화면은 오직
 * `onActivePetChanged` 로 받은 값으로 바꾼다 — 펫룸과 같은 규칙이다. 발신 창이 낙관적으로
 * 먼저 그리면 로컬 상태와 push 상태가 경쟁해 진실의 원천이 둘로 쪼개진다.
 */
export function roomScene() {
  return api?.roomScene?.() ?? Promise.resolve(null);
}
export function setActivePet(ownedPetId) {
  return api?.setActivePet?.(ownedPetId) ?? Promise.resolve();
}
export function onActivePetChanged(cb) {
  if (api?.onActivePetChanged) return api.onActivePetChanged(cb);
  return () => {};
}
