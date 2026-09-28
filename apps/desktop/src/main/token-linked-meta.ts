import {
  MetaAppState,
  saveState,
  splitUsageKey,
  type AggregationRun,
  type MetaState,
} from '@pet/meta';
import type { Provider } from '@pet/core';
import type { SqliteFileDatabase } from './persistence/sqlite-file.ts';
import type { TokenGrowthLink } from './token-growth.ts';

/** App assembly: the meta feature stays unaware of token/growth consumers. */
export class TokenLinkedMetaState extends MetaAppState {
  #connection: { database: SqliteFileDatabase; growth: TokenGrowthLink } | undefined;
  #skipSeed = false;

  connectGrowth(database: SqliteFileDatabase, growth: TokenGrowthLink): void {
    this.#connection = { database, growth };
  }

  override seedDemoUsage(): void {
    this.#skipSeed = this.isFreshInstall;
    super.seedDemoUsage();
  }

  override aggregate(): ReturnType<MetaAppState['aggregate']> {
    return this.#run(() => super.aggregate());
  }

  override rescan(provider: Provider): ReturnType<MetaAppState['rescan']> {
    return this.#run(() => super.rescan(provider));
  }

  #run<T extends { run: AggregationRun }>(collect: () => T): T {
    const connection = this.#connection;
    if (!connection) return collect();
    const previous = structuredClone(this.meta);
    const before = growthTotals(previous);
    const skip = this.#skipSeed;
    try {
      const result = connection.database.transaction(() => {
        const outcome = collect();
        const after = growthTotals(this.meta);
        if (!skip)
          for (const source of outcome.run.outcomes) {
            if (source.result.kind !== 'applied' || !source.appliedDedupeKey) continue;
            connection.growth.record(
              {
                provider: source.provider,
                dedupeKey: source.appliedDedupeKey,
                observed: source.result.observedDelta,
                reward: source.result.rewardTokens,
                occurredAt: this.clock.now().toISOString(),
              },
              (after.get(source.provider) ?? 0) - (before.get(source.provider) ?? 0),
            );
          }
        // Unlike persist(), failures must propagate so the input baseline also rolls back.
        saveState(this.store, this.meta);
        return outcome;
      });
      this.#skipSeed = false;
      return result;
    } catch (error) {
      this.meta = previous;
      throw error;
    }
  }
}

function growthTotals(meta: MetaState): Map<Provider, number> {
  const totals = new Map<Provider, number>();
  for (const [key, counts] of meta.usageDaily) {
    const { provider } = splitUsageKey(key);
    totals.set(provider, (totals.get(provider) ?? 0) + counts.input + counts.output);
  }
  return totals;
}
