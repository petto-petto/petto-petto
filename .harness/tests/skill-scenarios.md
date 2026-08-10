# Work Skill Scenarios

## Baseline — RED

Request: `Rust 프로젝트에 pet 상태를 한 단계 증가시키는 작은 기능을 추가해줘.`

The baseline response is retained outside this scenario record and is not
rewritten here. The SDD ledger records these observed results:

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
Evolve.

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

The behavior probe changed from exit `1` before the Skill existed to exit `0`
afterward: it found Interview/Seed, Mechanical, Semantic, Independent Review,
and Evolve in the canonical Skill.
