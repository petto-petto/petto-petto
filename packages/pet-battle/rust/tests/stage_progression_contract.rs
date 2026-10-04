use pet_battle::{BattleEngine, handle_json_line};
use serde_json::{Value, json};

fn command(engine: &mut BattleEngine, command: Value) -> Value {
    let result: Value = serde_json::from_str(&handle_json_line(
        engine,
        &json!({"requestId": "stage-contract", "command": command}).to_string(),
    ))
    .expect("JSON response");
    assert_eq!(result["ok"], true, "{result}");
    result
}

fn sync(engine: &mut BattleEngine, rarity: &str, xp: u64, costs: &[u64]) -> Value {
    command(
        engine,
        json!({
            "type": "SYNC_OWNED_PETS", "nowMs": 1000,
            "activePetId": "owned-1", "spectatorPetIds": [],
            "levelXpCosts": costs, "intervalLevels": {"COMMON":12,"RARE":10,"EPIC":8},
            "pets": [{"petId":"owned-1","displayName":"토리","rarity":rarity,
                "level":50,"sprite":"acorn_squirrel","evolutionStage":2,"totalXp":xp}]
        }),
    )
}

fn current_costs() -> Vec<u64> {
    (1..=50).map(|level| 10 + level / 2).collect()
}

#[test]
fn all_rarities_complete_twenty_one_enemies_at_level_fifty() {
    let costs = current_costs();
    let colors = [
        "RED", "ORANGE", "YELLOW", "GREEN", "BLUE", "PURPLE", "RAINBOW",
    ];
    for rarity in ["COMMON", "RARE", "EPIC"] {
        let mut xp = 0;
        let mut level_index = 0;
        for stage in 1..=21 {
            let levels = [2, 2, 3][(stage - 1) % 3];
            let target = costs[level_index..level_index + levels].iter().sum::<u64>();
            let start = sync(&mut BattleEngine::demo(), rarity, xp, &costs);
            let pet = &start["state"]["activePet"];
            assert_eq!(pet["stage"], stage, "{rarity} at {xp} XP");
            assert_eq!(pet["intervalXp"], 0);
            assert_eq!(pet["growthTargetXp"], target);
            assert_eq!(pet["syncedTotalXp"], xp, "restoration must not rewrite XP");
            assert_eq!(start["state"]["enemyColor"], colors[(stage - 1) / 3]);
            assert_eq!(start["state"]["enemyHpRatio"], 1.0);
            assert_eq!(start["state"]["overlay"], Value::Null);
            assert_eq!(
                start["events"],
                json!([]),
                "restore must not replay old victories"
            );

            let before = sync(&mut BattleEngine::demo(), rarity, xp + target - 1, &costs);
            assert_eq!(before["state"]["activePet"]["stage"], stage);
            let hp = before["state"]["enemyHpRatio"]
                .as_f64()
                .expect("numeric HP");
            assert!((hp - 1.0 / target as f64).abs() < 0.000_001);
            xp += target;
            level_index += levels;
        }
        assert_eq!(level_index, 49, "Lv.1 to Lv.50 is 49 level advances");
        assert_eq!(xp, 1090);
        let completed = sync(&mut BattleEngine::demo(), rarity, xp, &costs);
        assert_eq!(completed["state"]["activePet"]["stage"], 22);
        assert_eq!(completed["state"]["enemyColor"], "RED");
        assert_eq!(completed["state"]["activePet"]["growthTargetXp"], 70);
    }
}

#[test]
fn after_level_cap_last_cost_continues_the_two_two_three_pattern() {
    let costs = current_costs();
    for rarity in ["COMMON", "RARE", "EPIC"] {
        for (xp, stage, within, target) in [
            (1090, 22, 0, 70),
            (1125, 22, 35, 70),
            (1160, 23, 0, 70),
            (1230, 24, 0, 105),
            (1334, 24, 104, 105),
            (1335, 25, 0, 70),
        ] {
            let restored = sync(&mut BattleEngine::demo(), rarity, xp, &costs);
            let pet = &restored["state"]["activePet"];
            assert_eq!(pet["stage"], stage);
            assert_eq!(pet["intervalXp"], within);
            assert_eq!(pet["growthTargetXp"], target);
            assert_eq!(restored["state"]["overlay"], Value::Null);
        }
    }
}

