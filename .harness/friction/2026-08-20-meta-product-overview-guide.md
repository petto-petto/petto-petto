# Meta product overview guide evidence record

## Evidence

- Exact request: 팀원들에게 정보, 설정, 업적 상세 기획을 간략히 설명할 수 있는 화면 페이지를 현재 PR에 추가한다.
- Affected canonical files: `.harness/guides/meta-product-overview.html`, `.harness/README.md`, `.harness/tests/verify-contract.sh`, `.harness/CHANGELOG.md`.
- Baseline: the harness contained HTML guides for quick start and concept application, but no team-facing visual entrypoint for the approved meta product specification.
- Reproduction: `test -f .harness/guides/meta-product-overview.html` exited non-zero before the change.

## Root cause

The cause was an absent presentation layer between the 602-line canonical product specification and a short team briefing. It was not missing product behavior: the approved specification already owned the detailed rules.

## Pruning

- Canonical owner: `.harness/specs/meta-info-settings-achievements-design.md` remains the single source of product behavior.
- The HTML page summarizes the three areas, local data flow, achievement shape, MVP boundary, and handoff; it links to the specification instead of copying its complete tables and acceptance criteria.
- The page uses inline CSS and no external scripts, stylesheets, fonts, or images.
- The approved boundary does not add app UI, product decisions, or runtime behavior.

## Approval

The user approved one static HTML briefing page with three area cards, the collection-to-notification flow, the 22-achievement summary, MVP include/exclude boundaries, the canonical specification link, responsive layout, and accessibility support.

## RED

The first `bash .harness/tests/verify-contract.sh` run after extending the contract returned exit one with eleven failures: the page, README pointer, and required structure were absent.

After implementation, a local-link resolver was added and produced a second focused RED:

```text
FAIL: broken local HTML link in .harness/guides/meta-product-overview.html: ../../README.md
Contract verification failed: 1 assertion(s).
```

## GREEN

Changing the brand link to the canonical `.harness/README.md` relative path made the same command return exit zero:

```text
Work Skill verification passed.
Harness-improve Skill verification passed.
Contract verification passed.
```

## Contract verification

The contract requires the HTML file, README entrypoint, Korean document language, semantic main and section anchors, canonical specification link, self-contained assets, and resolving local links. The final contract run returned exit zero.

## CHANGELOG.md

`.harness/CHANGELOG.md` records the Korean one-page product overview. `.harness/README.md` links the new page beside the existing HTML-only guides.

## Completion

- HTML Tidy was not accepted as HTML5 evidence because the installed Apple build is from 2006 and rejects standard HTML5 semantic elements.
- Local targets resolve and duplicate HTML ID count is zero.
- macOS Quick Look generated desktop and reduced-size pixel renders without visible clipping in the rendered region.
- Remaining evidence boundary: no controllable browser was connected, so interactive browser-console and real mobile-viewport checks were unavailable; responsive CSS was inspected statically.
