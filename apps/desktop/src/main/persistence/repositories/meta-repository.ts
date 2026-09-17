import { createEventFacts, SNAPSHOT_SCHEMA_VERSION, type MetaSnapshot } from '@pet/meta';

import { SqliteFileDatabase } from '../sqlite-file.ts';

type Cell = string | number | null;

// DB 에서 읽은 문자열을 스냅샷의 브랜드 타입으로 되돌릴 때 쓰는 이름들. `as never` 를 쓰면 어떤 타입에도
// 대입돼 오류가 숨으므로, 스냅샷 타입에서 정확한 필드 타입을 꺼내 쓴다.
type Source = MetaSnapshot['sources'][number];
type Usage = MetaSnapshot['usageDaily'][number];
type Reward = MetaSnapshot['rewards'][number];
type Row = Record<string, Cell>;

/**
 * 표 하나의 모양. 열 이름은 코드에 고정된 값이라 SQL 에 직접 넣어도 안전하다 — 사용자 입력이
 * 표 이름이나 열 이름이 되는 경로는 없다.
 */
interface TableSpec {
  readonly name: string;
  readonly keys: readonly string[];
  readonly values: readonly string[];
}

/**
 * 쓰는 순서.
 *
 * 설정을 맨 뒤에 둔 것은 의도다. 트랜잭션이 깨져 있으면 앞 표만 쓰이고 뒤 표에서 실패하는 반쪽
 * 상태가 생기는데, 테스트가 그 상황을 만들려면 실패가 마지막에 일어나야 한다.
 */
const TABLES = {
  source: {
    name: 'meta_source',
    keys: ['provider'],
    values: [
      'enabled',
      'status',
      'has_baseline',
      'baseline_total_observed',
      'baseline_captured_at',
      'disabled_at',
      'last_success_at',
      'last_error',
      'ever_connected',
    ],
  },
  baseline: {
    name: 'meta_source_baseline_row',
    keys: ['provider', 'local_date', 'raw_model'],
    values: ['input', 'output', 'cache_create', 'cache_read'],
  },
  usage: {
    name: 'meta_usage_daily',
    keys: ['provider', 'local_date', 'raw_model'],
    values: ['input', 'output', 'cache_create', 'cache_read'],
  },
  activity: { name: 'meta_activity_minute', keys: ['local_minute'], values: [] },
  delta: { name: 'meta_processed_delta', keys: ['dedupe_key'], values: [] },
  pending: { name: 'meta_pending_usage_grant', keys: ['dedupe_key'], values: ['reward_tokens'] },
  event: { name: 'meta_processed_event', keys: ['event_id'], values: [] },
  fact: { name: 'meta_achievement_fact', keys: ['fact_key'], values: ['fact_value'] },
  progress: {
    name: 'meta_achievement_progress',
    keys: ['achievement_id'],
    values: ['progress', 'unlocked_at'],
  },
  reward: {
    name: 'meta_achievement_reward',
    keys: ['achievement_id', 'reward_key'],
    values: ['kind', 'status', 'attempts', 'last_error', 'detail'],
  },
  profile: { name: 'meta_profile', keys: ['id'], values: ['equipped_title'] },
  title: { name: 'meta_profile_title', keys: ['title'], values: [] },
  settings: {
    name: 'meta_settings',
    keys: ['id'],
    values: [
      'overlay_visible',
      'pet_size',
      'autostart',
      'notify_levelup',
      'notify_achievement',
      'notify_gacha_ready',
    ],
  },
} as const satisfies Record<string, TableSpec>;

const WRITE_ORDER: readonly TableSpec[] = Object.values(TABLES);

const bit = (value: boolean): number => (value ? 1 : 0);

