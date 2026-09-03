const DEFEAT_MOTION_SECONDS: f64 = 1.48;
const SPAWN_MOTION_SECONDS: f64 = 0.72;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OverlayPhase {
    #[default]
    Fighting,
    DefeatMotion,
    AwaitingAdvance,
    Spawning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OverlayClick {
    NoTransition,
    DefeatMotionSkipped,
    NextStageStarted,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayVisual {
    pub phase: OverlayPhase,
    pub elapsed: f64,
    pub defeated_stage: u32,
    pub next_stage: u32,
}

#[derive(Debug, Clone, Copy)]
enum OverlayState {
    Fighting,
    DefeatMotion {
        started_at: f64,
        defeated_stage: u32,
        next_stage: u32,
    },
    AwaitingAdvance {
        defeated_stage: u32,
        next_stage: u32,
    },
    Spawning {
        started_at: f64,
        defeated_stage: u32,
        next_stage: u32,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct OverlayFlow {
    state: OverlayState,
}

impl Default for OverlayFlow {
    fn default() -> Self {
        Self {
            state: OverlayState::Fighting,
        }
    }
}

impl OverlayFlow {
    pub fn begin_conquest(&mut self, now: f64, defeated_stage: u32, next_stage: u32) {
        self.state = OverlayState::DefeatMotion {
            started_at: now,
            defeated_stage,
            next_stage,
        };
    }

    pub fn reset(&mut self) {
        self.state = OverlayState::Fighting;
    }

    pub fn tick(&mut self, now: f64) {
        match self.state {
            OverlayState::DefeatMotion {
                started_at,
                defeated_stage,
                next_stage,
            } if now - started_at >= DEFEAT_MOTION_SECONDS => {
                self.state = OverlayState::AwaitingAdvance {
                    defeated_stage,
                    next_stage,
                };
            }
            OverlayState::Spawning { started_at, .. }
                if now - started_at >= SPAWN_MOTION_SECONDS =>
            {
                self.state = OverlayState::Fighting;
            }
            _ => {}
        }
    }

    #[must_use]
    pub const fn phase(self) -> OverlayPhase {
        match self.state {
            OverlayState::Fighting => OverlayPhase::Fighting,
            OverlayState::DefeatMotion { .. } => OverlayPhase::DefeatMotion,
            OverlayState::AwaitingAdvance { .. } => OverlayPhase::AwaitingAdvance,
            OverlayState::Spawning { .. } => OverlayPhase::Spawning,
        }
    }

    pub fn click(&mut self, now: f64) -> OverlayClick {
        match self.state {
            OverlayState::DefeatMotion {
                defeated_stage,
                next_stage,
                ..
            } => {
                self.state = OverlayState::AwaitingAdvance {
                    defeated_stage,
                    next_stage,
                };
                OverlayClick::DefeatMotionSkipped
            }
            OverlayState::AwaitingAdvance {
                defeated_stage,
                next_stage,
            } => {
                self.state = OverlayState::Spawning {
                    started_at: now,
                    defeated_stage,
                    next_stage,
                };
                OverlayClick::NextStageStarted
            }
            OverlayState::Fighting | OverlayState::Spawning { .. } => OverlayClick::NoTransition,
        }
    }

    #[must_use]
    pub fn visual(self, now: f64) -> Option<OverlayVisual> {
        match self.state {
            OverlayState::Fighting => None,
            OverlayState::DefeatMotion {
                started_at,
                defeated_stage,
                next_stage,
            } => Some(OverlayVisual {
                phase: OverlayPhase::DefeatMotion,
                elapsed: (now - started_at).max(0.0),
                defeated_stage,
                next_stage,
            }),
            OverlayState::AwaitingAdvance {
                defeated_stage,
                next_stage,
            } => Some(OverlayVisual {
                phase: OverlayPhase::AwaitingAdvance,
                elapsed: DEFEAT_MOTION_SECONDS,
                defeated_stage,
                next_stage,
            }),
            OverlayState::Spawning {
                started_at,
                defeated_stage,
                next_stage,
            } => Some(OverlayVisual {
                phase: OverlayPhase::Spawning,
                elapsed: (now - started_at).max(0.0),
                defeated_stage,
                next_stage,
            }),
        }
    }
}
use serde::{Deserialize, Serialize};
