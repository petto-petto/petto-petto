#!/usr/bin/env bash

set -euo pipefail

if [ ! -f Cargo.toml ]; then
  printf '%s\n' 'Rust verification cannot run: Cargo.toml is missing. This harness branch does not track Cargo.toml/Cargo.lock; land the existing manifest separately, then rerun bash .harness/scripts/verify-rust.sh.'
  exit 1
fi

cargo fmt --all -- --check
cargo check --workspace --all-targets --all-features
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