/** 스냅샷을 표마다 행 배열로 편다. 배열 순서가 곧 삽입 순서다. */
function rowsOf(snapshot: MetaSnapshot): Map<TableSpec, Row[]> {
  const sources: Row[] = [];
  const baseline: Row[] = [];
  for (const source of snapshot.sources) {
    sources.push({
      provider: source.provider,
      enabled: bit(source.enabled),
      status: source.status,
      has_baseline: bit(source.baseline !== null),
      baseline_total_observed: source.baseline?.totalObserved ?? null,
      baseline_captured_at: source.baseline?.capturedAt ?? null,
      disabled_at: source.disabledAt,
      last_success_at: source.lastSuccessAt,
      last_error: source.lastError,
      ever_connected: bit(source.everConnected),
    });
    for (const row of source.baseline?.rows ?? []) {
      baseline.push({
        provider: source.provider,
        local_date: row.date,
        raw_model: row.rawModel,
        input: row.counts.input,
        output: row.counts.output,
        cache_create: row.counts.cacheCreate,
        cache_read: row.counts.cacheRead,
      });
    }
  }

  return new Map<TableSpec, Row[]>([
    [TABLES.source, sources],
    [TABLES.baseline, baseline],
    [
      TABLES.usage,
      snapshot.usageDaily.map((row) => ({
        provider: row.provider,
        local_date: row.date,
        raw_model: row.rawModel,
        input: row.counts.input,
        output: row.counts.output,
        cache_create: row.counts.cacheCreate,
        cache_read: row.counts.cacheRead,
      })),
    ],
    [TABLES.activity, snapshot.activityMinutes.map((minute) => ({ local_minute: minute }))],
    [TABLES.delta, snapshot.processedDeltas.map((key) => ({ dedupe_key: key }))],
    [
      TABLES.pending,
      snapshot.pendingUsageGrants.map((grant) => ({
        dedupe_key: grant.dedupeKey,
        reward_tokens: grant.rewardTokens,
      })),
    ],
    [TABLES.event, snapshot.processedEvents.map((id) => ({ event_id: id }))],
    [
      TABLES.fact,
      Object.entries(snapshot.eventFacts).map(([key, value]) => ({
        fact_key: key,
        fact_value: value,
      })),
    ],
    [
      TABLES.progress,
      snapshot.progress.map((entry) => ({
        achievement_id: entry.achievementId,
        progress: entry.progress,
        unlocked_at: entry.unlockedAt,
      })),
    ],
    [
      TABLES.reward,
      snapshot.rewards.map((record) => ({
        achievement_id: record.achievementId,
        reward_key: record.rewardKey,
        kind: record.kind,
        status: record.status,
        attempts: record.attempts,
        last_error: record.lastError,
        detail: record.detail,
      })),
    ],
    [TABLES.profile, [{ id: 1, equipped_title: snapshot.profile.equippedTitle }]],
    [TABLES.title, snapshot.profile.ownedTitles.map((title) => ({ title }))],
    [
      TABLES.settings,
      [
        {
          id: 1,
          overlay_visible: bit(snapshot.settings.overlayVisible),
          pet_size: snapshot.settings.petSize,
          autostart: bit(snapshot.settings.autostart),
          notify_levelup: bit(snapshot.settings.notifyLevelup),
          notify_achievement: bit(snapshot.settings.notifyAchievement),
          notify_gacha_ready: bit(snapshot.settings.notifyGachaReady),
        },
      ],
    ],
  ]);
}

const keyOf = (spec: TableSpec, row: Row): string =>
  JSON.stringify(spec.keys.map((column) => row[column]));

/** 같은 행인가. 열 순서를 표 정의로 고정해 비교한다. */
const sameRow = (spec: TableSpec, a: Row, b: Row): boolean =>
  spec.values.every((column) => a[column] === b[column]);

export interface MetaWriteStats {
  upserted: number;
  deleted: number;
}

