import type {
  ProviderTokenStats,
  TokenClient,
  TokenHistoryEntry,
  TokenTotals,
  UsageEntry,
} from '@pet/client';

import { TokenRepository } from '../persistence/repositories/token-repository.ts';

/** 소비자는 TokenClient만 의존하고, host가 열린 DB의 Repository를 이 구현체에 주입한다. */
export class SqliteTokenClient implements TokenClient {
  readonly #repository: TokenRepository;

  constructor(repository: TokenRepository) {
    this.#repository = repository;
  }

  recordUsage(entry: UsageEntry): boolean {
    return this.#repository.recordUsage(entry);
  }

  statsByProvider(): ProviderTokenStats[] {
    return this.#repository.statsByProvider();
  }

  totals(): TokenTotals {
    return this.#repository.totals();
  }

  recentHistory(limit: number): TokenHistoryEntry[] {
    return this.#repository.recentHistory(limit);
  }
}
