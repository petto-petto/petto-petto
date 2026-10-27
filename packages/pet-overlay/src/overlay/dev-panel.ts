/**
 * 오버레이 창 주소에 붙는 개발 패널 표시 값. `PETTO_DEV_PANEL=1 npm start`로 띄우면 메인 프로세스가
 * 붙인다(`apps/desktop/src/main/windows.ts`의 `createOverlayWindow`).
 */
export const DEV_PANEL_QUERY = 'devPanel';

/**
 * ⚙ 개발 패널을 그릴지. 앱이 시작할 때 한 번 정한다.
 *
 * Electron 에서는 시작 옵션이 붙인 값이 정확히 `1`일 때만 그린다. 토큰 추가·성장 초기화 같은 버튼을
 * 실제 사용 중에 누르면 안 된다. 브라우저 미리보기는 늘 그린다 — Electron 이 없으면 성장을 움직일
 * 방법이 이 패널뿐이다.
 */
export function showsDevPanel(search: string, electron: boolean): boolean {
  if (!electron) return true;
  return new URLSearchParams(search).get(DEV_PANEL_QUERY) === '1';
}
