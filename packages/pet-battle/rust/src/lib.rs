//! Battle domain, presentation state, and JSON-lines sidecar protocol.

mod application;
mod domain;
mod presentation;
mod protocol;

pub use application::{
    AssetVersion, BattleController, BattleInput, BattleInputReceiver, BattleInputSender,
    DisplayOpacity, EnemyPreviewAction, EnemyPreviewPhase, EnemyPreviewSize, MotionPreview,
    MotionPreviewVisual, OverlayClick, OverlayFlow, OverlayPhase, OverlayVisual, PetBattleEvent,
    PetPreviewAction, PreviewMenu, battle_input_channel,
};
pub use domain::{
    BackgroundTheme, BattleConfig, BattleEvent, BattleMode, BattleSnapshot, EnemyColorStage,
    PetBattleProgress, PetRarity,
};
pub use presentation::{CombatBeat, CombatMotionSample, Vec2, sample_combat_motion};
pub use protocol::{
    BattleCommand, BattleEngine, BattleRequest, BattleResponse, EngineEvent, EnginePreviewState,
    EngineState, handle_json_line,
};
