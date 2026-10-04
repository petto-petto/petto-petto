use pet_battle::{BattleEngine, handle_json_line};
use serde_json::{Value, json};

fn sync(engine: &mut BattleEngine, rarity: &str, xp: u64) -> Value {
    let costs: Vec<u64> = (1..=50).map(|level| 10 + level / 2).collect();
    serde_json::from_str(&handle_json_line(
        engine,
        &json!({
            "requestId": "sync", "command": {
                "type": "SYNC_OWNED_PETS", "nowMs": 1000,
                "activePetId": "owned-1", "spectatorPetIds": [],
                "levelXpCosts": costs, "intervalLevels": {"COMMON":12,"RARE":10,"EPIC":8},
                "pets": [{"petId":"owned-1","displayName":"토리","rarity":rarity,
                    "level":13,"sprite":"acorn_squirrel","evolutionStage":0,"totalXp":xp}]
            }
        })
        .to_string(),
    ))
    .expect("json response")
}

fn command(engine: &mut BattleEngine, command: Value) -> Value {
    let response: Value = serde_json::from_str(&handle_json_line(
        engine,
        &json!({ "requestId": "opacity", "command": command }).to_string(),
    ))
    .expect("json response");
    assert_eq!(response["ok"], true, "{response}");
    response
}

fn assert_opacity(response: &Value, percent: u8) {
    let actual = response["state"]["preview"]["displayOpacity"]
        .as_f64()
        .expect("numeric opacity");
    let expected = f64::from(percent) / 100.0;
    assert!(
        (actual - expected).abs() < 0.000_001,
        "expected {percent}% opacity, got {actual}: {response}"
    );
}

#[test]
fn conquest_preserves_opacity_through_automatic_spawn_and_next_enemy() {
    for (rarity, threshold) in [("COMMON", 21), ("RARE", 21), ("EPIC", 21)] {
        for percent in [35, 0, 100] {
            let mut engine = BattleEngine::demo();
            sync(&mut engine, rarity, threshold - 1);
            let configured = command(
                &mut engine,
                json!({ "type": "SET_DISPLAY_OPACITY", "percent": percent }),
            );
            assert_opacity(&configured, percent);
            for kind in [
                "CYCLE_ENEMY_SIZE",
                "CYCLE_ENEMY_COLOR",
                "CYCLE_ENEMY_HP",
                "CYCLE_PET_ASSET",
                "CYCLE_ATTACK_EFFECT",
            ] {
                command(&mut engine, json!({ "type": kind }));
            }
            command(
                &mut engine,
                json!({ "type": "TOGGLE_MENU", "menu": "ENEMY" }),
            );
            command(
                &mut engine,
                json!({ "type": "PREVIEW_ENEMY", "action": "HIT", "nowMs": 1000 }),
            );

            let conquered = sync(&mut engine, rarity, threshold);
            assert_eq!(conquered["state"]["overlay"]["phase"], "DEFEAT_MOTION");
            assert_eq!(conquered["state"]["enemyHpRatio"], 0.0);
            assert_opacity(&conquered, percent);
            let preview = &conquered["state"]["preview"];
            assert_eq!(preview["menu"], "CLOSED");
            assert_eq!(preview["enemyPhase"], "VISIBLE");
            for key in [
                "petAction",
                "enemyAction",
                "enemySize",
                "enemyColor",
                "enemyHpRatio",
                "petAssetRarity",
                "attackEffectRarity",
            ] {
                assert!(preview[key].is_null(), "{key} must reset: {preview}");
            }
            let repeated = sync(&mut engine, rarity, threshold);
            assert_eq!(repeated["events"], json!([]));
            assert_opacity(&repeated, percent);

            for (kind, now, phase) in [
                ("GET_STATE", 2480, json!("SPAWNING")),
                ("OVERLAY_CLICK", 3100, json!("SPAWNING")),
                ("GET_STATE", 4000, Value::Null),
            ] {
                let response = command(&mut engine, json!({ "type": kind, "nowMs": now }));
                assert_eq!(response["state"]["overlay"]["phase"], phase);
                assert_opacity(&response, percent);
                if kind == "OVERLAY_CLICK" {
                    assert_eq!(response["state"]["enemyColor"], "RED");
                    assert_eq!(response["state"]["enemyHpRatio"], 1.0);
                }
            }
        }
    }
}

#[test]
fn skipped_stages_and_defeat_skip_click_preserve_opacity() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, "COMMON", 20);
    command(
        &mut engine,
        json!({ "type": "SET_DISPLAY_OPACITY", "percent": 35 }),
    );
    let conquered = sync(&mut engine, "COMMON", 82);
    assert_eq!(conquered["state"]["activePet"]["stage"], 4);
    assert_eq!(conquered["events"][0]["skippedStages"], 2);
    assert_opacity(&conquered, 35);
    for (now, phase) in [(1100, "SPAWNING"), (1200, "SPAWNING")] {
        let response = command(
            &mut engine,
            json!({ "type": "OVERLAY_CLICK", "nowMs": now }),
        );
        assert_eq!(response["state"]["overlay"]["phase"], phase);
        assert_opacity(&response, 35);
    }
}

#[test]
fn explicit_pet_selection_still_resets_opacity() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, "COMMON", 155);
    command(
        &mut engine,
        json!({ "type": "SET_DISPLAY_OPACITY", "percent": 35 }),
    );
    let selected = command(
        &mut engine,
        json!({ "type": "SET_ACTIVE_PET", "petId": "owned-1" }),
    );
    assert_opacity(&selected, 100);
}

#[test]
fn persisted_growth_uses_real_level_intervals_and_not_fixed_demo_xp() {
    for (rarity, threshold) in [("COMMON", 21), ("RARE", 21), ("EPIC", 21)] {
        let mut engine = BattleEngine::demo();
        let initial = sync(&mut engine, rarity, threshold - 1);
        assert_eq!(initial["ok"], true, "{initial}");
        assert_eq!(initial["state"]["activePet"]["stage"], 1);
        let conquered = sync(&mut engine, rarity, threshold);
        assert_eq!(conquered["state"]["activePet"]["stage"], 2);
        assert_eq!(
            conquered["state"]["enemyColor"], "RED",
            "keep the defeated enemy during its effect"
        );
        assert_eq!(conquered["events"][0]["type"], "ENEMY_DEFEATED");
        let repeated = sync(&mut engine, rarity, threshold);
        assert_eq!(repeated["events"], json!([]), "poll must not replay XP");
        assert_eq!(repeated["state"]["overlay"]["phase"], "DEFEAT_MOTION");
    }
}

#[test]
fn first_sync_restores_high_level_stage_without_replaying_old_conquests() {
    let mut engine = BattleEngine::demo();
    let restored = sync(&mut engine, "COMMON", 320);
    assert_eq!(restored["ok"], true, "{restored}");
    assert_eq!(restored["state"]["activePet"]["stage"], 10);
    assert_eq!(restored["state"]["background"], "CRYSTAL_RUINS");
    assert_eq!(restored["state"]["overlay"], Value::Null);
}

#[test]
fn malformed_command_preserves_request_id_so_ipc_can_reject_it() {
    let mut engine = BattleEngine::demo();
    let response: Value = serde_json::from_str(&handle_json_line(
        &mut engine, r#"{"requestId":"bad-command","command":{"type":"PREVIEW_PET","action":"INVALID","nowMs":0}}"#,
    )).expect("JSON error response");
    assert_eq!(response["ok"], false);
    assert_eq!(response["requestId"], "bad-command");
}
