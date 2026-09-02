use serde::{Deserialize, Serialize};

use crate::domain::{EnemyColorStage, PetRarity};

const PET_ATTACK_SECONDS: f64 = 0.96;
const PET_GROWTH_SECONDS: f64 = 0.78;
const ENEMY_HIT_SECONDS: f64 = 0.42;
const ENEMY_DEFEAT_SECONDS: f64 = 1.10;
const ENEMY_SPAWN_SECONDS: f64 = 0.72;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DisplayOpacity(f32);

impl DisplayOpacity {
    pub const FULL: Self = Self(1.0);

    #[must_use]
    pub fn new(alpha: f32) -> Self {
        Self(alpha.clamp(0.0, 1.0))
    }

    #[must_use]
    pub const fn alpha(self) -> f32 {
        self.0
    }

    #[must_use]
    pub fn percent(self) -> u8 {
        (self.0 * 100.0).round() as u8
    }
}

impl Default for DisplayOpacity {
    fn default() -> Self {
        Self::FULL
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreviewMenu {
    #[default]
    Closed,
    Pet,
    Enemy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PetPreviewAction {
    Attack,
    Growth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyPreviewAction {
    Hit,
    Defeat,
    Spawn,
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyPreviewSize {
    Small,
    Medium,
    Large,
}

impl EnemyPreviewSize {
    #[must_use]
    pub const fn height(self) -> f32 {
        match self {
            Self::Small => 56.0,
            Self::Medium => 64.0,
            Self::Large => 80.0,
        }
    }

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Small => "소형",
            Self::Medium => "중형",
            Self::Large => "대형",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyPreviewPhase {
    #[default]
    Visible,
    Hit,
    Defeating,
    Hidden,
    Spawning,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionPreviewVisual {
    pub display_opacity: DisplayOpacity,
    pub menu: PreviewMenu,
    pub pet_attack_phase: Option<f64>,
    pub growth_elapsed: Option<f64>,
    pub active_pet_action: Option<PetPreviewAction>,
    pub attack_effect_rarity: Option<PetRarity>,
    pub enemy_phase: EnemyPreviewPhase,
    pub enemy_elapsed: f64,
    pub active_enemy_action: Option<EnemyPreviewAction>,
    pub enemy_size: Option<EnemyPreviewSize>,
    pub enemy_color_stage: Option<EnemyColorStage>,
    pub enemy_hp_ratio: Option<f32>,
}

#[derive(Debug, Clone, Copy)]
enum PetPreviewState {
    Idle,
    Attack { started_at: f64 },
    Growth { started_at: f64 },
}

#[derive(Debug, Clone, Copy)]
enum EnemyPreviewState {
    Visible,
    Hit { started_at: f64 },
    Defeating { started_at: f64 },
    Hidden,
    Spawning { started_at: f64 },
}

#[derive(Debug, Clone, Copy)]
pub struct MotionPreview {
    display_opacity: DisplayOpacity,
    menu: PreviewMenu,
    pet: PetPreviewState,
    attack_effect_rarity: Option<PetRarity>,
    enemy: EnemyPreviewState,
    enemy_size: Option<EnemyPreviewSize>,
    enemy_color_stage: Option<EnemyColorStage>,
    enemy_hp_ratio: Option<f32>,
}

impl Default for MotionPreview {
    fn default() -> Self {
        Self {
            display_opacity: DisplayOpacity::FULL,
            menu: PreviewMenu::Closed,
            pet: PetPreviewState::Idle,
            attack_effect_rarity: None,
            enemy: EnemyPreviewState::Visible,
            enemy_size: None,
            enemy_color_stage: None,
            enemy_hp_ratio: None,
        }
    }
}

impl MotionPreview {
    pub fn reset_actions(&mut self) {
        self.menu = PreviewMenu::Closed;
        self.display_opacity = DisplayOpacity::FULL;
        self.pet = PetPreviewState::Idle;
        self.attack_effect_rarity = None;
        self.enemy = EnemyPreviewState::Visible;
        self.reset_enemy_overrides();
    }

    pub fn toggle_menu(&mut self, menu: PreviewMenu) {
        self.menu = if self.menu == menu {
            PreviewMenu::Closed
        } else {
            menu
        };
    }

    pub fn close_menu(&mut self) {
        self.menu = PreviewMenu::Closed;
    }

    #[must_use]
    pub const fn menu(&self) -> PreviewMenu {
        self.menu
    }

    pub fn trigger_pet(&mut self, action: PetPreviewAction, now: f64) {
        self.pet = match action {
            PetPreviewAction::Attack => PetPreviewState::Attack { started_at: now },
            PetPreviewAction::Growth => PetPreviewState::Growth { started_at: now },
        };
    }

    pub fn cycle_attack_effect_rarity(&mut self, active_rarity: PetRarity) -> PetRarity {
        let next = match self.attack_effect_rarity {
            None => active_rarity,
            Some(PetRarity::Common) => PetRarity::Rare,
            Some(PetRarity::Rare) => PetRarity::Epic,
            Some(PetRarity::Epic) => PetRarity::Common,
        };
        self.attack_effect_rarity = Some(next);
        next
    }

    pub fn trigger_enemy(&mut self, action: EnemyPreviewAction, now: f64) {
        if action == EnemyPreviewAction::Reset {
            self.reset_enemy_overrides();
        }
        self.enemy = match action {
            EnemyPreviewAction::Hit => EnemyPreviewState::Hit { started_at: now },
            EnemyPreviewAction::Defeat => EnemyPreviewState::Defeating { started_at: now },
            EnemyPreviewAction::Spawn => EnemyPreviewState::Spawning { started_at: now },
            EnemyPreviewAction::Reset => EnemyPreviewState::Visible,
        };
    }

    pub fn cycle_enemy_size(&mut self) -> EnemyPreviewSize {
        let next = match self.enemy_size.unwrap_or(EnemyPreviewSize::Large) {
            EnemyPreviewSize::Large => EnemyPreviewSize::Small,
            EnemyPreviewSize::Small => EnemyPreviewSize::Medium,
            EnemyPreviewSize::Medium => EnemyPreviewSize::Large,
        };
        self.enemy_size = Some(next);
        next
    }

    pub fn cycle_enemy_color(&mut self, current: EnemyColorStage) -> EnemyColorStage {
        let next = match self.enemy_color_stage.unwrap_or(current) {
            EnemyColorStage::Red => EnemyColorStage::Orange,
            EnemyColorStage::Orange => EnemyColorStage::Yellow,
            EnemyColorStage::Yellow => EnemyColorStage::Green,
            EnemyColorStage::Green => EnemyColorStage::Blue,
            EnemyColorStage::Blue => EnemyColorStage::Purple,
            EnemyColorStage::Purple => EnemyColorStage::Rainbow,
            EnemyColorStage::Rainbow => EnemyColorStage::Red,
        };
        self.enemy_color_stage = Some(next);
        next
    }

    pub fn cycle_enemy_hp(&mut self, current: f32) -> f32 {
        let current = self.enemy_hp_ratio.unwrap_or(current).clamp(0.0, 1.0);
        let next = if current > 0.70 {
            0.60
        } else if current > 0.35 {
            0.25
        } else {
            1.0
        };
        self.enemy_hp_ratio = Some(next);
        next
    }

    pub fn set_display_opacity(&mut self, alpha: f32) -> DisplayOpacity {
        self.display_opacity = DisplayOpacity::new(alpha);
        self.display_opacity
    }

    fn reset_enemy_overrides(&mut self) {
        self.enemy_size = None;
        self.enemy_color_stage = None;
        self.enemy_hp_ratio = None;
    }

    pub fn tick(&mut self, now: f64) {
        match self.pet {
            PetPreviewState::Attack { started_at } if now - started_at >= PET_ATTACK_SECONDS => {
                self.pet = PetPreviewState::Idle;
            }
            PetPreviewState::Growth { started_at } if now - started_at >= PET_GROWTH_SECONDS => {
                self.pet = PetPreviewState::Idle;
            }
            _ => {}
        }

        match self.enemy {
            EnemyPreviewState::Hit { started_at } if now - started_at >= ENEMY_HIT_SECONDS => {
                self.enemy = EnemyPreviewState::Visible;
            }
            EnemyPreviewState::Defeating { started_at }
                if now - started_at >= ENEMY_DEFEAT_SECONDS =>
            {
                self.enemy = EnemyPreviewState::Hidden;
            }
            EnemyPreviewState::Spawning { started_at }
                if now - started_at >= ENEMY_SPAWN_SECONDS =>
            {
                self.enemy = EnemyPreviewState::Visible;
            }
            _ => {}
        }
    }

    #[must_use]
    pub fn visual(&self, now: f64) -> MotionPreviewVisual {
        let (pet_attack_phase, growth_elapsed, active_pet_action) = match self.pet {
            PetPreviewState::Idle => (None, None, None),
            PetPreviewState::Attack { started_at } => {
                let progress = ((now - started_at) / PET_ATTACK_SECONDS).clamp(0.0, 1.0);
                (
                    Some(0.43 + progress * 0.47),
                    None,
                    Some(PetPreviewAction::Attack),
                )
            }
            PetPreviewState::Growth { started_at } => (
                None,
                Some((now - started_at).max(0.0)),
                Some(PetPreviewAction::Growth),
            ),
        };

        let (enemy_phase, enemy_elapsed, active_enemy_action) = match self.enemy {
            EnemyPreviewState::Visible => (EnemyPreviewPhase::Visible, 0.0, None),
            EnemyPreviewState::Hit { started_at } => (
                EnemyPreviewPhase::Hit,
                (now - started_at).max(0.0),
                Some(EnemyPreviewAction::Hit),
            ),
            EnemyPreviewState::Defeating { started_at } => (
                EnemyPreviewPhase::Defeating,
                (now - started_at).max(0.0),
                Some(EnemyPreviewAction::Defeat),
            ),
            EnemyPreviewState::Hidden => (EnemyPreviewPhase::Hidden, 0.0, None),
            EnemyPreviewState::Spawning { started_at } => (
                EnemyPreviewPhase::Spawning,
                (now - started_at).max(0.0),
                Some(EnemyPreviewAction::Spawn),
            ),
        };

        MotionPreviewVisual {
            display_opacity: self.display_opacity,
            menu: self.menu,
            pet_attack_phase,
            growth_elapsed,
            active_pet_action,
            attack_effect_rarity: self.attack_effect_rarity,
            enemy_phase,
            enemy_elapsed,
            active_enemy_action,
            enemy_size: self.enemy_size,
            enemy_color_stage: self.enemy_color_stage,
            enemy_hp_ratio: self.enemy_hp_ratio,
        }
    }
}
