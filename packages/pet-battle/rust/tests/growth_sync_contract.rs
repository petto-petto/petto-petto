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

#[test]
fn persisted_growth_uses_real_level_intervals_and_not_fixed_demo_xp() {
    for (rarity, threshold) in [("COMMON", 156), ("RARE", 125), ("EPIC", 96)] {
        let mut engine = BattleEngine::demo();
        let initial = sync(&mut engine, rarity, threshold - 1);
        assert_eq!(initial["ok"], true, "{initial}");
        assert_eq!(initial["state"]["activePet"]["stage"], 1);
        let conquered = sync(&mut engine, rarity, threshold);
        assert_eq!(conquered["state"]["activePet"]["stage"], 2);
        assert_eq!(conquered["state"]["enemyColor"], "RED", "wait for click");
        assert_eq!(conquered["events"][0]["type"], "ENEMY_DEFEATED");
        let repeated = sync(&mut engine, rarity, threshold);
        assert_eq!(repeated["events"], json!([]), "poll must not replay XP");
        assert_eq!(repeated["state"]["overlay"]["phase"], "DEFEAT_MOTION");
    }
}

#[test]
fn first_sync_restores_high_level_stage_without_replaying_old_conquests() {
    let mut engine = BattleEngine::demo();
    let restored = sync(&mut engine, "COMMON", 156 + 228 + 300);
    assert_eq!(restored["ok"], true, "{restored}");
    assert_eq!(restored["state"]["activePet"]["stage"], 4);
    assert_eq!(restored["state"]["background"], "CRYSTAL_RUINS");
    assert_eq!(restored["state"]["overlay"], Value::Null);
}
