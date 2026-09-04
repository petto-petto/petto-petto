use serde::{Deserialize, Serialize};

use super::BattleConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PetRarity {
    Common,
    Rare,
    Epic,
}

impl PetRarity {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Common => "COMMON",
            Self::Rare => "RARE",
            Self::Epic => "EPIC",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BattleMode {
    Fighting,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyColorStage {
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    Rainbow,
}

impl EnemyColorStage {
    #[must_use]
    pub const fn for_stage(stage: u32) -> Self {
        match (stage.saturating_sub(1)) % 7 {
            0 => Self::Red,
            1 => Self::Orange,
            2 => Self::Yellow,
            3 => Self::Green,
            4 => Self::Blue,
            5 => Self::Purple,
            _ => Self::Rainbow,
        }
    }

    #[must_use]
    pub const fn background(self) -> BackgroundTheme {
        match self {
            Self::Red | Self::Orange | Self::Yellow => BackgroundTheme::MushroomForest,
            Self::Green | Self::Blue | Self::Purple => BackgroundTheme::CrystalRuins,
            Self::Rainbow => BackgroundTheme::StarlightShrine,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackgroundTheme {
    MushroomForest,
    CrystalRuins,
    StarlightShrine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetBattleProgress {
    pub pet_id: String,
    pub display_name: String,
    pub rarity: PetRarity,
    pub stage: u32,
    pub interval_xp: u64,
    pub battle_mode: BattleMode,
}

impl PetBattleProgress {
    #[must_use]
    pub fn new(
        pet_id: impl Into<String>,
        display_name: impl Into<String>,
        rarity: PetRarity,
    ) -> Self {
        Self {
            pet_id: pet_id.into(),
            display_name: display_name.into(),
            rarity,
            stage: 1,
            interval_xp: 0,
            battle_mode: BattleMode::Fighting,
        }
    }

    #[must_use]
    pub fn enemy_id(&self) -> String {
        format!("enemy-{:03}", self.stage)
    }

    #[must_use]
    pub const fn enemy_color_stage(&self) -> EnemyColorStage {
        EnemyColorStage::for_stage(self.stage)
    }

    #[must_use]
    pub fn enemy_hp_ratio(&self, config: BattleConfig) -> f32 {
        let target = config.target_xp(self.rarity);
        1.0 - (self.interval_xp.min(target) as f32 / target as f32)
    }

    pub fn toggle_battle(&mut self) -> BattleEvent {
        self.battle_mode = match self.battle_mode {
            BattleMode::Fighting => BattleMode::Paused,
            BattleMode::Paused => BattleMode::Fighting,
        };
        BattleEvent::ModeChanged(self.battle_mode)
    }

    pub fn apply_growth_xp(&mut self, amount: u64, config: BattleConfig) -> BattleEvent {
        let target = config.target_xp(self.rarity);
        let total = self.interval_xp.saturating_add(amount);
        let conquered = total / target;
        self.interval_xp = total % target;

        if conquered == 0 {
            return BattleEvent::XpApplied {
                amount,
                enemy_hp_ratio: self.enemy_hp_ratio(config),
            };
        }

        let defeated_stage = self.stage;
        self.stage = self
            .stage
            .saturating_add(u32::try_from(conquered).unwrap_or(u32::MAX));
        BattleEvent::EnemyDefeated {
            defeated_stage,
            next_stage: self.stage,
            skipped_stages: conquered.saturating_sub(1),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum BattleEvent {
    XpApplied {
        amount: u64,
        enemy_hp_ratio: f32,
    },
    EnemyDefeated {
        defeated_stage: u32,
        next_stage: u32,
        skipped_stages: u64,
    },
    ModeChanged(BattleMode),
    ActivePetChanged(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleSnapshot {
    pub active_pet_id: Option<String>,
    pub pets: Vec<PetBattleProgress>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: BattleConfig = BattleConfig {
        common_interval_xp: 120,
        rare_interval_xp: 100,
        epic_interval_xp: 80,
        attack_cycle_ms: 2_400,
        animation_fps: 10,
    };

    #[test]
    fn enemy_hp_is_inverse_growth_progress() {
        let mut pet = PetBattleProgress::new("mio", "미오", PetRarity::Rare);
        pet.interval_xp = 25;

        assert!((pet.enemy_hp_ratio(CONFIG) - 0.75).abs() < f32::EPSILON);
    }

    #[test]
    fn rarity_targets_keep_intended_small_gap() {
        assert_eq!(CONFIG.target_xp(PetRarity::Common), 120);
        assert_eq!(CONFIG.target_xp(PetRarity::Rare), 100);
        assert_eq!(CONFIG.target_xp(PetRarity::Epic), 80);
    }

    #[test]
    fn conquest_advances_stage_and_keeps_overflow() {
        let mut pet = PetBattleProgress::new("mio", "미오", PetRarity::Rare);
        pet.interval_xp = 90;

        let event = pet.apply_growth_xp(25, CONFIG);

        assert_eq!(pet.stage, 2);
        assert_eq!(pet.interval_xp, 15);
        assert_eq!(
            event,
            BattleEvent::EnemyDefeated {
                defeated_stage: 1,
                next_stage: 2,
                skipped_stages: 0,
            }
        );
    }

    #[test]
    fn large_growth_jump_reports_only_additional_skipped_stages() {
        let mut pet = PetBattleProgress::new("nova", "노바", PetRarity::Epic);

        let event = pet.apply_growth_xp(250, CONFIG);

        assert_eq!(pet.stage, 4);
        assert_eq!(pet.interval_xp, 10);
        assert_eq!(
            event,
            BattleEvent::EnemyDefeated {
                defeated_stage: 1,
                next_stage: 4,
                skipped_stages: 2,
            }
        );
    }

    #[test]
    fn enemy_visuals_cycle_through_all_seven_color_stages() {
        assert_eq!(EnemyColorStage::for_stage(1), EnemyColorStage::Red);
        assert_eq!(EnemyColorStage::for_stage(4), EnemyColorStage::Green);
        assert_eq!(EnemyColorStage::for_stage(7), EnemyColorStage::Rainbow);
        assert_eq!(EnemyColorStage::for_stage(8), EnemyColorStage::Red);
    }
}
