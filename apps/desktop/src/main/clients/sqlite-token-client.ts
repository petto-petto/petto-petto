import type {
  ProviderTokenStats,
  TokenClient,
  TokenHistoryEntry,
  TokenTotals,
  UsageEntry,
} from '@pet/client';

import { TokenRepository } from '../persistence/repositories/token-repository.ts';
import { CurrencyRepository } from '../persistence/repositories/currency-repository.ts';

/** 소비자는 TokenClient만 의존하고, host가 열린 DB의 Repository를 이 구현체에 주입한다. */
export class SqliteTokenClient implements TokenClient {
  readonly #repository: TokenRepository;
  readonly #currency: CurrencyRepository | undefined;
  readonly #now: () => string;

  constructor(
    repository: TokenRepository,
    currency?: CurrencyRepository,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#currency = currency;
    this.#now = now;
  }

  #currencyRepository(): CurrencyRepository {
    if (!this.#currency) throw new Error('재화 원장이 연결되지 않았습니다.');
    return this.#currency;
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

  balance(): number {
    return this.#currencyRepository().balance();
  }

  grantOnce(key: string, amount: number, reason: string): boolean {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('지급 금액은 양의 안전 정수여야 합니다.');
    }
    if (key.trim().length === 0 || reason.trim().length === 0) {
      throw new Error('지급 키와 사유가 필요합니다.');
    }
    return this.#currencyRepository().recordGrant(key, amount, reason, this.#now());
  }

  spend(amount: number, reason: string): boolean {
    return this.#currencyRepository().trySpend(amount, reason, this.#now());
  }

  spendOnce(
    requestKey: string,
    amount: number,
    reason: string,
  ): 'spent' | 'already_spent' | 'insufficient' {
    return this.#currencyRepository().trySpendOnce(requestKey, amount, reason, this.#now());
  }
}
