# Meta product screen examples evidence record

## Evidence

- Exact request: 팀원용 상세 기획 요약 페이지 맨 위에 기획대로 구현된 간단한 화면 예시를 추가한다.
- Affected canonical files: `.harness/guides/meta-product-overview.html`, `.harness/tests/verify-contract.sh`, `.harness/CHANGELOG.md`.
- Baseline: the overview explained the approved information, settings, and achievements behavior, but teammates had to infer the resulting UI from prose and diagrams.
- Reproduction: after adding the required contract markers but before changing the guide, `bash .harness/tests/verify-contract.sh` exited non-zero with four missing screen-preview assertions.

## Root cause

The overview lacked a compact visual bridge between the product rules and the planned desktop UI. This was a presentation gap, not a missing product decision or application implementation.

## Pruning

- The three mock screens summarize only behavior already approved in `.harness/specs/meta-info-settings-achievements-design.md`.
- The screen examples are static HTML and CSS with no scripts, external assets, or new runtime behavior.
- A visible disclaimer states that pixel art, spacing, animation, and copy can change during implementation.
- The existing detailed sections and canonical specification remain the owners of explanation and product rules.

## Approval

The user approved a `제품 화면 미리보기` section directly below the hero, with equal information, settings, and achievements panels on desktop and a vertical stack on narrow screens.

## RED

The focused contract extension required the preview section and its three accessible panel labels. Before implementation, `bash .harness/tests/verify-contract.sh` returned exit one with these four failures:

```text
FAIL: missing required marker in meta product overview: id="screen-preview"
FAIL: missing required marker in meta product overview: aria-label="정보 화면 예시"
FAIL: missing required marker in meta product overview: aria-label="설정 화면 예시"
FAIL: missing required marker in meta product overview: aria-label="업적 화면 예시"
Contract verification failed: 4 assertion(s).
```

## GREEN

Adding the approved three-panel preview immediately after the hero made the same command return exit zero:

```text
Work Skill verification passed.
Harness-improve Skill verification passed.
Contract verification passed.
```

## Contract verification

The contract requires the preview anchor before the detailed `areas` section and accessible labels for all three screen examples. The final contract run returned exit zero.

## CHANGELOG.md

`.harness/CHANGELOG.md` records the new information, settings, and achievements screen examples.

## Completion

- macOS Quick Look generated a 1440-pixel desktop render showing the hero followed by three aligned screen panels without visible clipping in the rendered region.
- The narrow-screen rule changes the preview grid to one column and limits each mock screen to 460 pixels.
- Remaining evidence boundary: no controllable browser was connected, so interactive browser-console and real mobile-viewport checks were unavailable; the page has no JavaScript or external assets.
