# Changelog

## 2026-08-27 — 런타임을 Rust에서 Electron으로 전환

- 팀이 프로젝트 언어를 Rust에서 TypeScript·Electron으로 바꾸기로 결정했다.
- `rules/rust.md`를 `rules/electron.md`로, `scripts/verify-rust.sh`를
  `scripts/verify-electron.sh`로 대체했다. 게이트는 `npm run format:check` →
  `npm run typecheck` → `npm test` 세 단계다.
- 계약 검사의 금지어 목록에서 `TypeScript`와 `Electron`을 뺐다. 프로젝트가 그
  스택으로 돌아왔으므로 더 이상 잔재가 아니다. 비결정적 난수 금지는 유지한다.
- 과거 픽스처와 시나리오 기록은 그대로 둔다. 지난 실행의 증거이므로 고치면
  기록을 위조하는 것이 된다.

## Unreleased

### Added

- `background-generator` now ships high-detail outdoor stamp variants
  (`rock_mossy`, `mushroom_cluster`, `log_mossy`, `bush_leafy`) and a rule for
  when to reach for them, so large canvases stop upscaling 5-9px props into
  blocks. `references/stamps.md` remains the single source for the stamp list.
- `background-generator` gained the `forest_night` preset for moonlit outdoor
  scenes. Existing preset colours were not changed.
- `background-generator`'s `tree_column` gained bark styles (`fissure`, `plate`,
  `lenticel`), climbing ivy (`ivyStrands`), branch stubs, ringed knots, ragged
  moss, forked roots, silhouette wobble, and twin trunks (`trunks` +
  `converge`). The old three signals — sway, cylinder shading, grooves — only
  reached "not a utility pole"; the largest object on screen needs more.
  `references/ops.md` documents the parameters and `references/troubleshooting.md`
  names the five failures found while building it.
- `background-generator`'s `foliage` gained an opt-in canopy mode (`crest`,
  `crestFreq`, `litSpan`, `litClumps`, `twigs`) that lights lobes by their place
  in the mass rather than giving every lobe its own rim, and `ground_plane`
  gained forest-floor detail (`patches`, `pebbles`, `pebbleMax`, `debris`) plus a
  ragged grass line. Both default to the previous behaviour, and the disabled
  path draws no extra random numbers so existing scenes render unchanged.
- `background-generator` gained the `petroom_grove` preset — `jungle`'s hues with
  the luminance pulled down and the near-white top removed. Existing preset
  colours were not changed.
- `references/gate_conflicts.md` records a sixth conflict: a far foliage crest
  moves the sky's lower boundary, and a fragmented sky has no left-right light
  direction for the light-consistency gate to find.
- `bg_score.py` now judges tone by the image's own dynamic range (98th minus 2nd
  percentile luminance, floor 0.55) instead of demanding 2% of pixels above an
  absolute L of 0.75, which penalised deliberately dark scenes. Measured: the
  three reference images span 0.744-0.835 while their bright-pixel share spans
  4.1-34.9%, so the absolute figure was never a usable bar.
- `bgcore.accent_contrast` reports how far a preset's `accent` ramp sits from its
  mass ramps, and `bg_palette.py show` prints it. Three of the five original
  presets place `accent` inside the dominant hue family and so cannot produce the
  hue contrast `references/color.md` asks of it.
- `references/quality.md` records hue dominance and contrast-hue share as
  *rejected* metrics, with the measurements that reject them.
- `bg_interview.py` gained three slots — 움직이는 요소, 변형 개수, 노출·톤 강도 —
  and rebalanced the existing ten so the weights still total 100. The three are
  *blocking*: the verdict stays "아직 묻는다" while any is empty and unrecorded in
  `assumed`, even below the 20% ambiguity threshold, because they decide what
  gets baked rather than how the picture looks.
- `bg_preset_new.py` gained `--from <preset> --burn <0..1>`, deriving a burned
  palette from an existing one instead of generating from keywords. It maps
  per-ramp luminance bands and re-imposes the depth ladder, because a single
  curve cannot satisfy layer separation and luminance-bin coverage at once —
  raising gamma collapses the first, lowering it empties the second. It also
  scales in RGB rather than HLS lightness, and lets achromatic steps inherit a
  hue. Measured on `jungle`: burn 0.5-0.7 passes every gate, 0.9 does not, and
  the tool predicts that before rendering.
- `SKILL.md` documents isolating a single component for review before touching
  the whole background, and keeping regeneration tooling in `tools/` rather than
  a scratch directory.
- `references/ops.md` states that an opt-in parameter's disabled path must draw
  no extra random numbers, or the same seed moves layers the change never
  touched.
