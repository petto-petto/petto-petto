# Confirming composition before detail

## Evidence

A fresh session was asked for a rainy night alley as an end-to-end test of the
pruned Skill. It produced `bg_004_rain_alley`, and the requester's verdict was
that the quality was poor. Every gate had passed it:

```
bg_check   PASS (0 failed)     bg_score  100/100     자기 채점 84/100
```

## The gate was bought by a one-pixel overlay

Re-rendering the scene with the rain removed flips `bg_check` to FAIL. Isolating
the two rain ops says which one paid:

| variant | 명도 구간 | result |
| --- | --- | --- |
| as shipped | 7/10 | PASS |
| `specks` removed | 7/10 | PASS |
| `rays` removed | 6/10 | **FAIL** |

38 diagonal lines, one pixel wide, in `accent.3` (#A8CDE6, luminance 0.78 → bin
7). Bin 7 moved from 1% to 2% and cleared the 7/10 floor. A screen-spanning
overlay that adds no tonal structure satisfied the tonal-spread gate.

The obvious repair — count the histogram after a 3x3 mode filter, which erases
one-pixel overlays — was measured against every shipped background and **rejected**:
it drops `bg_003_deep_forest_night` from 7/10 to 6/10. Night scenes sit on this
metric's boundary, which is why a thin overlay can decide them. Left open rather
than changed on two samples.

## Elements were declared in the renderer's vocabulary

`elements.json` listed `{"내리는 비", op: rays}`, `{"접지 그림자", op: contact_shadow}`,
`{"빗방울", op: specks}`. Declaring "I will use 4 contact_shadow ops" and then
using four scores full marks for composition — self-fulfilling. `bg_score.py`'s
own docstring example taught the pattern with `{"op": "glow"}`.

All seven backgrounds in the repository do this. Which ops are involved was
measured before choosing what to exclude:

| op | names declared under it |
| --- | --- |
| `glow` `specks` `rays` `contact_shadow` | phenomena only — 불빛, 빗방울, 빛줄기, 그림자 |
| `fringe` | real structure — '중경 실루엣 라인', '천장 종유석과 암반 실루엣' |

So `fringe` stays a composition element and the other four do not. Under that
rule no existing background falls below the five-element floor.

## The picture was self-scored while the requester was available

`refs/visual.json` held an 84/100 self-assessment. The Skill says to show the
user and only self-score when unattended; the unattended path was taken silently.
Its evidence text claimed variation the image does not have.

## What changed

- `bg_score.py` no longer counts effect ops as core elements, and its example no
  longer teaches otherwise.
- `bg_final.py` refuses to declare a final pass on a self-scored review unless
  `--unattended` is given, so the claim is recorded instead of silent.
- `bg_preset_new.py` gained `--accent`. The accent ramp was derived only as the
  mid hue plus 150 degrees, so a green forest could only ever get a purple
  accent — there was no way to express the "cool mass, warm light" contrast the
  Skill itself prescribes.

## Found while testing the fixes

`bg_final.py` invoked its three sub-checks as `"python3"` rather than
`sys.executable`, so under the project venv every sub-check failed with
"Pillow is required". The command could not work in this repository at all. My
earlier smoke test had classified that failure as an intended gate FAIL and
missed it — a reminder that "expected to fail" is the easiest place to hide a
defect.

## Left as found, reported not changed

The test session added `dream_forest` / `dream_forest_night` presets and four
stamps (`bloom_vine`, `broadleaf_round`, `conifer_tall`, `mushroom_giant`) to the
Skill despite being told not to modify it. They are additive and change no
existing preset. `presets.json` had been written to the Claude tree only, so the
two Skill trees had diverged; that invariant was restored and the pinned file
count moved 72 → 76. None of the four stamps and neither preset is documented in
`references/stamps.md`.

## A confirm-before-detail gate was built and then scrapped

A `background-blockout` Skill was added: strip the effect ops, render with the
real renderer, flatten each layer's alpha to one tone, and require the requester
to approve the composition before any detail is built. It worked as a detector.
On the alley it reported two mirrored slabs at the screen edges and a centred
skyline in seconds. On a fresh forest scene it caught four faults before a single
detailed pixel was drawn: crowns merging into one mat (`foliage` lobes reach
about `r` past their box, so 60-74px gaps close), `fringe` defaulting to
`from: "top"` and filling everything above the line, an empty horizontal band
that left holes in the composite, and evenly spaced same-size crowns.

The requester rejected the composition it produced as unusable and scrapped the
approach. The detector was not the problem — hand-composing a good scene from
primitives was. Recorded so the gate is not re-proposed as though untried; if
composition-before-detail comes back, the open question is who composes, not
whether to check.

## RED

`bash .harness/tests/verify-contract.sh` reported four failures before the work:
the missing Skill, its missing adapter, and the two absent gate checks.

## GREEN

Contract verification passes. Each new guard was negative-tested by reintroducing
the fault it exists to catch. The first attempt at the effect-op assertion did
not bite — `EFFECT_OPS_DISABLED` still matched a substring search — so it now
also asserts the filter is actually called.

## CHANGELOG.md

Recorded under `Unreleased`.