/**
 * meta 기능의 테이블 접근. 규칙은 없고 SQL 만 있다.
 *
 * ## 왜 스냅샷을 주고받는가
 *
 * meta 의 도메인은 메모리의 `MetaState` 로 계산하고, 저장은 `MetaSnapshot` 으로 한다. 스냅샷이
 * 이미 표 모양으로 정규화돼 있어서(배열 하나가 표 하나) 도메인을 건드리지 않고 저장 계층만 바꿀
 * 수 있다. meta 테이블은 meta 만 쓰므로 메모리가 항상 최신이고, 시작할 때 한 번 읽으면 된다.
 *
 * ## 왜 이전 스냅샷을 함께 받는가
 *
 * 연산마다 즉시 저장하는데 그때마다 표 열두 개를 다시 쓰면 설정 토글 하나가 전체 재작성이 된다.
 * 이전에 확정된 스냅샷과 비교해 **바뀐 행만** 쓰고 **사라진 행만** 지운다.
 */
export class MetaRepository {
  readonly #database: SqliteFileDatabase;

  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }

  /** 저장된 것이 없으면 `undefined`. 설정 행은 항상 함께 쓰이므로 그 존재가 “저장된 적 있음”이다. */
  load(): MetaSnapshot | undefined {
    const settings = this.#select(TABLES.settings)[0];
    if (settings === undefined) return undefined;

    const baselineByProvider = new Map<string, Row[]>();
    for (const row of this.#select(TABLES.baseline)) {
      const provider = String(row['provider']);
      baselineByProvider.set(provider, [...(baselineByProvider.get(provider) ?? []), row]);
    }

    const counts = (row: Row) => ({
      input: Number(row['input']),
      output: Number(row['output']),
      cacheCreate: Number(row['cache_create']),
      cacheRead: Number(row['cache_read']),
    });
    const text = (value: Cell | undefined): string | null =>
      value === null || value === undefined ? null : String(value);

    // 지금 코드가 아는 사실 키만 채운다. 나중에 사라진 키가 DB 에 남아 있어도 끌어오지 않고,
    // 새로 생긴 키는 기본값 0 으로 시작한다.
    const eventFacts = createEventFacts();
    const known = eventFacts as unknown as Record<string, number>;
    for (const row of this.#select(TABLES.fact)) {
      const key = String(row['fact_key']);
      if (key in known) known[key] = Number(row['fact_value']);
    }

    const profile = this.#select(TABLES.profile)[0];

    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      sources: this.#select(TABLES.source).map((row) => {
        const provider = String(row['provider']);
        return {
          provider: provider as Source['provider'],
          enabled: row['enabled'] === 1,
          status: String(row['status']) as Source['status'],
          baseline:
            row['has_baseline'] === 1
              ? {
                  rows: (baselineByProvider.get(provider) ?? []).map((line) => ({
                    date: String(line['local_date']) as Usage['date'],
                    rawModel: String(line['raw_model']),
                    counts: counts(line),
                  })),
                  totalObserved: Number(row['baseline_total_observed']),
                  capturedAt: String(row['baseline_captured_at']),
                }
              : null,
          disabledAt: text(row['disabled_at']),
          lastSuccessAt: text(row['last_success_at']),
          lastError: text(row['last_error']),
          everConnected: row['ever_connected'] === 1,
        };
      }),
      usageDaily: this.#select(TABLES.usage).map((row) => ({
        provider: String(row['provider']) as Usage['provider'],
        date: String(row['local_date']) as Usage['date'],
        rawModel: String(row['raw_model']),
        counts: counts(row),
      })),
      activityMinutes: this.#select(TABLES.activity).map(
        (row) => String(row['local_minute']) as MetaSnapshot['activityMinutes'][number],
      ),
      processedDeltas: this.#select(TABLES.delta).map((row) => String(row['dedupe_key'])),
      pendingUsageGrants: this.#select(TABLES.pending).map((row) => ({
        dedupeKey: String(row['dedupe_key']),
        rewardTokens: Number(row['reward_tokens']),
      })),
      processedEvents: this.#select(TABLES.event).map(
        (row) => String(row['event_id']) as MetaSnapshot['processedEvents'][number],
      ),
      eventFacts,
      progress: this.#select(TABLES.progress).map((row) => ({
        achievementId: String(row['achievement_id']),
        progress: Number(row['progress']),
        unlockedAt: text(row['unlocked_at']),
      })),
      rewards: this.#select(TABLES.reward).map((row) => ({
        achievementId: String(row['achievement_id']),
        rewardKey: String(row['reward_key']),
        kind: String(row['kind']) as Reward['kind'],
        status: String(row['status']) as Reward['status'],
        attempts: Number(row['attempts']),
        lastError: text(row['last_error']),
        detail: text(row['detail']),
      })),
      profile: {
        equippedTitle: text(profile?.['equipped_title']),
        ownedTitles: this.#select(TABLES.title).map((row) => String(row['title'])),
      },
      settings: {
        overlayVisible: settings['overlay_visible'] === 1,
        petSize: String(settings['pet_size']) as MetaSnapshot['settings']['petSize'],
        autostart: settings['autostart'] === 1,
        notifyLevelup: settings['notify_levelup'] === 1,
        notifyAchievement: settings['notify_achievement'] === 1,
        notifyGachaReady: settings['notify_gacha_ready'] === 1,
      },
    };
  }

  /**
   * `previous` 에서 `next` 로 바뀐 만큼만 **한 트랜잭션으로** 쓴다.
   *
   * 집계 한 번이 사용량 · 처리한 증가분 · 기준점 · 지급 대기를 함께 바꾼다. 이걸 따로 쓰다가 그
   * 사이에 앱이 꺼지면 “증가분은 처리했다고 기록됐는데 사용량은 안 더해진” 상태가 남고, 멱등 키가
   * 다시 세는 것을 막아 그 사용량은 영원히 사라진다. 그래서 전부 쓰이거나 아무것도 안 쓰인다.
   *
   * `previous` 가 `undefined` 면 처음 저장이라 전부 넣는다.
   */
  write(previous: MetaSnapshot | undefined, next: MetaSnapshot): MetaWriteStats {
    const before = previous ? rowsOf(previous) : new Map<TableSpec, Row[]>();
    const after = rowsOf(next);

    return this.#database.transaction(() => {
      const stats: MetaWriteStats = { upserted: 0, deleted: 0 };
      for (const spec of WRITE_ORDER) {
        const old = new Map((before.get(spec) ?? []).map((row) => [keyOf(spec, row), row]));
        const fresh = after.get(spec) ?? [];
        const freshKeys = new Set(fresh.map((row) => keyOf(spec, row)));

        for (const [key, row] of old) {
          if (freshKeys.has(key)) continue;
          this.#delete(spec, row);
          stats.deleted += 1;
        }
        for (const row of fresh) {
          const existing = old.get(keyOf(spec, row));
          if (existing && sameRow(spec, existing, row)) continue;
          this.#upsert(spec, row);
          stats.upserted += 1;
        }
      }
      return stats;
    });
  }

  /** 삽입 순서대로 읽는다. 갱신은 행을 지우지 않고 제자리에서 바꾸므로 순서가 유지된다. */
  #select(spec: TableSpec): Row[] {
    return this.#database.prepare<[], Row>(`SELECT * FROM ${spec.name} ORDER BY rowid`).all();
  }

  #upsert(spec: TableSpec, row: Row): void {
    const columns = [...spec.keys, ...spec.values];
    const placeholders = columns.map(() => '?').join(', ');
    const conflict =
      spec.values.length === 0
        ? 'DO NOTHING'
        : `DO UPDATE SET ${spec.values.map((column) => `${column} = excluded.${column}`).join(', ')}`;
    this.#database
      .prepare<Cell[]>(
        `INSERT INTO ${spec.name} (${columns.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (${spec.keys.join(', ')}) ${conflict}`,
      )
      .run(...columns.map((column) => row[column] ?? null));
  }

  #delete(spec: TableSpec, row: Row): void {
    this.#database
      .prepare<Cell[]>(
        `DELETE FROM ${spec.name} WHERE ${spec.keys.map((column) => `${column} = ?`).join(' AND ')}`,
      )
      .run(...spec.keys.map((column) => row[column] ?? null));
  }
}
