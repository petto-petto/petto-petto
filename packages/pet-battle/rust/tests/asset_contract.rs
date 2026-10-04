use image::{Rgba, RgbaImage};
use pet_battle::{EnemyColorStage, colorize_enemy_image, rainbow_mottle_color};

#[test]
fn enemy_palette_changes_body_color_but_preserves_cyan_eyes() {
    let mut source = RgbaImage::from_pixel(8, 8, Rgba([130, 90, 160, 255]));
    source.put_pixel(3, 4, Rgba([30, 220, 225, 255]));

    let red = colorize_enemy_image(&source, EnemyColorStage::Red, false);
    let green = colorize_enemy_image(&source, EnemyColorStage::Green, false);

    assert_ne!(red.get_pixel(1, 1), green.get_pixel(1, 1));
    assert_eq!(red.get_pixel(3, 4), source.get_pixel(3, 4));
    assert_eq!(green.get_pixel(3, 4), source.get_pixel(3, 4));
}

#[test]
fn rainbow_keeps_reference_colors_as_broad_two_dimensional_patches() {
    const WIDTH: u32 = 100;
    const HEIGHT: u32 = 100;
    let palette = [
        (240, 194, 204), // reference pink, saturation only -10%
        (240, 242, 167), // reference lemon
        (180, 220, 170), // reference mint
        (211, 237, 235), // reference aqua
        (231, 174, 237), // reference lilac
    ];
    let mut counts = std::collections::BTreeMap::new();
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let color = rainbow_mottle_color(x, y, WIDTH, HEIGHT);
            assert!(
                palette.contains(&color),
                "reference palette only: {color:?}"
            );
            *counts.entry(color).or_insert(0_u32) += 1;
        }
    }
    assert_eq!(counts.len(), 5, "all five reference colors must be visible");
    for count in counts.values() {
        assert!(
            (800..=4000).contains(count),
            "no dominant gray base or tiny confetti: {counts:?}"
        );
    }
    let one_column: std::collections::BTreeSet<_> = (0..HEIGHT)
        .map(|y| rainbow_mottle_color(50, y, WIDTH, HEIGHT))
        .collect();

    assert!(one_column.len() >= 3);
    let one_row: std::collections::BTreeSet<_> = (0..WIDTH)
        .map(|x| rainbow_mottle_color(x, 50, WIDTH, HEIGHT))
        .collect();
    assert!(
        one_row.len() >= 3,
        "patches, not horizontal rainbow stripes"
    );
}

#[test]
fn rainbow_preserves_reference_hue_and_lightness_reducing_only_saturation() {
    // Approved 2026-09-29 palette: do not substitute brown/sage/blue for lemon/mint/aqua.
    let references = [
        ((10, 22), (243, 191, 203)),
        ((27, 12), (244, 246, 163)),
        ((68, 12), (178, 223, 167)),
        ((86, 24), (210, 238, 236)),
        ((91, 57), (234, 170, 241)),
    ];
    for ((x, y), reference) in references {
        let actual = rainbow_mottle_color(x, y, 101, 101);
        let (hue, saturation, lightness) = hsl(actual);
        let (ref_hue, ref_saturation, ref_lightness) = hsl(reference);
        let hue_delta = (hue - ref_hue).abs();
        assert!(
            hue_delta.min(360.0 - hue_delta) < 1.0,
            "hue changed: {reference:?} -> {actual:?}"
        );
        assert!(
            (lightness - ref_lightness).abs() <= 1.0 / 255.0,
            "do not replace the palette with dark colors"
        );
        assert!(
            (0.86..=0.94).contains(&(saturation / ref_saturation)),
            "only a gentle 10% saturation reduction: {actual:?}"
        );
    }
}

fn hsl((r, g, b): (u8, u8, u8)) -> (f64, f64, f64) {
    let (r, g, b) = (
        f64::from(r) / 255.0,
        f64::from(g) / 255.0,
        f64::from(b) / 255.0,
    );
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lightness = (max + min) / 2.0;
    let chroma = max - min;
    if chroma == 0.0 {
        return (0.0, 0.0, lightness);
    }
    let hue = if max == r {
        ((g - b) / chroma).rem_euclid(6.0)
    } else if max == g {
        (b - r) / chroma + 2.0
    } else {
        (r - g) / chroma + 4.0
    };
    (
        hue * 60.0,
        chroma / (1.0 - (2.0 * lightness - 1.0).abs()),
        lightness,
    )
}

