/** Meta and battle use the growth owner's public curve, not copied formulas. */
import type { GrowthRules } from '@pet/meta';
import { LEVEL_MAX, requiredXp } from '@pet/main-overlay/growth';

export const OVERLAY_GROWTH_RULES: GrowthRules = {
  maxLevel: LEVEL_MAX,
  requiredXp,
};
