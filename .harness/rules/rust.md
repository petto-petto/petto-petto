# Rust Rules

Read this rule before changing Rust code or Cargo configuration, and before reporting a Rust change complete.

## Engineering expectations

- Let `rustfmt` define formatting.
- Use idiomatic names and focused module boundaries.
- Handle errors explicitly; introduce `unsafe` only when the smallest necessary use is justified.
- Add unit, integration, or documentation tests appropriate to changed behavior.
- Do not invent an MSRV while the project has not declared one.

## Verification gate

Run these commands in this exact order from the repository root after the final Rust change:

```bash
cargo fmt --check
cargo check
cargo clippy -- -D warnings
cargo test
```

Completion evidence is the fresh output from every applicable command. A failed or unavailable command is a reported verification gap, not a passing gate.
