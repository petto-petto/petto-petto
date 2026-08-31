//! Battle domain, presentation state, and JSON-lines sidecar protocol.

mod application;
mod asset_pipeline;
mod domain;
mod presentation;
mod protocol;

pub use application::{
    AssetVersion, BattleController, BattleInput, BattleInputReceiver, BattleInputSender,
    DisplayOpacity, EnemyPreviewAction, EnemyPreviewPhase, EnemyPreviewSize, MotionPreview,
    MotionPreviewVisual, OverlayClick, OverlayFlow, OverlayPhase, OverlayVisual, PetBattleEvent,
    PetPreviewAction, PreviewMenu, battle_input_channel,
};
pub use asset_pipeline::{colorize_enemy_image, generate_enemy_asset_set, rainbow_mottle_color};
pub use domain::{
    BackgroundTheme, BattleConfig, BattleEvent, BattleMode, BattleSnapshot, EnemyColorStage,
    PetBattleProgress, PetRarity,
};
pub use presentation::{CombatBeat, CombatMotionSample, Vec2, sample_combat_motion};
pub use protocol::{
    BattleCommand, BattleEngine, BattleRequest, BattleResponse, EngineEvent, EnginePreviewState,
    EngineState, handle_json_line,
};
