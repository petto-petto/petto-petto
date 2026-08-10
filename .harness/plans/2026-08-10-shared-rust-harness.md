# Shared Rust Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move only the reusable harness concepts into `tamagochi-pet` so Claude Code and Codex share one Rust-aware workflow and one set of Skills.

**Architecture:** `AGENTS.md` is the common instruction entrypoint and `CLAUDE.md` imports it. Skill bodies remain canonical under `.claude/skills`, while Codex discovers relative symlinks under `.agents/skills`; neutral rules, roles, scripts, references, tests, and history live under `.harness`.

**Tech Stack:** Markdown, POSIX-compatible Bash, Git symlinks, Cargo, rustfmt, Clippy.

## Global Constraints

- Do not modify `Cargo.toml`, `Cargo.lock`, `.gitignore`, `src/**`, or the original `ai-pet-design` repository.
- Do not copy previous product specifications, mockups, ownership tables, assets, TypeScript/Electron conventions, or Ouroboros runtime components.
- Copy `/Users/ohk9134/Downloads/writing-great-skills/SKILL.md` and `GLOSSARY.md` byte-for-byte into `.harness/references/writing-great-skills/`.
- Keep `AGENTS.md` and `.claude/skills/*/SKILL.md` as the only instruction and Skill sources; adapters must not duplicate their bodies.
- The Rust verification order is format, check, Clippy with warnings denied, then tests.
- Every Skill change requires a baseline scenario, a failing contract or behavior check, the minimal Skill body, and a passing rerun.
- No Ouroboros executable, package, MCP server, EventStore, Ralph loop, or numeric ambiguity gate may be added.

---

### Task 1: Common contract, references, and Rust rules

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `.harness/README.md`
- Create: `.harness/CHANGELOG.md`
- Create: `.harness/rules/rust.md`
- Create: `.harness/rules/skill-authoring.md`
- Create: `.harness/references/writing-great-skills/SKILL.md`
- Create: `.harness/references/writing-great-skills/GLOSSARY.md`
- Create: `.harness/tests/verify-contract.sh`

**Interfaces:**
- Consumes: the approved design and the two external writing references.
- Produces: stable paths and contract checks consumed by both Skills and later tasks.

- [ ] **Step 1: Write the failing contract test**

Create `.harness/tests/verify-contract.sh` that checks all required paths, exact reference hashes, `CLAUDE.md` import, Skill adapter targets, Skill frontmatter, required Rust commands, and forbidden stale references. It must print each failed assertion and exit non-zero.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `bash .harness/tests/verify-contract.sh`

Expected: FAIL because the common entrypoints, references, rules, Skills, and adapters do not exist.

- [ ] **Step 3: Add the common entrypoints, exact references, and rules**

`AGENTS.md` must tell both tools when to read `.harness/rules/rust.md`, when to read both writing references, how to invoke `$work` and `$harness-improve`, and that completion requires fresh evidence. `CLAUDE.md` must contain the `@AGENTS.md` import without duplicating project rules. The Rust rule must contain the four exact Cargo commands from Global Constraints.

- [ ] **Step 4: Run the scoped contract test**

Run: `bash .harness/tests/verify-contract.sh`

Expected: it still fails only for Skills, roles, scripts, and adapters scheduled for later tasks; reference hash and common rule checks pass.

- [ ] **Step 5: Commit only Task 1 files**

Run: `git add AGENTS.md CLAUDE.md .harness && git commit -m "docs: establish shared Rust harness contract"`

### Task 2: Work Skill and shared roles

**Files:**
- Create: `.claude/skills/work/SKILL.md`
- Create: `.harness/roles/explorer.md`
- Create: `.harness/roles/planner.md`
- Create: `.harness/roles/implementer.md`
- Create: `.harness/roles/verifier.md`
- Create: `.harness/roles/reviewer.md`
- Create: `.harness/tests/skill-scenarios.md`

**Interfaces:**
- Consumes: `.harness/rules/rust.md`, `.harness/rules/skill-authoring.md`, and common entrypoint paths.
- Produces: the canonical `work` Skill and runtime-neutral role contracts.

- [ ] **Step 1: Record the pre-Skill scenario result**

In `.harness/tests/skill-scenarios.md`, record whether the baseline response explicitly used Interview/Seed, track selection, all three verification layers, and Evolve. Mark missing requirements as RED evidence without rewriting the baseline answer.

- [ ] **Step 2: Write the minimal work Skill**

