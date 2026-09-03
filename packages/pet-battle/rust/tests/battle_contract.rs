use pet_battle::{
    BattleConfig, BattleController, BattleEvent, BattleInput, BattleMode, EnemyColorStage,
    PetRarity, generate_background_asset_set,
};
use std::path::PathBuf;

const CONFIG: BattleConfig = BattleConfig {
    common_interval_xp: 120,
    rare_interval_xp: 100,
    epic_interval_xp: 80,
    attack_cycle_ms: 2_400,
    animation_fps: 10,
};

#[test]
fn external_growth_updates_only_its_target_pet_and_keeps_overflow() {
    let mut controller = BattleController::demo(CONFIG);

    let event = controller
        .handle_input(BattleInput::GrowthXpAdded {
            pet_id: "lumi".to_owned(),
            amount: 115,
        })
        .expect("known pet should produce an event");

    assert_eq!(event.pet_id, "lumi");
    assert_eq!(
        event.event,
        BattleEvent::EnemyDefeated {
            defeated_stage: 1,
            next_stage: 2,
            skipped_stages: 0,
        }
    );
    let lumi = controller.pet("lumi").expect("lumi remains available");
    assert_eq!(lumi.interval_xp, 15);
    assert_eq!(controller.pet("mio").map(|pet| pet.interval_xp), Some(0));
}

#[test]
fn pet_sync_changes_identity_without_resetting_battle_progress() {
    let mut controller = BattleController::demo(CONFIG);
    controller.handle_input(BattleInput::GrowthXpAdded {
        pet_id: "mio".to_owned(),
        amount: 720,
    });

    controller.handle_input(BattleInput::UpsertPet {
        pet_id: "mio".to_owned(),
        display_name: "미오 2세".to_owned(),
        rarity: PetRarity::Rare,
    });

    let pet = controller.pet("mio").expect("pet remains available");
    assert_eq!(pet.display_name, "미오 2세");
    assert_eq!(pet.rarity, PetRarity::Rare);
    assert_eq!(pet.stage, 7);
}

#[test]
fn stage_color_and_background_cycle_together() {
    assert_eq!(EnemyColorStage::for_stage(1), EnemyColorStage::Red);
    assert_eq!(EnemyColorStage::for_stage(4), EnemyColorStage::Green);
    assert_eq!(EnemyColorStage::for_stage(7), EnemyColorStage::Rainbow);
    assert_eq!(EnemyColorStage::for_stage(8), EnemyColorStage::Red);
    assert_ne!(
        EnemyColorStage::Red.background(),
        EnemyColorStage::Green.background()
    );
}

#[test]
fn battle_can_pause_without_changing_progress() {
    let mut controller = BattleController::demo(CONFIG);
    let before = controller.active_pet().expect("active pet").clone();

    assert_eq!(
        controller.toggle_battle(),
        Some(BattleEvent::ModeChanged(BattleMode::Paused))
    );
    let after = controller.active_pet().expect("active pet");
    assert_eq!(after.stage, before.stage);
    assert_eq!(after.interval_xp, before.interval_xp);
}

#[test]
fn background_assets_are_generated_by_battle_graphic_pipeline() {
    let output = unique_test_dir("battle-background-assets");
    generate_background_asset_set(&output).expect("background assets are generated");

    for slug in ["mushroom-forest", "crystal-ruins", "starlight-shrine"] {
        let path = output.join("v2").join(format!("{slug}.png"));
        let image = image::open(&path)
            .unwrap_or_else(|error| panic!("{} should be readable: {error}", path.display()))
            .to_rgba8();

        assert_eq!(image.width(), 360);
        assert_eq!(image.height(), 180);
        assert!(image.pixels().any(|pixel| pixel[3] == 255));
    }
}

fn unique_test_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).expect("test output directory should be created");
    path
}
