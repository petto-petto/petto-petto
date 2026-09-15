// 정적 리소스 경로 해석.
//
// UI 는 패키지 안에 있고 에셋은 앱(`apps/desktop/renderer/assets/`)이 갖는다. 패키지가 앱의
// 파일 경로를 알면 앱 밖에서 못 쓰게 되므로, 창을 여는 쪽이 `?assets=` 쿼리로 에셋 루트를
// 알려 준다. `@pet/gacha`·`@pet/combine` 이 쓰는 것과 같은 규약이다.
//
// 쿼리가 없으면 워크스페이스 기준 상대 경로로 되돌아간다. 그래야 창을 앱 없이 브라우저나
// `electron <파일>` 로 직접 열어 확인할 수 있다 — 쿼리가 없다고 던지면 그 경로가 막힌다.

const FALLBACK = '../../../apps/desktop/renderer/assets/';

/** 에셋 루트 URL. 항상 `/` 로 끝난다 — `new URL(상대경로, 루트)` 가 마지막 칸을 먹지 않게. */
export function assetRoot() {
  const query = new URLSearchParams(window.location.search).get('assets');
  if (query) return new URL(query.endsWith('/') ? query : `${query}/`);
  return new URL(FALLBACK, window.location.href);
}

const root = assetRoot();

/**
 * 에셋 루트 기준 상대 경로를 실제 URL 로 바꾼다.
 *
 * `@pet/room` 의 `petAssetPath`·`backgroundAssetPath` 가 내는 경로(`pets/…`, `backgrounds/…`)를
 * 그대로 받는다. 그 함수들은 루트가 어디인지 모른다 — 아는 것은 이 파일뿐이다.
 */
export function assetUrl(path) {
  return new URL(path, root).href;
}
