use crate::BattleSnapshot;
use crate::domain::growth::{IntervalLevels, progression};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedGrowthPet {
    pub pet_id: String,
    pub display_name: String,
    pub rarity: PetRarity,
    pub level: u32,
    pub sprite: String,
    pub evolution_stage: u8,
    /// None keeps the selected pet visible without inventing persisted growth.
    pub total_xp: Option<u64>,
}

use crate::{
    BackgroundTheme, BattleConfig, BattleController, BattleEvent, BattleInput, BattleMode,
    CombatMotionSample, EnemyColorStage, EnemyPreviewAction, EnemyPreviewPhase, EnemyPreviewSize,
    MotionPreview, OverlayClick, OverlayFlow, OverlayPhase, OverlayVisual, PetBattleProgress,
    PetPreviewAction, PetRarity, PreviewMenu, sample_combat_motion,
};

const DEFAULT_CONFIG: BattleConfig = BattleConfig {
    common_interval_xp: 120,
    rare_interval_xp: 100,
    epic_interval_xp: 80,
    attack_cycle_ms: 2_400,
    animation_fps: 10,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum BattleCommand {
    SyncOwnedPets {
        pets: Vec<OwnedGrowthPet>,
        active_pet_id: Option<String>,
        spectator_pet_ids: Vec<String>,
        level_xp_costs: Vec<u64>,
        interval_levels: IntervalLevels,
        now_ms: u64,
    },
    GetState {
        now_ms: u64,
    },
    UpsertPet {
        pet_id: String,
        display_name: String,
        rarity: PetRarity,
        level: u32,
        sprite: String,
        evolution_stage: u8,
    },
    SetActivePet {
        pet_id: String,
    },
    SetPetSpectators {
        pet_ids: Vec<String>,
    },
    GrowthXpAdded {
        pet_id: String,
        amount: u64,
        now_ms: u64,
    },
    ToggleBattle,
    SetBattleRunning {
        running: bool,
    },
    OverlayClick {
        now_ms: u64,
    },
    ToggleMenu {
        menu: PreviewMenu,
    },
    PreviewPet {
        action: PetPreviewAction,
        now_ms: u64,
    },
    PreviewEnemy {
        action: EnemyPreviewAction,
        now_ms: u64,
    },
    CycleEnemySize,
    CycleEnemyColor,
    CycleEnemyHp,
    SetDisplayOpacity {
        percent: u8,
    },
    CyclePetAsset,
    CycleAttackEffect,
    ToggleReducedMotion,
}

impl BattleCommand {
    const fn now_ms(&self, fallback: u64) -> u64 {
        match self {
            Self::GetState { now_ms }
            | Self::SyncOwnedPets { now_ms, .. }
            | Self::GrowthXpAdded { now_ms, .. }
            | Self::OverlayClick { now_ms }
            | Self::PreviewPet { now_ms, .. }
            | Self::PreviewEnemy { now_ms, .. } => *now_ms,
            Self::UpsertPet { .. }
            | Self::SetActivePet { .. }
            | Self::SetPetSpectators { .. }
            | Self::ToggleBattle
            | Self::SetBattleRunning { .. }
            | Self::ToggleMenu { .. }
            | Self::CycleEnemySize
            | Self::CycleEnemyColor
            | Self::CycleEnemyHp
            | Self::SetDisplayOpacity { .. }
            | Self::CyclePetAsset
            | Self::CycleAttackEffect
            | Self::ToggleReducedMotion => fallback,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleRequest {
    pub request_id: String,
    pub command: BattleCommand,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum EngineEvent {
    XpApplied {
        pet_id: String,
        amount: u64,
        enemy_hp_ratio: f32,
    },
    EnemyDefeated {
        pet_id: String,
        defeated_stage: u32,
        next_stage: u32,
        skipped_stages: u64,
    },
    ModeChanged {
        pet_id: String,
        battle_mode: BattleMode,
    },
    ActivePetChanged {
        pet_id: String,
    },
    OverlayAdvanced {
        result: OverlayClick,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginePreviewState {
    pub display_opacity: f32,
    pub menu: PreviewMenu,
    pub pet_action: Option<PetPreviewAction>,
    pub enemy_action: Option<EnemyPreviewAction>,
    pub enemy_phase: EnemyPreviewPhase,
    pub enemy_size: Option<EnemyPreviewSize>,
    pub enemy_color: Option<EnemyColorStage>,
    pub enemy_hp_ratio: Option<f32>,
    pub pet_asset_rarity: Option<PetRarity>,
    pub attack_effect_rarity: Option<PetRarity>,
    pub reduced_motion: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub active_pet: Option<PetBattleProgress>,
    pub roster: Vec<PetBattleProgress>,
    pub spectator_pet_ids: Vec<String>,
    pub enemy_hp_ratio: f32,
    pub enemy_color: EnemyColorStage,
    pub background: BackgroundTheme,
    pub overlay: Option<OverlayVisual>,
    pub preview: EnginePreviewState,
    pub motion: CombatMotionSample,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleResponse {
    pub request_id: String,
    pub ok: bool,
    pub state: EngineState,
    pub events: Vec<EngineEvent>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub struct BattleEngine {
    controller: BattleController,
    overlay: OverlayFlow,
    preview: MotionPreview,
    reduced_motion: bool,
    now_ms: u64,
    attack_cycle_started_at_ms: Option<u64>,
    spectator_pet_ids: Vec<String>,
}

impl BattleEngine {
    #[must_use]
    pub fn demo() -> Self {
        Self {
            controller: BattleController::demo(DEFAULT_CONFIG),
            overlay: OverlayFlow::default(),
            preview: MotionPreview::default(),
            reduced_motion: false,
            now_ms: 0,
            attack_cycle_started_at_ms: None,
            spectator_pet_ids: vec!["lumi".to_owned(), "nova".to_owned(), "mori".to_owned()],
        }
    }

    pub fn handle(&mut self, request: BattleRequest) -> BattleResponse {
        self.now_ms = request.command.now_ms(self.now_ms);
        let now = self.now_seconds();
        self.overlay.tick(now);
        self.preview.tick(now);

        let mut events = Vec::new();
        match request.command {
            BattleCommand::SyncOwnedPets {
                pets,
                active_pet_id,
                spectator_pet_ids,
                level_xp_costs,
                interval_levels,
                ..
            } => {
                if let Err(error) = interval_levels.validate(&level_xp_costs) {
                    return self.error_response(request.request_id, error.to_owned());
                }
                let previous_active = self.controller.snapshot().active_pet_id.clone();
                let active = active_pet_id.filter(|id| pets.iter().any(|p| &p.pet_id == id));
                if previous_active != active {
                    self.overlay.reset();
                    self.preview.reset_actions();
                    self.attack_cycle_started_at_ms = None;
                }
                let mut roster = Vec::new();
                for input in pets {
                    let old = self.controller.pet(&input.pet_id);
                    let same_active = active.as_deref() == Some(input.pet_id.as_str())
                        && previous_active == active;
                    if same_active
                        && old.is_some_and(|previous| {
                            previous.synced_total_xp.is_some() != input.total_xp.is_some()
                        })
                    {
                        self.overlay.reset();
                        self.preview.reset_actions_preserving_display_opacity();
                    }
                    let (stage, interval_xp, target) =
                        input.total_xp.map_or((1, 0, None), |total_xp| {
                            let (stage, interval_xp, target) =
                                progression(total_xp, &level_xp_costs);
                            (stage, interval_xp, Some(target))
                        });
                    if let Some(previous) = old
                        && let Some(previous_xp) = previous.synced_total_xp
                        && let Some(total_xp) = input.total_xp
                        && let Some(target) = target
                        && same_active
                        && total_xp > previous_xp
                    {
                        if stage > previous.stage {
                            let defeated = self
                                .overlay
                                .visual(now)
                                .map_or(previous.stage, |v| v.defeated_stage);
                            self.overlay.begin_conquest(now, defeated, stage);
                            self.preview.reset_actions_preserving_display_opacity();
                            events.push(EngineEvent::EnemyDefeated {
                                pet_id: input.pet_id.clone(),
                                defeated_stage: previous.stage,
                                next_stage: stage,
                                skipped_stages: u64::from(stage - previous.stage - 1),
                            });
                        } else {
                            events.push(EngineEvent::XpApplied {
                                pet_id: input.pet_id.clone(),
                                amount: total_xp - previous_xp,
                                enemy_hp_ratio: 1.0 - interval_xp as f32 / target as f32,
                            });
                        }
                    }
                    let mut pet =
                        PetBattleProgress::new(input.pet_id, input.display_name, input.rarity);
                    pet.battle_mode = old.map_or(BattleMode::Fighting, |p| p.battle_mode);
                    pet.level = input.level;
                    pet.sprite = input.sprite;
                    pet.evolution_stage = input.evolution_stage;
                    pet.stage = stage;
                    pet.interval_xp = interval_xp;
                    pet.growth_target_xp = target;
                    pet.synced_total_xp = input.total_xp;
                    roster.push(pet);
                }
                self.spectator_pet_ids = spectator_pet_ids
                    .into_iter()
                    .filter(|id| {
                        Some(id) != active.as_ref() && roster.iter().any(|p| &p.pet_id == id)
                    })
                    .take(3)
                    .collect();
                self.controller = BattleController::new(
                    self.controller.config(),
                    BattleSnapshot {
                        active_pet_id: active,
                        pets: roster,
                    },
                );
                self.anchor_attack_cycle_if_needed();
            }
            BattleCommand::GetState { .. } => self.anchor_attack_cycle_if_needed(),
            BattleCommand::UpsertPet {
                pet_id,
                display_name,
                rarity,
                level,
                sprite,
                evolution_stage,
            } => {
                if let Some(event) = self.controller.handle_input(BattleInput::UpsertPet {
                    pet_id,
                    display_name,
                    rarity,
                    level,
                    sprite,
                    evolution_stage,
                }) {
                    events.push(engine_event(event.pet_id, event.event));
                }
            }
            BattleCommand::SetActivePet { pet_id } => {
                self.overlay.reset();
                self.preview.reset_actions();
                if let Some(event) = self
                    .controller
                    .handle_input(BattleInput::SetActivePet { pet_id })
                {
                    events.push(engine_event(event.pet_id, event.event));
                }
            }
            BattleCommand::SetPetSpectators { pet_ids } => {
                self.spectator_pet_ids = pet_ids.into_iter().take(3).collect();
            }
            BattleCommand::GrowthXpAdded { pet_id, amount, .. } => {
                if let Some(event) = self
                    .controller
                    .handle_input(BattleInput::GrowthXpAdded { pet_id, amount })
                {
                    if let BattleEvent::EnemyDefeated {
                        defeated_stage,
                        next_stage,
                        ..
                    } = event.event
                    {
                        self.overlay.begin_conquest(now, defeated_stage, next_stage);
                    }
                    events.push(engine_event(event.pet_id, event.event));
                }
            }
            BattleCommand::ToggleBattle => {
                if let Some(event) = self.controller.toggle_battle()
                    && let Some(pet_id) = self.controller.active_pet().map(|pet| pet.pet_id.clone())
                {
                    events.push(engine_event(pet_id, event));
                }
                self.sync_attack_cycle_anchor();
            }
            BattleCommand::SetBattleRunning { running } => {
                if self.controller.is_fighting() != running
                    && let Some(event) = self.controller.toggle_battle()
                    && let Some(pet_id) = self.controller.active_pet().map(|pet| pet.pet_id.clone())
                {
                    events.push(engine_event(pet_id, event));
                }
                self.attack_cycle_started_at_ms = running.then_some(self.now_ms);
            }
            BattleCommand::OverlayClick { .. } => {
                let result = self.overlay.click(now);
                if result != OverlayClick::NoTransition {
                    events.push(EngineEvent::OverlayAdvanced { result });
                }
            }
            BattleCommand::ToggleMenu { menu } => self.preview.toggle_menu(menu),
            BattleCommand::PreviewPet { action, .. } => self.preview.trigger_pet(action, now),
            BattleCommand::PreviewEnemy { action, .. } => self.preview.trigger_enemy(action, now),
            BattleCommand::CycleEnemySize => {
                let stage = self.visual_enemy_stage(self.overlay.visual(now));
                self.preview
                    .cycle_enemy_size(EnemyPreviewSize::for_stage(stage));
            }
            BattleCommand::CycleEnemyColor => {
                self.preview.cycle_enemy_color(self.canonical_enemy_color());
            }
            BattleCommand::CycleEnemyHp => {
                self.preview.cycle_enemy_hp(self.live_enemy_hp());
            }
            BattleCommand::SetDisplayOpacity { percent } => {
                self.preview
                    .set_display_opacity(f32::from(percent.min(100)) / 100.0);
            }
            BattleCommand::CyclePetAsset => {
                let rarity = self
                    .controller
                    .active_pet()
                    .map_or(PetRarity::Common, |pet| pet.rarity);
                self.preview.cycle_pet_asset_rarity(rarity);
            }
            BattleCommand::CycleAttackEffect => {
                let rarity = self
                    .controller
                    .active_pet()
                    .map_or(PetRarity::Common, |pet| pet.rarity);
                self.preview.cycle_attack_effect_rarity(rarity);
                self.preview.trigger_pet(PetPreviewAction::Attack, now);
            }
            BattleCommand::ToggleReducedMotion => self.reduced_motion = !self.reduced_motion,
        }

        BattleResponse {
            request_id: request.request_id,
            ok: true,
            state: self.state(),
            events,
            error: None,
        }
    }

    fn now_seconds(&self) -> f64 {
        self.now_ms as f64 / 1_000.0
    }

    fn anchor_attack_cycle_if_needed(&mut self) {
        if self.controller.is_fighting() && self.attack_cycle_started_at_ms.is_none() {
            self.attack_cycle_started_at_ms = Some(self.now_ms);
        }
    }

    fn sync_attack_cycle_anchor(&mut self) {
        self.attack_cycle_started_at_ms = self.controller.is_fighting().then_some(self.now_ms);
    }

    fn live_enemy_hp(&self) -> f32 {
        self.controller
            .active_pet()
            .map_or(1.0, |pet| pet.enemy_hp_ratio(self.controller.config()))
    }

    fn canonical_enemy_color(&self) -> EnemyColorStage {
        self.controller
            .active_pet()
            .map_or(EnemyColorStage::Red, PetBattleProgress::enemy_color_stage)
    }

    fn visual_enemy_stage(&self, overlay: Option<OverlayVisual>) -> u32 {
        let active_stage = self.controller.active_pet().map_or(1, |pet| pet.stage);
        overlay.map_or(active_stage, |visual| match visual.phase {
            OverlayPhase::Spawning => visual.next_stage,
            OverlayPhase::DefeatMotion | OverlayPhase::AwaitingAdvance => visual.defeated_stage,
            OverlayPhase::Fighting => active_stage,
        })
    }

    fn state(&self) -> EngineState {
        let now = self.now_seconds();
        let overlay = self.overlay.visual(now);
        let preview = self.preview.visual(now);
        let live_hp = self.live_enemy_hp();
        let visual_stage = self.visual_enemy_stage(overlay);
        let canonical_color = EnemyColorStage::for_stage(visual_stage);
        let enemy_color = if overlay.is_none() {
            preview.enemy_color_stage.unwrap_or(canonical_color)
        } else {
            canonical_color
        };
        let enemy_hp_ratio = match overlay.map(|visual| visual.phase) {
            Some(OverlayPhase::DefeatMotion | OverlayPhase::AwaitingAdvance) => 0.0,
            Some(_) => live_hp,
            None => preview.enemy_hp_ratio.unwrap_or(live_hp),
        };
        let phase = preview.pet_attack_phase.unwrap_or_else(|| {
            if self.controller.is_fighting() && overlay.is_none() {
                let elapsed = self
                    .now_ms
                    .saturating_sub(self.attack_cycle_started_at_ms.unwrap_or(self.now_ms));
                (0.43
                    + (elapsed % self.controller.config().attack_cycle_ms) as f64
                        / self.controller.config().attack_cycle_ms as f64)
                    .rem_euclid(1.0)
            } else {
                0.0
            }
        });
        let frame = (now * f64::from(self.controller.config().animation_fps)).floor() as u64;

        EngineState {
            active_pet: self.controller.active_pet().cloned(),
            roster: self.controller.snapshot().pets.clone(),
            spectator_pet_ids: self.spectator_pet_ids.clone(),
            enemy_hp_ratio,
            enemy_color,
            background: enemy_color.background(),
            overlay,
            preview: EnginePreviewState {
                display_opacity: preview.display_opacity.alpha(),
                menu: preview.menu,
                pet_action: preview.active_pet_action,
                enemy_action: preview.active_enemy_action,
                enemy_phase: preview.enemy_phase,
                enemy_size: preview.enemy_size,
                enemy_color: preview.enemy_color_stage,
                enemy_hp_ratio: preview.enemy_hp_ratio,
                pet_asset_rarity: preview.pet_asset_rarity,
                attack_effect_rarity: preview.attack_effect_rarity,
                reduced_motion: self.reduced_motion,
            },
            motion: sample_combat_motion(phase, frame, self.reduced_motion),
        }
    }

    fn error_response(&self, request_id: String, error: String) -> BattleResponse {
        BattleResponse {
            request_id,
            ok: false,
            state: self.state(),
            events: Vec::new(),
            error: Some(error),
        }
    }
}

fn engine_event(pet_id: String, event: BattleEvent) -> EngineEvent {
    match event {
        BattleEvent::XpApplied {
            amount,
            enemy_hp_ratio,
        } => EngineEvent::XpApplied {
            pet_id,
            amount,
            enemy_hp_ratio,
        },
        BattleEvent::EnemyDefeated {
            defeated_stage,
            next_stage,
            skipped_stages,
        } => EngineEvent::EnemyDefeated {
            pet_id,
            defeated_stage,
            next_stage,
            skipped_stages,
        },
        BattleEvent::ModeChanged(battle_mode) => EngineEvent::ModeChanged {
            pet_id,
            battle_mode,
        },
        BattleEvent::ActivePetChanged(pet_id) => EngineEvent::ActivePetChanged { pet_id },
    }
}

#[must_use]
pub fn handle_json_line(engine: &mut BattleEngine, line: &str) -> String {
    let response = match serde_json::from_str::<BattleRequest>(line) {
        Ok(request) => engine.handle(request),
        Err(error) => {
            let request_id = serde_json::from_str::<serde_json::Value>(line)
                .ok()
                .and_then(|value| value.get("requestId")?.as_str().map(str::to_owned))
                .unwrap_or_else(|| "invalid".to_owned());
            engine.error_response(request_id, error.to_string())
        }
    };
    serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(
            "{{\"requestId\":\"invalid\",\"ok\":false,\"error\":{:?}}}",
            error.to_string()
        )
    })
}
