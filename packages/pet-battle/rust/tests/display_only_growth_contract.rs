use pet_battle::{BattleEngine, BattleRequest, handle_json_line};
use serde_json::{Value, json};

fn pet(id: &str, total_xp: Value) -> Value {
    json!({
        "petId": id, "displayName": "별빛마법사", "rarity": "EPIC",
        "level": 35, "sprite": "star_wizard", "evolutionStage": 2,
        "totalXp": total_xp,
    })
}

fn sync_command(pets: Vec<Value>, active: Option<&str>, now_ms: u64) -> Value {
    json!({
        "type": "SYNC_OWNED_PETS", "nowMs": now_ms,
        "activePetId": active, "spectatorPetIds": ["other", "missing", "selected"],
        "levelXpCosts": vec![10; 50],
        "intervalLevels": {"COMMON": 12, "RARE": 10, "EPIC": 8},
        "pets": pets,
    })
}

fn send(engine: &mut BattleEngine, command: Value) -> Value {
    serde_json::from_str(&handle_json_line(
        engine,
        &json!({"requestId": "display-only", "command": command}).to_string(),
    ))
    .expect("JSON response")
}

fn command(engine: &mut BattleEngine, input: Value) -> Value {
    let response = send(engine, input);
    assert_eq!(response["ok"], true, "{response}");
    response
}

fn sync(engine: &mut BattleEngine, total_xp: Value, now_ms: u64) -> Value {
    command(
        engine,
        sync_command(vec![pet("selected", total_xp)], Some("selected"), now_ms),
    )
}

fn assert_display_only(response: &Value) {
    let active = &response["state"]["activePet"];
    assert_eq!(active["petId"], "selected");
    assert_eq!(active["stage"], 1);
    assert_eq!(active["intervalXp"], 0);
    assert_eq!(active["syncedTotalXp"], Value::Null);
    assert_eq!(active["growthTargetXp"], Value::Null);
    assert_eq!(response["state"]["enemyHpRatio"], 1.0);
    assert_eq!(response["state"]["overlay"], Value::Null);
    assert_eq!(response["events"], json!([]));
}

fn assert_opacity(response: &Value, expected: f64) {
    let actual = response["state"]["preview"]["displayOpacity"]
        .as_f64()
        .expect("opacity");
    assert!((actual - expected).abs() < 0.000_001, "{response}");
}

#[test]
fn json_sync_round_trips_missing_growth_as_null_without_inventing_zero_xp() {
    for total_xp in [Value::Null, json!(0), json!(55)] {
        let input = json!({
            "requestId": "nullable-growth",
            "command": sync_command(vec![pet("selected", total_xp.clone())], Some("selected"), 1000),
        });
        let request: BattleRequest = serde_json::from_value(input).expect("nullable XP input");
        let round_trip = serde_json::to_value(request).expect("serialized request");
        assert_eq!(round_trip["command"]["pets"][0]["totalXp"], total_xp);
    }
}

#[test]
fn null_growth_keeps_selected_identity_and_motion_without_hp_progression() {
    let mut engine = BattleEngine::demo();
    let initial = sync(&mut engine, Value::Null, 1000);
    assert_display_only(&initial);
    let active = &initial["state"]["activePet"];
    assert_eq!(active["displayName"], "별빛마법사");
    assert_eq!(active["sprite"], "star_wizard");
    assert_eq!(active["level"], 35);
    assert_eq!(active["evolutionStage"], 2);
    assert_eq!(active["battleMode"], "FIGHTING");
    assert_eq!(initial["state"]["motion"]["beat"], "ANTICIPATION");

    let moving = command(&mut engine, json!({"type": "GET_STATE", "nowMs": 1300}));
    assert_display_only(&moving);
    assert_eq!(moving["state"]["motion"]["beat"], "DASH");
    assert_ne!(moving["state"]["motion"]["petOffset"]["x"], 0.0);
    for now_ms in [10_000, 1_000_000] {
        assert_display_only(&sync(&mut engine, Value::Null, now_ms));
    }
}

#[test]
fn null_growth_polling_preserves_stop_opacity_and_manual_attack_controls() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, Value::Null, 1000);
    command(
        &mut engine,
        json!({"type": "SET_BATTLE_RUNNING", "running": false}),
    );
    command(
        &mut engine,
        json!({"type": "SET_DISPLAY_OPACITY", "percent": 35}),
    );
    let paused = sync(&mut engine, Value::Null, 2000);
    assert_display_only(&paused);
    assert_eq!(paused["state"]["activePet"]["battleMode"], "PAUSED");
    assert_eq!(paused["state"]["motion"]["beat"], "IDLE");
    assert_opacity(&paused, 0.35);

    command(
        &mut engine,
        json!({"type": "PREVIEW_PET", "action": "ATTACK", "nowMs": 2100}),
    );
    let manual = sync(&mut engine, Value::Null, 2400);
    assert_display_only(&manual);
    assert_eq!(manual["state"]["preview"]["petAction"], "ATTACK");
    assert_eq!(manual["state"]["motion"]["beat"], "DASH");
    assert_opacity(&manual, 0.35);

    let started = command(
        &mut engine,
        json!({"type": "SET_BATTLE_RUNNING", "running": true}),
    );
    assert_eq!(started["state"]["activePet"]["battleMode"], "FIGHTING");
    let resumed = sync(&mut engine, Value::Null, 4000);
    assert_display_only(&resumed);
    assert_opacity(&resumed, 0.35);
}

