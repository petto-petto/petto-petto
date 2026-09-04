import type { SqliteMigration } from '../sqlite-file.ts';
import { OVERLAY_GROWTH_MIGRATIONS } from './overlay-growth.ts';

/** 공통 SQLite 파일에 적용할 모든 기능 migration의 단일 등록 지점. */
export const APP_MIGRATIONS: readonly SqliteMigration[] = [...OVERLAY_GROWTH_MIGRATIONS];
