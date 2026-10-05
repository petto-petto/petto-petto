export interface BattlePetGrowthSnapshot {
  level: number;
  totalXp: number;
  evolutionStage: number;
}

/** Read-only bridge to the feature that owns persisted per-pet growth. */
export interface BattleGrowthReader {
  readOwnedPetGrowth(ownedPetIds: readonly string[]): ReadonlyMap<string, BattlePetGrowthSnapshot>;
}