Use frontmatter name `work`. Its description must lead with triggers for feature work, bug fixes, refactors, Rust changes, and explicit `/work` or `$work`. The body must define entry, lightweight and standard tracks, Interview/Seed for standard work, the five role contracts, Mechanical/Semantic/Independent Review, Evolve, and observable completion criteria.

- [ ] **Step 3: Run the post-Skill scenario**

Give a fresh agent the same pet-state request with the Skill available. Record whether every required phase appears and whether it refuses a completion claim without fresh command output.

- [ ] **Step 4: Run contract and Skill validation**

Run: `bash .harness/tests/verify-contract.sh`

Expected: work Skill checks pass; only later harness-improve/adapters/scripts checks may fail.

- [ ] **Step 5: Commit Task 2 files**

Run: `git add .claude/skills/work .harness/roles .harness/tests/skill-scenarios.md && git commit -m "feat: add shared Rust work workflow"`

### Task 3: Harness improvement Skill and friction loop

**Files:**
- Create: `.claude/skills/harness-improve/SKILL.md`
- Create: `.harness/friction/README.md`

**Interfaces:**
- Consumes: the embedded writing references and the contract from Task 1.
- Produces: an evidence-based evolution path for all shared harness files.

- [ ] **Step 1: Record the pre-Skill scenario result**

Append the baseline improvement response assessment to `.harness/tests/skill-scenarios.md`, checking for evidence collection, root-cause classification, pruning before adding, user approval, RED–GREEN Skill verification, contract validation, and change documentation.

- [ ] **Step 2: Write the minimal harness-improve Skill**

Use frontmatter name `harness-improve`. Its description must lead with explicit and implicit triggers for changing rules, Skills, roles, verification, or repeated friction. Its body must require both embedded references, evidence before rules, smallest-change and pruning review, user approval, RED–GREEN tests, contract verification, and `CHANGELOG.md` updates.

- [ ] **Step 3: Run the post-Skill scenario**

Give a fresh agent the same missed-verification request with the Skill available. Record whether it preserves the single source of truth and refuses to change the harness without evidence and approval.

- [ ] **Step 4: Run contract validation**

Run: `bash .harness/tests/verify-contract.sh`

Expected: both canonical Skill checks pass; adapter and Rust runner checks may remain.

- [ ] **Step 5: Commit Task 3 files**

Run: `git add .claude/skills/harness-improve .harness/friction .harness/tests/skill-scenarios.md && git commit -m "feat: add evidence-driven harness evolution"`

### Task 4: Runtime adapters and final verification

**Files:**
- Create: `.agents/skills/work` symbolic link
- Create: `.agents/skills/harness-improve` symbolic link
- Create: `.harness/scripts/verify-rust.sh`
- Modify: `.harness/README.md`
- Modify: `.harness/CHANGELOG.md`
- Modify: `.harness/tests/verify-contract.sh`

**Interfaces:**
- Consumes: canonical Skills and all shared rules.
- Produces: Claude/Codex discovery parity and reproducible completion commands.

- [ ] **Step 1: Confirm the contract remains RED**

Run: `bash .harness/tests/verify-contract.sh`

Expected: FAIL for missing adapter symlinks and Rust verification runner.

- [ ] **Step 2: Add thin adapters and the Rust runner**

Create relative links to `../../../.claude/skills/work` and `../../../.claude/skills/harness-improve`. Create a fail-fast Bash runner executing the four Cargo commands in the exact required order.

- [ ] **Step 3: Run all structural and Rust checks**

Run:

```bash
bash .harness/tests/verify-contract.sh
bash -n .harness/tests/verify-contract.sh .harness/scripts/verify-rust.sh
bash .harness/scripts/verify-rust.sh
git diff --check
```

Expected: every command exits zero with no warnings or diff whitespace errors.

- [ ] **Step 4: Verify migration scope**

Run `git status --short`, `git diff --name-only main...HEAD`, and searches for `ai-pet-design`, `TypeScript`, `Electron`, `Math.random`, `EventStore`, `Ralph`, and Ouroboros installation commands. Confirm only harness files are committed and any copied Cargo files remain untracked and unchanged.

- [ ] **Step 5: Commit Task 4 files**

Run: `git add .agents .harness && git commit -m "build: expose shared harness to Claude and Codex"`

## Self-Review

- Spec coverage: all four user requirements map to Tasks 1–4.
- Placeholder scan: no TBD, TODO, deferred implementation, or undefined interface remains.
- Path consistency: `.claude/skills` is canonical; `.agents/skills` contains only relative links; shared material lives under `.harness`.
- Safety: original Rust files and previous repository remain outside every `git add` command.
