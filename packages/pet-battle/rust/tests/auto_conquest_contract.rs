use pet_battle::{BattleEngine, OverlayClick, OverlayFlow, OverlayPhase, handle_json_line};
use serde_json::{Value, json};

fn command(engine: &mut BattleEngine, command: Value) -> Value {
    let response: Value = serde_json::from_str(&handle_json_line(
        engine,
        &json!({"requestId":"auto-conquest", "command":command}).to_string(),
    ))
    .expect("JSON response");
    assert_eq!(response["ok"], true, "{response}");
    response
}

fn sync(engine: &mut BattleEngine, xp: u64, now_ms: u64) -> Value {
    let costs: Vec<u64> = (1..=50).map(|level| 10 + level / 2).collect();
    command(
        engine,
        json!({
            "type":"SYNC_OWNED_PETS", "nowMs":now_ms,
            "activePetId":"owned-1", "spectatorPetIds":[],
            "levelXpCosts":costs, "intervalLevels":{"COMMON":12,"RARE":10,"EPIC":8},
            "pets":[{"petId":"owned-1", "displayName":"토리", "rarity":"COMMON",
                "level":50, "sprite":"acorn_squirrel", "evolutionStage":2, "totalXp":xp}]
        }),
    )
}

#[test]
fn conquest_automatically_spawns_then_finishes_at_exact_boundaries() {
    let mut flow = OverlayFlow::default();
    flow.begin_conquest(5.0, 3, 4);
    flow.tick(6.479);
    assert_eq!(flow.phase(), OverlayPhase::DefeatMotion);
    flow.tick(6.480);
    assert_eq!(flow.phase(), OverlayPhase::Spawning);
    let spawning = flow.visual(6.480).expect("spawn visual");
    assert!(spawning.elapsed.abs() < 0.000_001);
    assert_eq!(spawning.defeated_stage, 3);
    assert_eq!(spawning.next_stage, 4);
    flow.tick(7.199);
    assert_eq!(flow.phase(), OverlayPhase::Spawning);
    flow.tick(7.200);
    assert_eq!(flow.phase(), OverlayPhase::Fighting);
    assert!(flow.visual(7.200).is_none());
}

#[test]
fn a_single_late_tick_finishes_without_replaying_death_or_spawn() {
    let mut flow = OverlayFlow::default();
    flow.begin_conquest(1.0, 1, 10);
    flow.tick(60.0);
    assert_eq!(flow.phase(), OverlayPhase::Fighting);
    assert!(flow.visual(60.0).is_none());
}

#[test]
fn optional_click_skips_directly_to_spawn_without_a_second_click() {
    let mut flow = OverlayFlow::default();
    flow.begin_conquest(5.0, 3, 4);
    assert_eq!(flow.click(5.2), OverlayClick::DefeatMotionSkipped);
    assert_eq!(flow.phase(), OverlayPhase::Spawning);
    assert_eq!(flow.click(5.3), OverlayClick::NoTransition);
    flow.tick(5.921);
    assert_eq!(flow.phase(), OverlayPhase::Fighting);
}

#[test]
fn newer_conquests_update_destination_without_restarting_transition_clock() {
    let mut flow = OverlayFlow::default();
    flow.begin_conquest(1.0, 1, 2);
    flow.begin_conquest(1.4, 2, 4);
    let defeating = flow.visual(1.4).expect("death visual");
    assert_eq!(defeating.defeated_stage, 1);
    assert_eq!(defeating.next_stage, 4);
    assert!((defeating.elapsed - 0.4).abs() < 0.000_001);
    flow.tick(2.48);
    assert_eq!(flow.phase(), OverlayPhase::Spawning);
    flow.begin_conquest(2.6, 4, 7);
    let spawning = flow.visual(2.6).expect("spawn visual");
    assert_eq!(spawning.phase, OverlayPhase::Spawning);
    assert_eq!(spawning.next_stage, 7);
    assert!((spawning.elapsed - 0.12).abs() < 0.000_001);
    flow.tick(3.2);
    assert_eq!(flow.phase(), OverlayPhase::Fighting);
}

