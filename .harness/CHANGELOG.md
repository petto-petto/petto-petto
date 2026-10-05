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

- 2026-10-04 전투의 Client 경계·선택 조회 명세를 `specs/features/2026-09-30-battle-integration.md`로 통합했다. 대화 인용과 중복·과거 실행 설명을 제거하고 기존 feature 템플릿의 요구사항·수용 기준으로 정리했다. 기능 범위와 공통 하네스 규칙은 변경하지 않았다.
- 2026-10-05 결정으로 `rules/feature-contracts.md` 를 다시 썼다. **작업하는 쪽이 Port 를 선언한다**
  — 다른 도메인의 데이터가 필요하면 그 기능이 인터페이스 · 구현체 · Repository 를 `petto.sqlite` 에
  선언된 테이블 위에 직접 만든다. 담당자에게 요청하고 기다리지 않는다. 2026-09-17 의 “데이터를 가진
  기능이 공표한다”를 대체한다.
- 두 규칙을 새로 넣었다. **선언하기 전에 재사용한다** — `PetClient` · `TokenClient` 처럼 이미 있는
  Port 는 그대로 쓰거나 `Pick` 으로 좁혀 쓴다. **아직 테이블에 없는 것은 Mock 으로 둔다** — 개발
  중인 도메인의 데이터는 Port 만 선언하고 Mock 을 넣었다가 테이블이 생기면 조립만 바꾼다.
- “쓰는 쪽은 요구사항을, 소유자는 모양을”과 “그 순간에만 존재하는 사실은 소유자에게 컬럼을
  요청한다”를 뺐다. 둘 다 담당자를 기다리게 하는 문장이었다. 뒤의 것은 Mock 규칙에 합쳤다.
- “DB 에 선언된 것을 읽는다”를 넣었다. 한 도메인의 값을 다른 도메인의 테이블에서 추정하지 않는다.
- 예시를 펫 하나에서 `meta` 가 쓰는 세 도메인(재사용 · 좁혀서 재사용 · 선언하고 Mock)으로 바꿨다.
- 계약 검사가 새 문장 셋을 요구하고 “소유 기능이 선언한다”가 돌아오면 실패한다. 2026-09-09 의
  “쓰는 쪽이 사슬을 전부 만든다” 금지 단언은 뺐다 — 이제 그 방향이 규칙이다.
- 한국어 가이드 `guides/feature-contracts-kr.html` 과 `README.md` 의 가이드 설명을 규칙에 맞췄다.
- 같은 날 `meta` 의 재화 포트를 `TokenClient` 로 합치면서 규칙과 가이드의 토큰 예시를 실제 코드
  (`TokenPort`, `TokenClient.earnedSince`)에 맞췄다. 규칙 문장은 바뀌지 않았다.

- 2026-09-17 결정으로 `rules/feature-contracts.md` 를 다시 썼다. **데이터를 가진 기능이 Port 를
  공표한다** — 인터페이스 · 구현체 · Repository 를 소유자가 만들고, 쓰는 쪽은 타입만 import 해
  주입받은 인스턴스를 호출한다. 선례는 `packages/pet-client` 다.
- 선례와 모순되던 두 문장을 함께 맞췄다. “테이블 하나에 Port 하나”는 “소유 도메인 하나에 Port
  하나”로(PetClient 는 테이블 둘을 한 Port 로 내놓는다), “`null` · `0` 을 돌려주지 않는다”는 “읽기
  실패는 던지고 `null` · `[]` · `0` 은 진짜 빈 결과”로(PetClient 는 고른 펫이 없으면 정당하게
  `null` 을 준다).
- 예시를 재화 사슬에서 펫 사슬로 바꿨다. 재화는 주인이 없어 소비자가 만든 사슬이라 새 규칙의
  예시가 될 수 없다.

- 팀이 2026-09-09 에 Event 창구를 버렸다. `rules/feature-contracts.md` 를 합의된 구조
  하나로 다시 썼다 — `사용 로직 → 테이블 단위 Port → 구현체 → 영속성 레이어`, 그리고
  **사용하는 사람이 그 사슬을 전부 만든다**.
- 세 창구 표·Event 소유 절·주입 워크스루·한 방향 규칙을 걷어냈다. 쓰지 않기로 한 모델을
  "참고용"으로 남기면 곧 그것이 사실로 읽힌다.
