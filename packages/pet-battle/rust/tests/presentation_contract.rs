use pet_battle::{
    AssetVersion, CombatBeat, EnemyColorStage, EnemyPreviewAction, EnemyPreviewPhase,
    EnemyPreviewSize, MotionPreview, OverlayClick, OverlayFlow, OverlayPhase, PetPreviewAction,
    PetRarity, PreviewMenu, sample_combat_motion,
};

#[test]
fn conquest_waits_for_two_step_overlay_click_flow() {
    let mut flow = OverlayFlow::default();
    flow.begin_conquest(5.0, 3, 4);
    assert_eq!(flow.click(5.2), OverlayClick::DefeatMotionSkipped);
    assert_eq!(flow.phase(), OverlayPhase::AwaitingAdvance);
    assert_eq!(flow.click(5.3), OverlayClick::NextStageStarted);
    assert_eq!(flow.phase(), OverlayPhase::Spawning);
}

#[test]
fn preview_controls_are_independent_and_resettable() {
    let mut preview = MotionPreview::default();
    preview.toggle_menu(PreviewMenu::Enemy);
    preview.select_asset_version(AssetVersion::V2);
    assert_eq!(preview.cycle_enemy_size(), EnemyPreviewSize::Small);
    assert_eq!(preview.cycle_enemy_color(EnemyColorStage::Red), EnemyColorStage::Orange);
    assert!((preview.cycle_enemy_hp(1.0) - 0.60).abs() < f32::EPSILON);
    assert!((preview.set_display_opacity(0.42).alpha() - 0.42).abs() < f32::EPSILON);

    preview.trigger_enemy(EnemyPreviewAction::Reset, 1.0);
    let visual = preview.visual(1.0);
    assert_eq!(visual.enemy_size, None);
    assert_eq!(visual.enemy_color_stage, None);
    assert_eq!(visual.enemy_hp_ratio, None);
    assert_eq!(visual.asset_version, AssetVersion::V2);
}

#[test]
fn manual_motion_and_rarity_effects_keep_their_original_beats() {
    let mut preview = MotionPreview::default();
    preview.trigger_pet(PetPreviewAction::Attack, 10.0);
    assert!(preview.visual(10.45).pet_attack_phase.is_some());
    assert_eq!(preview.cycle_attack_effect_rarity(PetRarity::Common), PetRarity::Common);
    assert_eq!(preview.cycle_attack_effect_rarity(PetRarity::Common), PetRarity::Rare);
    assert_eq!(preview.cycle_attack_effect_rarity(PetRarity::Common), PetRarity::Epic);

    let anticipation = sample_combat_motion(0.48, 12, false);
    let dash = sample_combat_motion(0.58, 13, false);
    let impact = sample_combat_motion(0.655, 14, false);
    assert_eq!(anticipation.beat, CombatBeat::Anticipation);
    assert_eq!(dash.beat, CombatBeat::Dash);
    assert_eq!(impact.beat, CombatBeat::Impact);
    assert!(impact.impact_flash_opacity >= 0.8);
}

#[test]
fn defeat_preview_stays_hidden_until_spawn() {
    let mut preview = MotionPreview::default();
    preview.trigger_enemy(EnemyPreviewAction::Defeat, 2.0);
    preview.tick(3.5);
    assert_eq!(preview.visual(3.5).enemy_phase, EnemyPreviewPhase::Hidden);
    preview.trigger_enemy(EnemyPreviewAction::Spawn, 4.0);
    assert_eq!(preview.visual(4.2).enemy_phase, EnemyPreviewPhase::Spawning);
}
