use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };

    #[must_use]
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    #[must_use]
    pub const fn splat(value: f32) -> Self {
        Self { x: value, y: value }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CombatBeat {
    Idle,
    Anticipation,
    Dash,
    Impact,
    Recovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatMotionSample {
    pub beat: CombatBeat,
    pub pet_offset: Vec2,
    pub enemy_offset: Vec2,
    pub pet_scale: Vec2,
    pub enemy_scale: Vec2,
    pub speed_line_opacity: f32,
    pub slash_opacity: f32,
    pub impact_flash_opacity: f32,
    pub afterimage_opacity: f32,
}

impl Default for CombatMotionSample {
    fn default() -> Self {
        Self {
            beat: CombatBeat::Idle,
            pet_offset: Vec2::ZERO,
            enemy_offset: Vec2::ZERO,
            pet_scale: Vec2::splat(1.0),
            enemy_scale: Vec2::splat(1.0),
            speed_line_opacity: 0.0,
            slash_opacity: 0.0,
            impact_flash_opacity: 0.0,
            afterimage_opacity: 0.0,
        }
    }
}

#[must_use]
pub fn sample_combat_motion(phase: f64, frame: u64, reduced_motion: bool) -> CombatMotionSample {
    let phase = phase.rem_euclid(1.0);
    if reduced_motion {
        if (0.63..0.70).contains(&phase) {
            return CombatMotionSample {
                beat: CombatBeat::Impact,
                slash_opacity: 0.72,
                impact_flash_opacity: 0.28,
                ..Default::default()
            };
        }
        return CombatMotionSample::default();
    }

    if (0.43..0.52).contains(&phase) {
        let progress = normalized(phase, 0.43, 0.52);
        let eased = smoothstep(progress);
        return CombatMotionSample {
            beat: CombatBeat::Anticipation,
            pet_offset: Vec2::new(-8.0 * eased, 2.0 * eased),
            pet_scale: Vec2::new(1.0 + 0.10 * eased, 1.0 - 0.12 * eased),
            ..Default::default()
        };
    }

    if (0.52..0.635).contains(&phase) {
        let progress = normalized(phase, 0.52, 0.635);
        let eased = 1.0 - (1.0 - progress).powi(3);
        return CombatMotionSample {
            beat: CombatBeat::Dash,
            pet_offset: Vec2::new(
                -8.0 + 55.0 * eased,
                -2.0 * (progress * std::f32::consts::PI).sin(),
            ),
            pet_scale: Vec2::new(0.93, 1.06),
            speed_line_opacity: (progress * 1.35).clamp(0.0, 1.0),
            afterimage_opacity: (0.48 * progress).clamp(0.0, 0.48),
            ..Default::default()
        };
    }

    if (0.635..0.70).contains(&phase) {
        let progress = normalized(phase, 0.635, 0.70);
        let shake = if frame.is_multiple_of(2) { 6.0 } else { -6.0 };
        return CombatMotionSample {
            beat: CombatBeat::Impact,
            pet_offset: Vec2::new(47.0 - progress * 3.0, 0.0),
            enemy_offset: Vec2::new(shake * (1.0 - progress * 0.35), 1.0),
            pet_scale: Vec2::new(1.08, 0.94),
            enemy_scale: Vec2::new(1.15, 0.82),
            slash_opacity: (1.0 - progress * 0.45).clamp(0.45, 1.0),
            impact_flash_opacity: (1.0 - progress * 0.16).clamp(0.84, 1.0),
            afterimage_opacity: 0.30 * (1.0 - progress),
            ..Default::default()
        };
    }

    if (0.70..0.90).contains(&phase) {
        let progress = normalized(phase, 0.70, 0.90);
        let eased = smoothstep(progress);
        return CombatMotionSample {
            beat: CombatBeat::Recovery,
            pet_offset: Vec2::new(44.0 * (1.0 - eased), 0.0),
            pet_scale: Vec2::new(1.0 - 0.04 * (1.0 - eased), 1.0 + 0.05 * (1.0 - eased)),
            afterimage_opacity: 0.18 * (1.0 - progress),
            ..Default::default()
        };
    }

    let idle = match frame % 8 {
        2 | 3 => -1.5,
        6 | 7 => 1.0,
        _ => 0.0,
    };
    CombatMotionSample {
        pet_offset: Vec2::new(0.0, idle),
        enemy_offset: Vec2::new(0.0, -idle * 0.35),
        pet_scale: Vec2::new(1.0 - idle.abs() * 0.006, 1.0 + idle.abs() * 0.008),
        enemy_scale: Vec2::new(1.0 + idle.abs() * 0.008, 1.0 - idle.abs() * 0.006),
        ..Default::default()
    }
}

fn normalized(value: f64, start: f64, end: f64) -> f32 {
    ((value - start) / (end - start)).clamp(0.0, 1.0) as f32
}

fn smoothstep(value: f32) -> f32 {
    value * value * (3.0 - 2.0 * value)
}