- The Skill's fail-closed Pillow assertion now builds its own clean environment.
  It previously reported a failure whenever the checking shell could import
  Pillow, which made the result depend on who ran it.
- `background-generator` gained `scripts/bg_animate.py`: it reads a background's
  `scene.json`, re-renders only the ops marked `"animate": true`, collects the
  moving layer into `frames/`, and writes the runtime `animation` block. Which
  ops move is now declared by the scene instead of hardcoded, and all movers must
  sit in one layer because the runtime swaps one layer.
- `bg_check.py` now validates that block — the named layer exists, at least two
  frames, a sane fps, every frame file present and under `frames/`, frames
  matching the canvas and the layer they replace, and frames actually differing
  from one another.
- `references/layers.md` documents the runtime contract and marks it unvalidated:
  nothing consumes it yet, so a first consumer that finds it lacking should have
  the contract changed rather than work around it.

### Changed

- `background-generator` now exports every runtime background under Electron's
  `apps/desktop/renderer/assets/backgrounds/` path and verifies that contract.
- Renamed `pixel-pet-creator-pillow` to `pet-generator` and made Claude and
  Codex share one canonical Skill source.
- `background-generator` now contains the complete scene, palette, rendering,
  checking, scoring, preview, reference, evaluation, and stamp toolkit.
- `background-generator` now keeps full, byte-identical Claude and Codex Skill
  trees so both tools load the same stamps and references.
- `background-generator` now fails closed when Pillow is unavailable; it never
  renders, verifies, or installs the dependency in that state.
- Design work now has one canonical guide: `AGENTS.md` requires `design.md`
  before UI, visual, or interaction design changes. The Korean version is for
  human reading and is not an agent instruction source.
- Expanded the meta product overview from three partial screen examples to a
  17-panel gallery covering every planned information, settings, and
  achievements function plus materially different UI states.
- Renamed the meta product specification to the stable, content-focused
  `specs/meta-info-settings-achievements-design.md` path and made that naming
  convention part of the harness contract.

### Added

- Local `background-generator` Skill and deterministic `320x180` forest-background renderer for the desktop pet room, with one shared source exposed to both Codex and Claude.
- Korean one-page meta product overview for briefing teammates on the approved
  information, settings, achievements, local collection, and reward design.
- Korean quick-start and concept-application guides at
  `.harness/guides/quick-start.html` and
  `.harness/guides/concept-application.html`.
- Conditional Specifier branch for new or changed features with a missing or
  ambiguous specification. Approved feature specifications in
  `.harness/specs/features/` are standard-track Seeds; Explorer, Planner,
  Implementer, Verifier, and Reviewer remain the five core roles. RED and GREEN
  evidence is retained in the Specifier fixture scenario and contract checks:
  `verify-work-skill.sh` was RED with 18 missing-Specifier assertions, then
  `verify-work-skill.sh` and `verify-contract.sh` were GREEN.
- Approved meta product specification for information, settings, achievements,
  three-source local usage collection, and macOS/Windows acceptance criteria.
- Contract assertions for the meta specification and its implementation-facing
  requirement ID families.
- Common Rust harness entrypoints, rules, embedded writing references, and contract verification.
- Canonical `work` Skill, runtime-neutral role contracts, and reproducible work-scenario evidence.
- Task 2: executable `work` Skill behavior verification.
- Canonical `harness-improve` Skill, friction evidence record, and reproducible evidence-driven harness evolution checks.
- Task 4: Codex Skill adapters and the shared fail-fast Rust verification runner.
- Hardened canonical Skill frontmatter and the harness-improve response protocol
  contract; the behavior probe now supports a fixture override for mutation checks.
- Harness work does not modify package.json or package-lock.json; a clean checkout
  runs `npm install` before the completion gate can run.

### Fixed

- Korean guides now point verification and feature workflow readers to their
  canonical owners; the contract rejects tracked Markdown plans from the index.
- Feature-spec triggers are evaluated before track selection, so user-visible
  behavior, domain rules, public interfaces, persisted formats, and ambiguous
  requests cannot bypass the standard Specifier gate through lightweight work.
- Korean guides distinguish Claude Code slash invocation from Codex `$` Skill
  mentions, state the two-stage Specifier condition, and map Interview, Seed,
  Execute, Evaluate, and Evolve to the canonical workflow.
- The contract rejects every index-tracked feature specification except
  `README.md` and dated `YYYY-MM-DD-<feature-name>.md` files, including
  index-only entries. Specifier and the feature template now assign product
  `what`/`why` to the specification and technical `how` to planning.

### Removed

- Obsolete shared Rust harness plan at
  `.harness/plans/2026-08-10-shared-rust-harness.md`.
