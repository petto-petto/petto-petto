use std::path::Path;

use image::{RgbaImage, imageops};

use crate::EnemyColorStage;

const COLORS: [EnemyColorStage; 7] = [
    EnemyColorStage::Red,
    EnemyColorStage::Orange,
    EnemyColorStage::Yellow,
    EnemyColorStage::Green,
    EnemyColorStage::Blue,
    EnemyColorStage::Purple,
    EnemyColorStage::Rainbow,
];

const FACES: [&str; 3] = ["steady", "worried", "exhausted"];

#[derive(Clone, Copy)]
struct RainbowPatch {
    center: (i32, i32),
    radius: (i32, i32),
    color: (u8, u8, u8),
}

#[must_use]
pub fn colorize_enemy_image(
    source: &RgbaImage,
    stage: EnemyColorStage,
    preserve_outline: bool,
) -> RgbaImage {
    let mut image = source.clone();
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        if pixel[3] <= 8 {
            continue;
        }
        let red = f32::from(pixel[0]);
        let green = f32::from(pixel[1]);
        let blue = f32::from(pixel[2]);
        let cyan_eye = green > red + 42.0 && blue > red + 42.0;
        let dark_outline = red < 65.0 && green < 60.0 && blue < 100.0;
        if cyan_eye || (preserve_outline && dark_outline) {
            continue;
        }
        let lightness = red.max(green).max(blue) / 255.0;
        let (target_red, target_green, target_blue) =
            stage_color(stage, x, y, source.width(), source.height());
        // All variants retain the same source shadows and highlight contrast.
        let strength = (0.28 + lightness * 0.68).min(0.92);
        pixel[0] = (f32::from(target_red) * strength).min(255.0) as u8;
        pixel[1] = (f32::from(target_green) * strength).min(255.0) as u8;
        pixel[2] = (f32::from(target_blue) * strength).min(255.0) as u8;
    }
    image
}

fn stage_color(stage: EnemyColorStage, x: u32, y: u32, width: u32, height: u32) -> (u8, u8, u8) {
    match stage {
        EnemyColorStage::Red => (176, 65, 75),
        EnemyColorStage::Orange => (184, 105, 61),
        EnemyColorStage::Yellow => (181, 154, 72),
        EnemyColorStage::Green => (86, 143, 93),
        EnemyColorStage::Blue => (73, 105, 151),
        EnemyColorStage::Purple => (103, 75, 145),
        EnemyColorStage::Rainbow => rainbow_mottle_color(x, y, width, height),
    }
}

#[must_use]
pub fn rainbow_mottle_color(x: u32, y: u32, width: u32, height: u32) -> (u8, u8, u8) {
    // Approved reference palette (2026-09-29). Preserve its hue and lightness;
    // saturation alone is reduced below, separately from the shared shading.
    const PINK: (u8, u8, u8) = (243, 191, 203);
    const LEMON: (u8, u8, u8) = (244, 246, 163);
    const MINT: (u8, u8, u8) = (178, 223, 167);
    const AQUA: (u8, u8, u8) = (210, 238, 236);
    const LILAC: (u8, u8, u8) = (234, 170, 241);
    const PATCHES: [RainbowPatch; 14] = [
        RainbowPatch {
            center: (10, 22),
            radius: (6, 5),
            color: PINK,
        },
        RainbowPatch {
            center: (27, 12),
            radius: (6, 6),
            color: LEMON,
        },
        RainbowPatch {
            center: (47, 21),
            radius: (5, 6),
            color: LEMON,
        },
        RainbowPatch {
            center: (68, 12),
            radius: (6, 5),
            color: MINT,
        },
        RainbowPatch {
            center: (86, 24),
            radius: (5, 7),
            color: AQUA,
        },
        RainbowPatch {
            center: (78, 42),
            radius: (5, 5),
            color: AQUA,
        },
        RainbowPatch {
            center: (91, 57),
            radius: (6, 5),
            color: LILAC,
        },
        RainbowPatch {
            center: (80, 77),
            radius: (6, 6),
            color: PINK,
        },
        RainbowPatch {
            center: (60, 87),
            radius: (5, 6),
            color: LEMON,
        },
        RainbowPatch {
            center: (44, 70),
            radius: (6, 5),
            color: MINT,
        },
        RainbowPatch {
            center: (24, 86),
            radius: (5, 7),
            color: AQUA,
        },
        RainbowPatch {
            center: (10, 65),
            radius: (6, 5),
            color: AQUA,
        },
        RainbowPatch {
            center: (30, 49),
            radius: (5, 5),
            color: LILAC,
        },
        RainbowPatch {
            center: (54, 48),
            radius: (6, 5),
            color: PINK,
        },
    ];

    let normalized_x = x.saturating_mul(100) / width.saturating_sub(1).max(1);
    let normalized_y = y.saturating_mul(100) / height.saturating_sub(1).max(1);
    let normalized_x = normalized_x as i32;
    let normalized_y = normalized_y as i32;

    let reference = PATCHES
        .iter()
        .enumerate()
        .min_by_key(|(index, spot)| {
            let (center_x, center_y) = spot.center;
            let (radius_x, radius_y) = spot.radius;
            let delta_x = normalized_x - center_x;
            let delta_y = normalized_y - center_y;
            let distance = delta_x * delta_x * 100 / (radius_x * radius_x)
                + delta_y * delta_y * 100 / (radius_y * radius_y);
            let jagged_edge =
                (normalized_x * 17 + normalized_y * 23 + *index as i32 * 29).rem_euclid(19) - 9;
            distance - jagged_edge
        })
        .map_or(PINK, |(_, patch)| patch.color);
    soften_reference_saturation(reference)
}

