use serde::{Deserialize, Serialize};

use super::PetRarity;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleConfig {
    pub common_interval_xp: u64,
    pub rare_interval_xp: u64,
    pub epic_interval_xp: u64,
    pub attack_cycle_ms: u64,
    pub animation_fps: u16,
}

impl BattleConfig {
    #[must_use]
    pub const fn target_xp(self, rarity: PetRarity) -> u64 {
        match rarity {
            PetRarity::Common => self.common_interval_xp,
            PetRarity::Rare => self.rare_interval_xp,
            PetRarity::Epic => self.epic_interval_xp,
        }
    }

    pub fn validate(self) -> Result<Self, &'static str> {
        if self.common_interval_xp == 0 || self.rare_interval_xp == 0 || self.epic_interval_xp == 0
        {
            return Err("rarity interval XP must be greater than zero");
        }
        if !(8..=12).contains(&self.animation_fps) {
            return Err("animation FPS must stay between 8 and 12");
        }
        if !(2_000..=3_000).contains(&self.attack_cycle_ms) {
            return Err("attack cycle must stay between 2 and 3 seconds");
        }
        Ok(self)
    }
}
