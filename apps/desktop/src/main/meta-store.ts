/**
 * meta 저장소 — `@pet/meta` 의 `MetaStore` 를 SQLite 로 채운다.
 *
 * ## 읽기는 시작할 때, 쓰기는 연산마다
 *
 * meta 테이블은 meta 만 쓴다. 그래서 메모리의 상태가 항상 최신이고, 앱이 켜질 때 한 번 읽어
 * 메모리를 복원하면 된다. 이후 모든 변경은 연산 직후 `save` 로 들어와 바뀐 행만 즉시 쓰인다.
 * 남이 쓰는 펫 데이터와 다르다 — 펫은 뽑기 · 합성 · 펫룸이 바꾸므로 meta 가 매번 `PetClient` 로
 * 읽는다.
 *
 * ## 확정본은 쓰기에 성공했을 때만 앞으로 간다
 *
 * diff 의 기준은 “마지막으로 DB 에 확정된 스냅샷”이다. 쓰기가 실패하면 트랜잭션은 통째로
 * 롤백되고 기준도 그대로 남는다. 그래서 다음 저장이 실패한 변경까지 함께 다시 쓴다. 실패했는데
 * 기준을 옮기면 그 변경을 “이미 쓴 것”으로 보고 영영 빠뜨린다.
 *
 * 메모리는 되돌리지 않는다. 일시적인 쓰기 실패 하나로 방금 집계한 사용량을 버리지 않고, 다음
 * 저장에서 따라잡는다. 기존 계약(“저장 실패가 메모리 상태를 망가뜨리지 않는다”)과 같다.
 */

import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { migrateSnapshot, type MetaSnapshot, type MetaStore } from '@pet/meta';

import type { MetaRepository } from './persistence/repositories/meta-repository.ts';
import { JsonFileStore, META_FILE_NAME } from './store.ts';

export class SqliteMetaStore implements MetaStore {
  readonly #repository: MetaRepository;
  #committed: MetaSnapshot | undefined;

  constructor(repository: MetaRepository) {
    this.#repository = repository;
  }

  load(): MetaSnapshot | undefined {
    const snapshot = this.#repository.load();
    this.#committed = snapshot === undefined ? undefined : structuredClone(snapshot);
    return snapshot;
  }

  save(snapshot: MetaSnapshot): void {
    this.#repository.write(this.#committed, snapshot);
    // 깊은 복사로 보관한다. 스냅샷의 토큰 수 같은 객체를 메모리 상태와 공유하면, 도메인이 그
    // 객체를 제자리에서 바꿨을 때 확정본도 함께 바뀌어 다음 diff 가 변경을 놓친다.
    this.#committed = structuredClone(snapshot);
  }
}

export type LegacyImport = 'imported' | 'renamed' | 'none';

/**
 * 테이블로 옮기기 전의 `meta-state.json` 을 한 번만 가져온다.
 *
 * 순서가 안전을 만든다 — 먼저 DB 에 쓰고, 성공한 뒤에 파일 이름을 바꾼다. 그 사이에 앱이 꺼지면
 * 다음 실행에서 DB 에 이미 데이터가 있으므로 다시 가져오지 않고 이름만 바꾼다(`renamed`). 거꾸로
 * 하면 파일은 치웠는데 DB 는 비어 있는 상태가 생긴다.
 *
 * 파일은 지우지 않고 `.migrated` 로 둔다. 가져오기에 문제가 있었다면 사용자가 되돌릴 수 있어야 한다.
 */
export function importLegacyMetaSnapshot(directory: string, store: MetaStore): LegacyImport {
  const legacyPath = join(directory, META_FILE_NAME);
  if (!existsSync(legacyPath)) return 'none';

  if (store.load() !== undefined) {
    renameSync(legacyPath, `${legacyPath}.migrated`);
    return 'renamed';
  }

  // 깨진 파일이면 JsonFileStore 가 `.corrupt-<시각>` 으로 격리하고 undefined 를 준다.
  const legacy = new JsonFileStore<MetaSnapshot>(directory, META_FILE_NAME).load();
  if (legacy === undefined) return 'none';

  store.save(migrateSnapshot(legacy));
  renameSync(legacyPath, `${legacyPath}.migrated`);
  return 'imported';
}