fn soften_reference_saturation((r, g, b): (u8, u8, u8)) -> (u8, u8, u8) {
    // Interpolate 10% toward HSL's mid-gray (max + min) / 2. This keeps hue
    // and lightness, unlike substituting a darker RGB palette. Round once.
    let midpoint_twice = u16::from(r.max(g).max(b)) + u16::from(r.min(g).min(b));
    let channel = |value| ((18 * u16::from(value) + midpoint_twice + 10) / 20) as u8;
    (channel(r), channel(g), channel(b))
}

pub fn generate_enemy_asset_set(source_root: &Path, output_root: &Path) -> Result<(), String> {
    let version_output = output_root.join("v2");
    std::fs::create_dir_all(&version_output).map_err(|error| {
        format!(
            "failed to create enemy asset directory {}: {error}",
            version_output.display()
        )
    })?;

    for face in FACES {
        let suffix = if face == "steady" {
            String::new()
        } else {
            format!("-{face}")
        };
        let source_path = source_root.join(format!("shadow-slime-idle-v2{suffix}.png"));
        let source = decode_trimmed(&source_path, 32)?;
        for color in COLORS {
            let output = version_output.join(format!("{}-{face}.png", color_slug(color)));
            colorize_enemy_image(&source, color, true)
                .save(&output)
                .map_err(|error| format!("failed to save {}: {error}", output.display()))?;
        }
    }
    Ok(())
}

fn decode_trimmed(path: &Path, max_height: u32) -> Result<RgbaImage, String> {
    let source = image::open(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?
        .to_rgba8();
    let trimmed = trim_transparent(source);
    if trimmed.height() <= max_height {
        return Ok(trimmed);
    }
    let width = trimmed.width().saturating_mul(max_height) / trimmed.height().max(1);
    Ok(imageops::resize(
        &trimmed,
        width.max(1),
        max_height,
        imageops::FilterType::Nearest,
    ))
}

fn trim_transparent(image: RgbaImage) -> RgbaImage {
    let mut min_x = image.width();
    let mut min_y = image.height();
    let mut max_x = 0;
    let mut max_y = 0;
    let mut found = false;
    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel[3] > 8 {
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if !found {
        return image;
    }
    imageops::crop_imm(
        &image,
        min_x,
        min_y,
        max_x.saturating_sub(min_x) + 1,
        max_y.saturating_sub(min_y) + 1,
    )
    .to_image()
}

const fn color_slug(color: EnemyColorStage) -> &'static str {
    match color {
        EnemyColorStage::Red => "red",
        EnemyColorStage::Orange => "orange",
        EnemyColorStage::Yellow => "yellow",
        EnemyColorStage::Green => "green",
        EnemyColorStage::Blue => "blue",
        EnemyColorStage::Purple => "purple",
        EnemyColorStage::Rainbow => "rainbow",
    }
}
