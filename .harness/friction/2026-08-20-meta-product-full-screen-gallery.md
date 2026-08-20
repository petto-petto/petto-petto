# Meta product full screen gallery evidence record

## Evidence

- Exact request: `PRODUCT SCREENS`가 패널 비율 때문에 일부 기능만 보여주므로 이미지 수가 늘어나더라도 다른 기능까지 모두 보이게 한다.
- Affected canonical files: `.harness/guides/meta-product-overview.html`, `.harness/tests/verify-contract.sh`, `.harness/CHANGELOG.md`.
- Baseline: the guide contained three 400 × 462 examples. They showed information summary, parts of collection and display settings, and part of the achievement list.
- Missing visible functions included trainer-name editing, usage filters and full model expansion, records and the coin ledger, all four settings tabs and collection states, all notification bubbles, titles, and trophy reward handling.

## Root cause

The three-panel completion criterion proved only that each product area had a representative image. It did not require every planned tab and materially different UI state to have a visible example.

## Pruning

- `.harness/specs/meta-info-settings-achievements-design.md` remains the single source of product behavior and defaults.
- The gallery shows all normal functions and only states whose UI is materially different; it does not illustrate invisible backend processing or repeat the complete product specification.
- Existing partial examples are replaced rather than retained beside the expanded gallery.
- The page remains a self-contained static HTML document with no scripts or external assets.

## Approval

The user approved the recommended boundary: include every normal function and add loading, empty, error, and unavailable states only when they materially change the screen. The approved gallery contains six information, seven settings, and four achievements examples.

## RED

The focused contract was changed to require all 17 accessible screen labels and an exact total of 17 examples. Before implementation, `bash .harness/tests/verify-contract.sh` returned exit one with 18 failures:

```text
FAIL: meta product overview is missing required page structure: aria-label="정보 요약 화면 예시"
...
FAIL: meta product overview is missing required page structure: aria-label="업적 보상 화면 예시"
FAIL: meta product overview must contain exactly 17 screen examples, found: 3
Contract verification failed: 18 assertion(s).
```

## GREEN

Replacing the three partial panels with the approved 17-panel gallery made the same command return exit zero:

```text
Work Skill verification passed.
Harness-improve Skill verification passed.
Contract verification passed.
```

## Contract verification

The contract requires each named example, exactly 17 accessible screen groups, the preview before the explanatory area cards, self-contained assets, and resolving local links. The first post-implementation contract run returned exit zero.

## CHANGELOG.md

`.harness/CHANGELOG.md` records the expansion from three partial examples to the complete 17-panel gallery.

## Completion

- macOS Quick Look generated an 1800-pixel render showing the section header, group count, first information row, and three-column alignment without visible clipping in the rendered region.
- The existing narrow-screen rule stacks every gallery grid into one column and limits panels to 460 pixels.
- Remaining evidence boundary: no controllable browser was available, so full-page scrolling, browser-console, and real mobile-viewport checks were unavailable. The page contains no JavaScript or external assets.
