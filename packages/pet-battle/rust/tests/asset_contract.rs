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
fn rainbow_uses_small_two_dimensional_jewel_spots_instead_of_bands() {
    const WIDTH: u32 = 100;
    const HEIGHT: u32 = 100;
    let base = rainbow_mottle_color(50, 100, WIDTH, HEIGHT);
    let spotted = (0..HEIGHT)
        .flat_map(|y| (0..WIDTH).map(move |x| rainbow_mottle_color(x, y, WIDTH, HEIGHT)))
        .filter(|&color| color != base)
        .count();
    let one_column: std::collections::BTreeSet<_> = (0..HEIGHT)
        .map(|y| rainbow_mottle_color(50, y, WIDTH, HEIGHT))
        .collect();

    assert!((1_000..=2_200).contains(&spotted));
    assert!(one_column.len() >= 3);
}
