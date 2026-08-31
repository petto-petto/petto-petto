use std::path::PathBuf;

use pet_battle::generate_enemy_asset_set;

fn main() {
    let package_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map_or_else(|| PathBuf::from("."), PathBuf::from);
    let source = package_root.join("assets/source/enemies");
    let output = package_root.join("assets/enemies");
    if let Err(error) = generate_enemy_asset_set(&source, &output) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
