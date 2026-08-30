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
