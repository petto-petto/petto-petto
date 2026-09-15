const KEY = 'pet-overlay-state-v1';

function hasLocalStorage() {
  return typeof localStorage !== 'undefined';
}

export async function loadOverlayState() {
  if (window.overlay?.loadOverlayState) return window.overlay.loadOverlayState();
  if (!hasLocalStorage()) return { activePetKey: null };
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { activePetKey: null };
  } catch {
    return { activePetKey: null };
  }
}

export async function saveOverlayState(state) {
  if (window.overlay?.saveOverlayState) return window.overlay.saveOverlayState(state);
  if (hasLocalStorage()) localStorage.setItem(KEY, JSON.stringify(state));
}
