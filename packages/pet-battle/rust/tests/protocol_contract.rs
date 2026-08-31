use pet_battle::{BattleCommand, BattleEngine, BattleRequest, BattleResponse};

#[test]
fn json_protocol_round_trips_state_and_events() {
    let mut engine = BattleEngine::demo();
    let request = BattleRequest {
        request_id: "request-1".to_owned(),
        command: BattleCommand::GrowthXpAdded {
            pet_id: "mio".to_owned(),
            amount: 25,
            now_ms: 1_200,
        },
    };

    let response = engine.handle(request);
    let encoded = serde_json::to_string(&response).expect("response should serialize");
    let decoded: BattleResponse = serde_json::from_str(&encoded).expect("response should decode");

    assert_eq!(decoded.request_id, "request-1");
    assert!(decoded.ok);
    assert_eq!(decoded.events.len(), 1);
    assert!((decoded.state.enemy_hp_ratio - (95.0 / 120.0)).abs() < f32::EPSILON);
}

#[test]
fn malformed_json_returns_a_typed_error_response() {
    let response = pet_battle::handle_json_line(&mut BattleEngine::demo(), "{not-json");
    let decoded: BattleResponse = serde_json::from_str(&response).expect("error should be json");

    assert!(!decoded.ok);
    assert!(decoded.error.is_some());
}
