use serde::{Deserialize, Serialize};

/// Small, medium and large enemies consume 2, 2 and 3 level advances.
/// Seven colors therefore complete 49 advances, from Lv.1 through Lv.50.
const LEVELS_PER_SIZE: [usize; 3] = [2, 2, 3];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub struct IntervalLevels {
    pub common: u32,
    pub rare: u32,
    pub epic: u32,
}

impl IntervalLevels {
    // Retained for host protocol compatibility, not for rarity-dependent progression.
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

/// Restore stage and HP from persisted XP; the validated curve is never restarted.
/// Work is bounded by the curve length plus two residual stages, even at u64::MAX.
pub fn progression(total_xp: u64, costs: &[u64]) -> (u32, u64, u64) {
    let mut remaining = total_xp;
    let mut stage = 1u64;
    let mut start = 0usize;
    let last = costs[costs.len() - 1];
    while start < costs.len() {
        let levels = levels_for_stage(stage);
        let target: u64 = (start..start + levels)
            .map(|i| costs.get(i).copied().unwrap_or(last))
            .sum();
        if remaining < target {
            return (bounded_stage(stage), remaining, target);
        }
        remaining -= target;
        stage += 1;
        start += levels;
    }

    // Any three consecutive sizes cost seven last-level advances, regardless of phase.
    let color_target = last * LEVELS_PER_SIZE.iter().sum::<usize>() as u64;
    let complete_colors = remaining / color_target;
    stage += complete_colors * LEVELS_PER_SIZE.len() as u64;
    remaining %= color_target;
    for _ in 0..LEVELS_PER_SIZE.len() - 1 {
        let target = last * levels_for_stage(stage) as u64;
        if remaining < target {
            break;
        }
        remaining -= target;
        stage += 1;
    }
    (
        bounded_stage(stage),
        remaining,
        last * levels_for_stage(stage) as u64,
    )
}

fn levels_for_stage(stage: u64) -> usize {
    LEVELS_PER_SIZE[((stage - 1) % LEVELS_PER_SIZE.len() as u64) as usize]
}

fn bounded_stage(stage: u64) -> u32 {
    // Preserve the existing wire representation instead of overflowing at extreme XP.
    u32::try_from(stage).unwrap_or(u32::MAX)
}