- 계약 검사가 이제 규칙의 **내용**을 고정한다. 이전에는 파일 존재와 포인터만 봐서, 규칙이
  결정과 어긋나도 검사가 통과했다.

### Added

- friction 기록 3건(2026-09-28, ccusage 수집기 작업): Node 26·npm 12에서 Electron 바이너리 누락,
  optional dependency 네이티브 바이너리의 실행 비트 누락, 개발 DB에 남은 데모 수집기 기준점.
  모두 첫 관찰이라 규칙·Skill은 바꾸지 않고 기록만 남긴다.

- `.harness/rules/feature-contracts.md`는 feature 패키지끼리 맞닿는 면을 다스린다.
  창구는 셋(Port · Event · 주입)이고, Port는 생산자가 공표하며, **한 쌍 사이에 Port는
  한 방향만** 둔다. 2026-09-03 팀 결정을 정본으로 옮긴 것이다.
- 순환이 생겼을 때 계약을 `pet-core`로 옮기는 것을 금지한다. 순환 참조는
  `tsc --build`를 실패시키는데, 그 실패 자체가 "이 화살표 하나는 Port가 아니어야
  한다"는 신호다. core로 옮기면 빌드만 통과하고 결합은 남는다.
- `.harness/guides/feature-contracts-kr.html`은 그 규칙의 한국어 읽기판이다. 규칙을
  중복하지 않고, 정본은 계속 `rules/feature-contracts.md`다.
- 계약 검사가 규칙 문서·가이드·`AGENTS.md` 포인터·README 포인터 네 가지를 강제한다.

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
- `bg_check.py` now fails a scene that scales a stamp whose longest side is 14px
  or less by 3 or more when a higher-resolution variant of it already exists.
  Enlarging adds pixels, not form. Large sources used large are untouched — the
  defect is a 9px stamp filling a 36px slot, not a 46px one filling 184px.

### Changed

- `bg_score.py` no longer counts effect ops (`glow`, `specks`, `rays`,
  `contact_shadow`, `autoshade`, `scanshade`, `vignette`, `clearing`) as core
  elements, and its docstring example no longer teaches the pattern. Declaring
  "four contact_shadow ops" and then using four had scored full composition
  marks. `fringe` is deliberately excluded from that list: measuring all seven
  shipped backgrounds showed it is the one effect op that carries real structure.
- `bg_final.py` refuses to declare a final pass on a self-scored visual review
  unless `--unattended` is passed, and `bg_visual.py`'s form now records
  `judged_by`. A silent self-assessment had been reported as a completed
  review while the requester was available to look at the picture.

- `background-generator`'s `SKILL.md` shrank from 509 to 240 lines. Every gate
  threshold, score breakdown, visual-review item and final condition it restated
  was deleted rather than summarised: `references/quality.md` owns the
  thresholds, and `bg_check.py`, `bg_score.py` and `bg_final.py --help` each
  print their own criteria with the measured value beside them. The
  component-isolation review procedure moved to `references/visual_review.md`,
  the five reference-analysis axes to `references/reference_analysis.md`, and the
  interview's questioning rules to `references/interview.md`. Two mechanical
  guards now hold the line — a 240-line cap and a check that the Skill does not
  restate a threshold it does not own — and both were negative-tested.
- The Skill-tree comparison now names the file that differs. It previously failed
  through `set -e` with no output at all, which cost a debugging cycle.

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

### Changed

- Renamed the meta product specification to the stable, content-focused
  `specs/meta-info-settings-achievements-design.md` path and made that naming
  convention part of the harness contract.

### Added

- Approved meta product specification for information, settings, achievements,
  three-source local usage collection, and macOS/Windows acceptance criteria.
- Contract assertions for the meta specification and its implementation-facing
  requirement ID families.
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

- `bg_final.py` ran its three sub-checks as `python3` instead of the interpreter
  running it, so under the project virtualenv every sub-check failed with
  "Pillow is required" and the command could not complete in this repository.

- `bg_interview.py next` crashed with `UnboundLocalError` whenever ambiguity
  exceeded the threshold — exactly the case the command exists for — because the
  blocking-slot lookup sat inside the low-ambiguity branch. The same control flow
  also told the caller to start drawing when a blocking slot was empty. The
  lookup is now unconditional, and an AST assertion in the Skill verification
  keeps it that way. Found by running every command the Skill quotes.

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
