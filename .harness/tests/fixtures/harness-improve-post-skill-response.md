## Read evidence

`.harness/references/writing-great-skills/SKILL.md`를 읽은 뒤 `.harness/references/writing-great-skills/GLOSSARY.md`를 읽었습니다.

## Evidence

요청은 “팀원이 반복해서 검증 명령을 빠뜨려서 하네스를 개선하고 싶다.”입니다. 현재 Rust 검증 명령의 단일 원본은 `.harness/rules/rust.md`이고, `.claude/skills/work/SKILL.md`는 모든 적용 가능한 Mechanical 검증의 fresh output을 완료 조건으로 둡니다. 방금 `bash .harness/tests/verify-harness-improve-skill.sh`를 실행한 결과, post-Skill fixture에 요구된 12개 응답 기록 표식이 없어 실패했습니다.

다만 이 실패는 하네스 fixture가 현재 계약과 어긋났다는 증거이며, 팀원이 어떤 검증 명령을 얼마나 자주 빠뜨렸는지는 아직 증명하지 않습니다. 누락된 정확한 명령, 발생 횟수, PR/CI 기록, 적용 대상 변경 유형이 필요합니다.

## Root cause

원래 보고된 문제의 원인은 아직 분류할 수 없습니다. 기존 Rust 규칙과 work Skill에는 검증 지침과 완료 게이트가 이미 있으므로 “지침 부재”라고 단정할 근거는 없습니다. 현재 확인된 별도 원인은 stale fixture/contract drift입니다. post-Skill fixture가 필수 응답 기록 형식과 맞지 않아 행동 검증이 RED입니다.

## Pruning and smallest change

검증 명령의 canonical owner는 `.harness/rules/rust.md`, 작업 흐름의 owner는 `.claude/skills/work/SKILL.md`, 하네스 개선 절차의 owner는 `.claude/skills/harness-improve/SKILL.md`입니다. 따라서 같은 명령 목록을 새 문서에 중복하지 않습니다.

증거 수집 후에도 실제 누락이 확인되면, 기존 단일 repo-owned verification entrypoint와 canonical owner를 유지하는 최소 변경만 제안하겠습니다. 현재 확인된 계약 불일치에 한해서는 post-Skill fixture를 현재 응답 기록 계약에 맞추는 것이 최소 변경 후보입니다.

## User approval

공유 하네스 변경에 대한 명시적 승인은 아직 없습니다. 따라서 하네스 파일을 변경하지 않았습니다.

## RED

승인 범위가 정해지면, 변경할 동작을 검증하는 계약을 먼저 RED로 기록합니다. 현재 `bash .harness/tests/verify-harness-improve-skill.sh`는 fixture의 12개 누락 표식 때문에 이미 실패하며, 이는 fixture-계약 불일치의 재현 가능한 baseline입니다.

## GREEN

승인된 최소 변경 후 같은 행동 검증을 다시 실행해 GREEN 결과를 기록합니다. 원래 검증 명령 누락 문제를 해결하는 변경이라면, 누락 사례가 재현될 때 실패하고 단일 진입점을 사용하면 통과하는 검사여야 합니다.

## Contract verification

GREEN 이후 `bash .harness/tests/verify-contract.sh`를 실행해 shared-harness 계약 전체 결과를 fresh output으로 기록합니다.

## CHANGELOG update

계약 검증이 통과한 승인된 변경만 `.harness/CHANGELOG.md`에 canonical 변경 파일과 함께 기록합니다.

## Observable completion

완료는 누락 명령의 실제 증거, 확정된 원인, pruning 결과, 사용자 승인, RED/GREEN 결과, contract verification, CHANGELOG 기록, 남은 예외 또는 차단 요인이 모두 남았을 때만 주장할 수 있습니다.
