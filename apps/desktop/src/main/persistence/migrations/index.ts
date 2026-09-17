import type { SqliteMigration } from '../sqlite-file.ts';
import { CURRENCY_MIGRATIONS } from './currency.ts';
import { META_MIGRATIONS } from './meta.ts';
import { OVERLAY_GROWTH_MIGRATIONS } from './overlay-growth.ts';
import { PET_MIGRATIONS } from './pet.ts';

/** 공통 SQLite 파일에 적용할 모든 기능 migration의 단일 등록 지점. */
export const APP_MIGRATIONS: readonly SqliteMigration[] = [
  ...CURRENCY_MIGRATIONS,
  ...META_MIGRATIONS,
  ...OVERLAY_GROWTH_MIGRATIONS,
  ...PET_MIGRATIONS,
];
