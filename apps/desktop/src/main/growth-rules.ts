/**
 * 성장 규칙 → `@pet/meta` 의 `GrowthRules`.
 *
 * ## 왜 복사본인가
 *
 * 원본은 `packages/pet-overlay/src/domain/growth.ts` 의 `requiredXp` 와 `LEVEL_MAX` 다. 그런데
 * `@pet/main-overlay` 는 `./ui` 만 내보내고 TS 진입점이 없어서, 앱도 meta 도 그 함수를 import
 * 할 수 없다. `PetClient` 인계 문서는 “다음 레벨 필요 XP 는 기존 성장 함수에서 계산한다”고
 * 적었지만 그 함수에 닿는 길이 아직 없다.
 *
 * 그래서 두 값만 옮겨 적었다. **성장 패키지가 TS 진입점을 내보내면 이 파일을 지우고 원본을
 * import 한다.** 그때까지 곡선이 바뀌면 여기도 함께 바꿔야 한다.
 */

import type { GrowthRules } from '@pet/meta';

export const OVERLAY_GROWTH_RULES: GrowthRules = {
  maxLevel: 50,
  requiredXp: (level) => 10 + Math.floor(level / 2),
};
