// 렌더러 <-> Electron 브리지. Electron이 아니면(브라우저 미리보기) 안전한 no-op.
const api = typeof window !== 'undefined' ? window.overlay : undefined;

export const isElectron = !!api;

export function onUsage(cb) {
  if (api?.onUsage) return api.onUsage(cb);
  return () => {}; // 브라우저: hook 수신 없음 (DevPanel로 시뮬)
}

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
