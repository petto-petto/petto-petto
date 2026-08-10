# Work Skill Scenarios

## Baseline — RED

Request: `Rust 프로젝트에 pet 상태를 한 단계 증가시키는 작은 기능을 추가해줘.`

The unmodified baseline response is preserved in
[`fixtures/work-baseline-response.md`](fixtures/work-baseline-response.md).
The SDD ledger records these observed results:

| Requirement | Result | Evidence |
| --- | --- | --- |
| Requirement clarification | Present | Baseline result in `progress.md` |
| Test-first implementation | Present | Baseline result in `progress.md` |
| Rust checks | Present | Baseline result in `progress.md` |
| Evidence-based completion | Present | Baseline result in `progress.md` |
| Explicit track selection | **Missing (RED)** | No lightweight or standard choice |
| Interview/Seed | **Missing (RED)** | No named standard-work discovery phase |
| Mechanical review | **Missing (RED)** | No named verification layer |
| Semantic review | **Missing (RED)** | No named verification layer |
| Independent Review | **Missing (RED)** | No independent review layer |
| Evolve | **Missing (RED)** | No reuse or friction recovery phase |

The missing requirements are the failing behavior evidence for the new Skill.

## Post-Skill — GREEN

Request: `Rust 프로젝트에 pet 상태를 한 단계 증가시키는 작은 기능을 추가해줘.`

A fresh, read-only agent received the request after reading the canonical
`work` Skill and all five role contracts. Its response selected `standard`,
included Interview/Seed, named Explorer, Planner, Implementer, Verifier, and
Reviewer, named Mechanical, Semantic, and Independent Review, and included
Evolve. Its unmodified response is preserved in
[`fixtures/work-post-skill-response.md`](fixtures/work-post-skill-response.md).

| Requirement | Result | Evidence from the fresh response |
| --- | --- | --- |
| Explicit track selection | Pass | `standard` selected for new Rust behavior |
| Interview/Seed | Pass | Goal, success criteria, assumptions, non-goals, and open questions listed |
| Explorer, Planner, Implementer, Verifier, Reviewer | Pass | All five contracts named in execution order |
| Mechanical review | Pass | Fresh formatter, build, lint, and test output required |
| Semantic review | Pass | Actual behavior compared to success criteria |
| Independent Review | Pass | Separate Reviewer required |
| Evolve | Pass | Lesson, friction, or `none` recorded |
| Completion without fresh output | Refused | It states that no completion claim is possible until fresh command output and all review results exist |

## Reproducible behavior check

The executable probe is:

```bash
bash .harness/tests/verify-work-skill.sh
```

RED, before the fixtures and corrected tracks existed:

```text
$ bash .harness/tests/verify-work-skill.sh
FAIL: missing file: .harness/tests/fixtures/work-baseline-response.md
FAIL: missing file: .harness/tests/fixtures/work-post-skill-response.md
FAIL: lightweight track must begin with scope confirmation
FAIL: lightweight track must require minimal implementation
FAIL: lightweight track must require Mechanical verification
FAIL: lightweight track must end with diff review
FAIL: lightweight track must not require standard-work phase: Explorer contract
FAIL: lightweight track must not require standard-work phase: Planner
FAIL: lightweight track must not require standard-work phase: Implementer
FAIL: lightweight track must not require standard-work phase: Verifier
FAIL: lightweight track must not require standard-work phase: Reviewer
FAIL: lightweight track must not require standard-work phase: Semantic
FAIL: lightweight track must not require standard-work phase: Independent Review
FAIL: lightweight track must not require standard-work phase: Evolve
FAIL: review definitions must live in role contracts, not the work Skill
FAIL: scenario record must point to the baseline fixture
FAIL: scenario record must point to the post-Skill fixture
FAIL: scenario record must contain the behavior-check command
Work Skill verification failed: 18 assertion(s).
```

GREEN, after the minimal Skill, fixture, and scenario changes:

```text
$ bash .harness/tests/verify-work-skill.sh
Work Skill verification passed.
```

## Harness-improve baseline — RED

Request: `팀원이 반복해서 검증 명령을 빠뜨려서 하네스를 개선하고 싶다.`

The unmodified baseline response is preserved in
[`fixtures/harness-improve-baseline-response.md`](fixtures/harness-improve-baseline-response.md).

| Requirement | Result | Evidence |
| --- | --- | --- |
| Evidence collection | Present | It lists the missing-command evidence to obtain before changing rules. |
| Single repository-owned verification entrypoint | Present | It proposes one repo-owned entrypoint used by people, instructions, and CI. |
| Intentional failures | Present | It requires formatting, compilation, lint, and test failures to prove non-zero behavior. |
| Completion criteria | Present | It makes clean-clone execution, documented exceptions, and observed failures required. |
| Read both embedded writing references | **Missing (RED)** | Neither embedded writing reference is required. |
| Explicit pruning review | **Missing (RED)** | It does not require a single-source, duplication, sediment, or no-op review before adding guidance. |
| Skill RED-GREEN verification | **Missing (RED)** | It proposes entrypoint failures, not a failing-and-passing Skill behavior check. |
| CHANGELOG update | **Missing (RED)** | It does not require recording the harness change in `CHANGELOG.md`. |

## Harness-improve post-Skill — GREEN

Request: `팀원이 반복해서 검증 명령을 빠뜨려서 하네스를 개선하고 싶다.`

A fresh, read-only agent received the request after reading the canonical
`harness-improve` Skill. Its unmodified response is preserved in
[`fixtures/harness-improve-post-skill-response.md`](fixtures/harness-improve-post-skill-response.md).
It must preserve the single repository-owned verification entrypoint and refuse
to change the harness without evidence and user approval.

## Reproducible behavior check

The executable probe is:

```bash
bash .harness/tests/verify-harness-improve-skill.sh
```

RED, before the harness-improve Skill, friction record, fixtures, scenario
record, contract integration, and CHANGELOG entry existed:

```text
$ bash .harness/tests/verify-harness-improve-skill.sh
Harness-improve Skill verification failed: 46 assertion(s).
```

GREEN, after the minimal Skill and evidence records exist:

```text
$ bash .harness/tests/verify-harness-improve-skill.sh
Harness-improve Skill verification passed.
```
