use std::io::{self, BufRead};

use pet_battle::{BattleEngine, handle_json_line};

fn main() {
    let stdin = io::stdin();
    let mut engine = BattleEngine::demo();
    for line in stdin.lock().lines() {
        match line {
            Ok(line) => println!("{}", handle_json_line(&mut engine, &line)),
            Err(error) => {
                eprintln!("battle sidecar input failed: {error}");
                break;
            }
        }
    }
}