#[test]
fn live_xp_automatically_changes_enemy_without_resetting_xp_opacity_or_pause() {
    for paused in [false, true] {
        let mut engine = BattleEngine::demo();
        sync(&mut engine, 81, 0);
        command(
            &mut engine,
            json!({"type":"SET_DISPLAY_OPACITY","percent":35}),
        );
        command(
            &mut engine,
            json!({"type":"SET_BATTLE_RUNNING","running":!paused}),
        );
        let defeat = sync(&mut engine, 82, 1000);
        assert_eq!(defeat["state"]["enemyColor"], "RED");
        assert_eq!(defeat["state"]["overlay"]["phase"], "DEFEAT_MOTION");
        assert_eq!(defeat["state"]["enemyHpRatio"], 0.0);
        let spawning = command(&mut engine, json!({"type":"GET_STATE","nowMs":2480}));
        assert_eq!(spawning["state"]["overlay"]["phase"], "SPAWNING");
        assert_eq!(spawning["state"]["enemyColor"], "ORANGE");
        assert_eq!(spawning["state"]["enemyHpRatio"], 1.0);
        let finished = command(&mut engine, json!({"type":"GET_STATE","nowMs":3200}));
        assert_eq!(finished["state"]["overlay"], Value::Null);
        assert_eq!(finished["state"]["activePet"]["stage"], 4);
        assert_eq!(finished["state"]["activePet"]["syncedTotalXp"], 82);
        assert_eq!(
            finished["state"]["activePet"]["battleMode"],
            if paused { "PAUSED" } else { "FIGHTING" }
        );
        let opacity = finished["state"]["preview"]["displayOpacity"]
            .as_f64()
            .expect("opacity");
        assert!((opacity - 0.35).abs() < 0.000_001);
        if paused {
            assert_eq!(finished["state"]["motion"]["beat"], "IDLE");
        }
        let repeated = sync(&mut engine, 82, 3500);
        assert_eq!(repeated["events"], json!([]));
        assert_eq!(repeated["state"]["overlay"], Value::Null);
    }
}

#[test]
fn live_xp_during_death_and_spawn_finishes_once_at_latest_stage() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, 20, 0);
    sync(&mut engine, 21, 1000);
    let later = sync(&mut engine, 82, 1400);
    assert_eq!(later["state"]["overlay"]["defeatedStage"], 1);
    assert_eq!(later["state"]["overlay"]["nextStage"], 4);
    let spawning = command(&mut engine, json!({"type":"GET_STATE","nowMs":2480}));
    assert_eq!(spawning["state"]["overlay"]["phase"], "SPAWNING");
    let latest = sync(&mut engine, 189, 2600);
    assert_eq!(latest["state"]["overlay"]["phase"], "SPAWNING");
    assert_eq!(latest["state"]["overlay"]["nextStage"], 7);
    assert_eq!(latest["state"]["enemyColor"], "YELLOW");
    let finished = command(&mut engine, json!({"type":"GET_STATE","nowMs":3200}));
    assert_eq!(finished["state"]["overlay"], Value::Null);
    assert_eq!(finished["state"]["activePet"]["stage"], 7);
    let repeated = sync(&mut engine, 189, 3300);
    assert_eq!(repeated["events"], json!([]));
    assert_eq!(repeated["state"]["overlay"], Value::Null);
}

#[test]
fn manual_defeat_preview_is_not_a_real_conquest() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, 81, 0);
    command(
        &mut engine,
        json!({"type":"PREVIEW_ENEMY","action":"DEFEAT","nowMs":1000}),
    );
    let later = command(&mut engine, json!({"type":"GET_STATE","nowMs":6000}));
    assert_eq!(later["state"]["overlay"], Value::Null);
    assert_eq!(later["state"]["preview"]["enemyPhase"], "HIDDEN");
    assert_eq!(later["state"]["activePet"]["stage"], 3);
    assert_eq!(later["state"]["activePet"]["syncedTotalXp"], 81);
}
