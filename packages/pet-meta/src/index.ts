/**
 * # @pet/meta — 정보 · 설정 · 업적
 *
 * 스터디 사이드 프로젝트에서 `meta` feature가 맡은 부분이다.
 *
 * ## 이 패키지에 UI 코드가 없는 이유
 *
 * 여기에는 창, 버튼, HTML이 한 줄도 없다. Electron 의존성도 없다. 규칙과 화면 모델만
 * 있고, 앱은 이것을 호출해 그리기만 한다.
 *
 * 그래서 기획서 8장·9장의 어려운 규칙 — 기준점, 멱등성, 활동 분, 보상 재시도 — 을
 * **창을 띄우지 않고** 테스트할 수 있다. UI 프레임워크를 바꿔도 이 패키지와 테스트는
 * 그대로 남는다.
 *
 * ## 내부 구조
 *
 * | 폴더 | 역할 |
 * |---|---|
 * | `domain/` | 규칙. 순수 로직만 있고 바깥을 모른다 |
 * | `ports/` | 다른 도메인과 인프라에 요구하는 인터페이스 |
 * | `persistence/` | 저장 형식과 저장소 포트 |
 * | `view/` | 화면 모델. 포트 실패를 블록별 오류로 바꾼다 |
 *
 * ## 의존 방향
 *
 * `@pet/meta` → `@pet/core` 한 방향뿐이다. 다른 feature 패키지를 의존하지 않는다.
 */

export * from './ports/index.ts';

export * from './domain/state.ts';
export * from './domain/settings/index.ts';
export * from './domain/profile/index.ts';
export * from './domain/panel/index.ts';
export * from './domain/usage/tokens.ts';
export * from './domain/usage/collector.ts';
export * from './domain/usage/pipeline.ts';
export * from './domain/usage/stats.ts';
export * from './domain/achievement/catalog.ts';
export * from './domain/achievement/facts.ts';
export * from './domain/achievement/progress.ts';
export * from './domain/achievement/engine.ts';

export * from './persistence/snapshot.ts';

export * from './view/field.ts';
export * from './view/info.ts';
export * from './view/settings.ts';
export * from './view/achievement.ts';