#[test]
fn losing_growth_for_the_same_pet_clears_stale_conquest_but_keeps_user_settings() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, json!(19), 1000);
    let conquest = sync(&mut engine, json!(20), 1100);
    assert_eq!(conquest["state"]["overlay"]["phase"], "DEFEAT_MOTION");
    command(
        &mut engine,
        json!({"type": "SET_BATTLE_RUNNING", "running": false}),
    );
    command(
        &mut engine,
        json!({"type": "SET_DISPLAY_OPACITY", "percent": 35}),
    );
    let unlinked = sync(&mut engine, Value::Null, 1200);
    assert_display_only(&unlinked);
    assert_eq!(unlinked["state"]["activePet"]["battleMode"], "PAUSED");
    assert_opacity(&unlinked, 0.35);
    assert_display_only(&command(
        &mut engine,
        json!({"type": "GET_STATE", "nowMs": 5000}),
    ));
}

#[test]
fn restoring_growth_for_the_same_pet_does_not_replay_history_but_future_deltas_apply() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, Value::Null, 1000);
    command(
        &mut engine,
        json!({"type": "SET_BATTLE_RUNNING", "running": false}),
    );
    command(
        &mut engine,
        json!({"type": "SET_DISPLAY_OPACITY", "percent": 35}),
    );
    let restored = sync(&mut engine, json!(55), 1100);
    assert_eq!(restored["state"]["activePet"]["stage"], 3);
    assert_eq!(restored["state"]["activePet"]["intervalXp"], 15);
    assert_eq!(restored["state"]["activePet"]["growthTargetXp"], 30);
    assert_eq!(restored["state"]["activePet"]["syncedTotalXp"], 55);
    assert_eq!(restored["state"]["activePet"]["battleMode"], "PAUSED");
    assert_eq!(restored["state"]["enemyHpRatio"], 0.5);
    assert_eq!(restored["state"]["overlay"], Value::Null);
    assert_eq!(restored["events"], json!([]));
    assert_opacity(&restored, 0.35);
    let next = sync(&mut engine, json!(56), 1200);
    assert_eq!(next["events"][0]["type"], "XP_APPLIED");
    assert_eq!(next["events"][0]["amount"], 1);
    let conquered = sync(&mut engine, json!(70), 1300);
    assert_eq!(conquered["events"][0]["type"], "ENEMY_DEFEATED");
    assert_eq!(conquered["state"]["activePet"]["stage"], 4);
    assert_opacity(&conquered, 0.35);
}

#[test]
fn null_growth_roster_keeps_active_and_spectator_filtering_and_selection_reset() {
    let mut engine = BattleEngine::demo();
    let pets = vec![pet("selected", Value::Null), pet("other", Value::Null)];
    let selected = command(
        &mut engine,
        sync_command(pets.clone(), Some("selected"), 1000),
    );
    assert_eq!(
        selected["state"]["roster"]
            .as_array()
            .expect("roster")
            .len(),
        2
    );
    assert_eq!(selected["state"]["spectatorPetIds"], json!(["other"]));
    command(
        &mut engine,
        json!({"type": "SET_DISPLAY_OPACITY", "percent": 35}),
    );
    let changed = command(&mut engine, sync_command(pets.clone(), Some("other"), 1100));
    assert_eq!(changed["state"]["activePet"]["petId"], "other");
    assert_eq!(changed["state"]["spectatorPetIds"], json!(["selected"]));
    assert_opacity(&changed, 1.0);
    let absent = command(&mut engine, sync_command(pets, Some("missing"), 1200));
    assert_eq!(absent["state"]["activePet"], Value::Null);
    let empty = command(&mut engine, sync_command(vec![], None, 1300));
    assert_eq!(empty["state"]["roster"], json!([]));
    assert_eq!(empty["state"]["spectatorPetIds"], json!([]));
}

#[test]
fn losing_inactive_growth_does_not_clear_the_active_pets_conquest() {
    let mut engine = BattleEngine::demo();
    command(
        &mut engine,
        sync_command(
            vec![pet("selected", json!(19)), pet("other", json!(55))],
            Some("selected"),
            1000,
        ),
    );
    command(
        &mut engine,
        sync_command(
            vec![pet("selected", json!(20)), pet("other", json!(55))],
            Some("selected"),
            1100,
        ),
    );
    let response = command(
        &mut engine,
        sync_command(
            vec![pet("selected", json!(20)), pet("other", Value::Null)],
            Some("selected"),
            1200,
        ),
    );
    assert_eq!(response["state"]["overlay"]["phase"], "DEFEAT_MOTION");
    assert_eq!(response["state"]["roster"][1]["syncedTotalXp"], Value::Null);
    assert_eq!(response["state"]["roster"][1]["stage"], 1);
    assert_eq!(response["events"], json!([]));
}
