use super::PetRarity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub struct IntervalLevels {
    pub common: u32,
    pub rare: u32,
    pub epic: u32,
}

impl IntervalLevels {
    pub fn for_rarity(&self, rarity: PetRarity) -> u32 {
        match rarity {
            PetRarity::Common => self.common,
            PetRarity::Rare => self.rare,
            PetRarity::Epic => self.epic,
        }
    }

    pub fn validate(&self, costs: &[u64]) -> Result<(), &'static str> {
        if costs.is_empty()
            || costs.len() > 100
            || costs.iter().any(|xp| *xp == 0 || *xp > 1_000_000)
        {
            return Err("invalid growth XP curve");
        }
        if [self.common, self.rare, self.epic]
            .iter()
            .any(|n| !(1..=100).contains(n))
        {
            return Err("invalid rarity level interval");
        }
        Ok(())
    }
}

/// Levels describe XP intervals, not a direct level-number division.
/// Beyond the level cap, continue with the last level's cost; no unbounded loop.
pub fn progression(total_xp: u64, levels: u32, costs: &[u64]) -> (u32, u64, u64) {
    let mut remaining = total_xp;
    let mut stage = 1u32;
    let mut start = 0usize;
    let last = costs[costs.len() - 1];
    while start < costs.len() {
        let target: u64 = (start..start + levels as usize)
            .map(|i| costs.get(i).copied().unwrap_or(last))
            .sum();
        if remaining < target {
            return (stage, remaining, target);
        }
        remaining -= target;
        stage += 1;
        start += levels as usize;
    }
    let target = last * u64::from(levels);
    let extra = u32::try_from(remaining / target).unwrap_or(u32::MAX);
    (stage.saturating_add(extra), remaining % target, target)
}
