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
struct RainbowSpot {
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
        let strength = match stage {
            EnemyColorStage::Rainbow => (0.76 + lightness * 0.22).min(0.96),
            _ => (0.28 + lightness * 0.68).min(0.92),
        };
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
    const BASE: (u8, u8, u8) = (184, 173, 211);
    const SPOTS: [RainbowSpot; 14] = [
        RainbowSpot {
            center: (10, 22),
            radius: (6, 5),
            color: (232, 174, 193),
        },
        RainbowSpot {
            center: (27, 12),
            radius: (6, 6),
            color: (235, 195, 164),
        },
        RainbowSpot {
            center: (47, 21),
            radius: (5, 6),
            color: (232, 216, 166),
        },
        RainbowSpot {
            center: (68, 12),
            radius: (6, 5),
            color: (169, 214, 188),
        },
        RainbowSpot {
            center: (86, 24),
            radius: (5, 7),
            color: (162, 207, 213),
        },
        RainbowSpot {
            center: (78, 42),
            radius: (5, 5),
            color: (165, 186, 222),
        },
        RainbowSpot {
            center: (91, 57),
            radius: (6, 5),
            color: (204, 174, 224),
        },
        RainbowSpot {
            center: (80, 77),
            radius: (6, 6),
            color: (228, 172, 207),
        },
        RainbowSpot {
            center: (60, 87),
            radius: (5, 6),
            color: (235, 195, 164),
        },
        RainbowSpot {
            center: (44, 70),
            radius: (6, 5),
            color: (169, 214, 188),
        },
        RainbowSpot {
            center: (24, 86),
            radius: (5, 7),
            color: (162, 207, 213),
        },
        RainbowSpot {
            center: (10, 65),
            radius: (6, 5),
            color: (165, 186, 222),
        },
        RainbowSpot {
            center: (30, 49),
            radius: (5, 5),
            color: (204, 174, 224),
        },
        RainbowSpot {
            center: (54, 48),
            radius: (6, 5),
            color: (232, 174, 193),
        },
    ];

    let normalized_x = x.saturating_mul(100) / width.saturating_sub(1).max(1);
    let normalized_y = y.saturating_mul(100) / height.saturating_sub(1).max(1);
    let normalized_x = normalized_x as i32;
    let normalized_y = normalized_y as i32;

    SPOTS
        .iter()
        .enumerate()
        .find_map(|(index, spot)| {
            let (center_x, center_y) = spot.center;
            let (radius_x, radius_y) = spot.radius;
            let delta_x = normalized_x - center_x;
            let delta_y = normalized_y - center_y;
            let distance = delta_x * delta_x * 100 / (radius_x * radius_x)
                + delta_y * delta_y * 100 / (radius_y * radius_y);
            let jagged_edge =
                (normalized_x * 17 + normalized_y * 23 + index as i32 * 29).rem_euclid(19) - 9;
            (distance <= 100 + jagged_edge).then_some(spot.color)
        })
        .unwrap_or(BASE)
}

pub fn generate_enemy_asset_set(source_root: &Path, output_root: &Path) -> Result<(), String> {
    for (version, preserve_outline, max_height) in [("v1", false, 256), ("v2", true, 32)] {
        let version_output = output_root.join(version);
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
            let source_path = source_root.join(format!("shadow-slime-idle-{version}{suffix}.png"));
            let source = decode_trimmed(&source_path, max_height)?;
            for color in COLORS {
                let output = version_output.join(format!("{}-{face}.png", color_slug(color)));
                colorize_enemy_image(&source, color, preserve_outline)
                    .save(&output)
                    .map_err(|error| format!("failed to save {}: {error}", output.display()))?;
            }
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
