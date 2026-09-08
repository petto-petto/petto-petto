import type { SqliteMigration } from '../sqlite-file.ts';

/** v1이 쓰던 종 단위 테이블. v2가 이름만 바꿔 남겨 두고, 이관은 런타임이 한다. */
export const LEGACY_SPECIES_PROFILE_TABLE = 'pet_profiles_by_species_v1';

export const OVERLAY_GROWTH_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'overlay-growth',
    version: 1,
    name: 'create pet growth profiles',
    up(database) {
      database.exec(`
        CREATE TABLE pet_profiles (
          pet_key TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          level INTEGER NOT NULL CHECK (level >= 1),
          xp_into_level INTEGER NOT NULL CHECK (xp_into_level >= 0),
          total_xp INTEGER NOT NULL CHECK (total_xp >= 0),
          evolution_stage INTEGER NOT NULL CHECK (evolution_stage BETWEEN 0 AND 2),
          token_bank INTEGER NOT NULL CHECK (token_bank >= 0),
          last_base_xp INTEGER NOT NULL CHECK (last_base_xp >= 0),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE overlay_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    scope: 'overlay-growth',
    version: 2,
    /**
     * 성장 기록을 **종이 아니라 개체**에 붙인다.
     *
     * 종을 키로 쓰면 같은 종을 두 마리 가졌을 때 두 개체의 성장이 한 행에서 합쳐진다. 지금은
     * 시드가 종별 한 마리라 드러나지 않지만, 가챠가 붙는 순간 사용자가 키운 펫이 서로를
     * 덮어쓴다.
     *
     * 같은 이유로 `overlay.active-pet-key`를 지운다. 활성 펫의 정본은 명부(`room-state.json`)
     * 하나이고, 오버레이가 자기 활성 펫을 따로 들고 있어서 펫룸에서 지정한 펫이 오버레이에
     * 반영되지 않았다.
     *
     * 옛 테이블은 지우지 않고 이름만 바꿔 둔다. 어느 종 행이 어느 개체의 것인지는 명부를
     * 알아야 정할 수 있고, 명부는 이 migration이 볼 수 없다 — 이관은
     * `PetGrowthRepository.adoptRoster`가 앱 시작 때 한 번 한다.
     */
    name: 'key growth profiles by owned pet',
    up(database) {
      database.exec(`
        ALTER TABLE pet_profiles RENAME TO ${LEGACY_SPECIES_PROFILE_TABLE};

        CREATE TABLE pet_profiles (
          owned_pet_id TEXT PRIMARY KEY,
          pet_key TEXT NOT NULL,
          display_name TEXT NOT NULL,
          level INTEGER NOT NULL CHECK (level >= 1),
          xp_into_level INTEGER NOT NULL CHECK (xp_into_level >= 0),
          total_xp INTEGER NOT NULL CHECK (total_xp >= 0),
          evolution_stage INTEGER NOT NULL CHECK (evolution_stage BETWEEN 0 AND 2),
          token_bank INTEGER NOT NULL CHECK (token_bank >= 0),
          last_base_xp INTEGER NOT NULL CHECK (last_base_xp >= 0),
          updated_at TEXT NOT NULL
        );

        DELETE FROM overlay_metadata WHERE key = 'overlay.active-pet-key';
      `);
    },
  },
];