#[test]
fn curve_ending_mid_color_uses_last_cost_and_never_restarts_level_costs() {
    for (xp, stage, within, target) in [
        (0, 1, 0, 5),
        (5, 2, 0, 12),
        (17, 3, 0, 21),
        (37, 3, 20, 21),
        (38, 4, 0, 14),
        (87, 7, 0, 14),
    ] {
        let restored = sync(&mut BattleEngine::demo(), "RARE", xp, &[2, 3, 5, 7]);
        let pet = &restored["state"]["activePet"];
        assert_eq!(pet["stage"], stage);
        assert_eq!(pet["intervalXp"], within);
        assert_eq!(pet["growthTargetXp"], target);
    }
}

#[test]
fn maximum_xp_remains_bounded_and_preserves_valid_hp() {
    for costs in [vec![1], current_costs(), vec![1_000_000; 100]] {
        let restored = sync(&mut BattleEngine::demo(), "EPIC", u64::MAX, &costs);
        let pet = &restored["state"]["activePet"];
        assert_eq!(pet["stage"], u32::MAX);
        assert_eq!(pet["syncedTotalXp"], u64::MAX);
        assert!(
            pet["intervalXp"].as_u64().expect("interval")
                < pet["growthTargetXp"].as_u64().expect("target")
        );
        let hp = restored["state"]["enemyHpRatio"].as_f64().expect("HP");
        assert!(hp.is_finite() && (0.0..=1.0).contains(&hp));
    }
}

#[test]
fn size_preview_advances_from_actual_stage_and_stays_independent_of_color() {
    for (xp, next_size) in [(0, "MEDIUM"), (21, "LARGE"), (44, "SMALL")] {
        let mut engine = BattleEngine::demo();
        let original = sync(&mut engine, "COMMON", xp, &current_costs());
        let size = command(&mut engine, json!({"type":"CYCLE_ENEMY_SIZE"}));
        assert_eq!(size["state"]["preview"]["enemySize"], next_size);
        let color = command(&mut engine, json!({"type":"CYCLE_ENEMY_COLOR"}));
        assert_eq!(color["state"]["preview"]["enemyColor"], "ORANGE");
        assert_eq!(color["state"]["preview"]["enemySize"], next_size);
        assert_eq!(color["state"]["activePet"], original["state"]["activePet"]);
        let reset = command(
            &mut engine,
            json!({"type":"PREVIEW_ENEMY","action":"RESET","nowMs":1100}),
        );
        assert_eq!(reset["state"]["preview"]["enemySize"], Value::Null);
        assert_eq!(reset["state"]["enemyColor"], "RED");
    }
}

#[test]
fn live_color_boundary_waits_for_spawn_and_preserves_opacity() {
    let mut engine = BattleEngine::demo();
    sync(&mut engine, "EPIC", 81, &current_costs());
    command(
        &mut engine,
        json!({"type":"SET_DISPLAY_OPACITY","percent":35}),
    );
    let conquered = sync(&mut engine, "EPIC", 82, &current_costs());
    assert_eq!(conquered["state"]["activePet"]["stage"], 4);
    assert_eq!(conquered["state"]["overlay"]["defeatedStage"], 3);
    assert_eq!(conquered["state"]["overlay"]["nextStage"], 4);
    assert_eq!(conquered["state"]["enemyColor"], "RED");
    assert_eq!(conquered["state"]["enemyHpRatio"], 0.0);
    let repeated = sync(&mut engine, "EPIC", 82, &current_costs());
    assert_eq!(repeated["events"], json!([]));
    let defeating = command(&mut engine, json!({"type":"GET_STATE","nowMs":2400}));
    assert_eq!(defeating["state"]["overlay"]["phase"], "DEFEAT_MOTION");
    assert_eq!(defeating["state"]["enemyColor"], "RED");
    let spawning = command(&mut engine, json!({"type":"GET_STATE","nowMs":2480}));
    assert_eq!(spawning["state"]["overlay"]["phase"], "SPAWNING");
    assert_eq!(spawning["state"]["enemyColor"], "ORANGE");
    assert_eq!(spawning["state"]["enemyHpRatio"], 1.0);
    let opacity = spawning["state"]["preview"]["displayOpacity"]
        .as_f64()
        .expect("opacity");
    assert!((opacity - 0.35).abs() < 0.000_001);
}