#[test]
fn rainbow_uses_the_same_shadow_to_highlight_strength_as_red() {
    // Check both shadows and highlights across every patch, not just one color.
    // The red sprite is the unchanged art-direction reference.
    for lightness in [70, 100, 160, 220, 255] {
        let source = RgbaImage::from_pixel(16, 16, Rgba([lightness, 65, lightness, 255]));
        let red = colorize_enemy_image(&source, EnemyColorStage::Red, true);
        let rainbow = colorize_enemy_image(&source, EnemyColorStage::Rainbow, true);
        for (x, y, pixel) in rainbow.enumerate_pixels() {
            let reference_strength = f32::from(red.get_pixel(x, y)[0]) / 176.0;
            let (r, g, b) = rainbow_mottle_color(x, y, 16, 16);
            for (actual, base) in pixel.0[..3].iter().zip([r, g, b]) {
                let strength = f32::from(*actual) / f32::from(base);
                assert!(
                    (strength - reference_strength).abs() <= 0.011,
                    "rainbow must not lift or flatten the shadows: source={lightness}, pixel={pixel:?}"
                );
            }
        }
    }
}

#[test]
fn rainbow_recolor_preserves_alpha_outline_and_eye_pixels_for_every_face() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets/enemies/v2");
    for (face, width) in [("steady", 49), ("worried", 49), ("exhausted", 51)] {
        let source = image::open(root.join(format!("rainbow-{face}.png")))
            .expect("face asset")
            .to_rgba8();
        assert_eq!(source.dimensions(), (width, 32));
        let output = colorize_enemy_image(&source, EnemyColorStage::Rainbow, true);
        assert_eq!(output.dimensions(), source.dimensions());
        for (before, after) in source.pixels().zip(output.pixels()) {
            assert_eq!(before[3], after[3], "{face}: alpha/shape must not change");
            let [r, g, b, a] = before.0;
            let eye = u16::from(g) > u16::from(r) + 42 && u16::from(b) > u16::from(r) + 42;
            let outline = r < 65 && g < 60 && b < 100;
            if a <= 8 || eye || outline {
                assert_eq!(
                    before, after,
                    "{face}: eye, outline and transparent pixels are locked"
                );
            }
        }
    }
}

#[test]
fn generated_rainbow_preserves_geometry_eyes_and_reference_palette_shading() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets/enemies/v2");
    for face in ["steady", "worried", "exhausted"] {
        let read = |color| {
            image::open(root.join(format!("{color}-{face}.png")))
                .expect("generated face asset")
                .to_rgba8()
        };
        let red = read("red");
        let rainbow = read("rainbow");
        assert_eq!(rainbow.dimensions(), red.dimensions());
        for (x, y, actual) in rainbow.enumerate_pixels() {
            let reference = red.get_pixel(x, y);
            assert_eq!(
                actual[3], reference[3],
                "{face}: silhouette stays unchanged"
            );
            let [r, g, b, a] = reference.0;
            let eye = u16::from(g) > u16::from(r) + 42 && u16::from(b) > u16::from(r) + 42;
            let outline = r < 65 && g < 60 && b < 100;
            if a <= 8 || eye || outline {
                assert_eq!(actual, reference, "{face}: eyes and outline stay unchanged");
            } else {
                let strength = f64::from(reference[0]) / 176.0;
                let (r, g, b) = rainbow_mottle_color(x, y, rainbow.width(), rainbow.height());
                for (channel, base) in actual.0[..3].iter().zip([r, g, b]) {
                    assert!(
                        (f64::from(*channel) - f64::from(base) * strength).abs() <= 2.0,
                        "{face}: shared source shading, not a different hue/darker palette: {actual:?}"
                    );
                }
            }
        }
    }
}
