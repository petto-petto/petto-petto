# 공유 하네스의 개념 적용과 경계

## 결론

이 저장소는 writing-great-skills의 저작 원칙과 Ouroboros의 개념을 공유
하네스에 적용한다. 실행되는 것은 저장소의 Markdown 지침과 쉘 검증뿐이다.

## writing-great-skills: 이전과 이후

| 이전에 피해야 할 상태 | 현재 적용 | 확인 근거 |
| --- | --- | --- |
| 같은 지침이 런타임별로 복제되어 서로 달라질 수 있음 | 정본 Skill은 `.claude/skills/`에 두고 Codex는 `.agents/skills/` 어댑터로 같은 디렉터리를 사용 | `verify-contract.sh`의 어댑터 대상 검사 |
| 지침을 근거 없이 추가하거나 오래된 설명을 남김 | `.harness/rules/skill-authoring.md`와 `$harness-improve`가 embedded reference 읽기, Evidence, pruning, RED/GREEN, CHANGELOG를 요구 | 규칙과 Skill의 정적 계약 검사 |
| 한 문서에 모든 설명을 중복해 놓음 | 공통 지침은 `AGENTS.md`, 역할 계약은 `.harness/roles/`, 상세 배경은 이 가이드처럼 분리 | 정본 경로와 링크를 사람이 검토하고 계약으로 구조를 검사 |

여기서 채택한 것은 예측 가능한 과정, 정본 위치와 progressive disclosure,
duplication·sediment·no-op 제거, 그리고 관찰 가능한 완료 기준이다.
`.harness/references/writing-great-skills/SKILL.md`는 이 원칙을 설명하므로,
하네스 문서나 Skill을 바꿀 때 지침을 정본에 두고 상세 내용은 링크로 공개하는
행동을 이끈다. `.harness/references/writing-great-skills/GLOSSARY.md`는 그
용어의 판정 기준을 제공하므로, 검토에서 duplication·sediment·no-op을 구분하고
`$harness-improve`의 pruning으로 최소 변경을 고르는 행동을 이끈다. 두 파일은
읽기 위한 embedded reference이며 수정 대상이나 실행 엔진이 아니다.

## Ouroboros: 다섯 개념의 대응

Ouroboros 자체는 설치하거나 실행하지 않는다. 채택한 다섯 개념만 정본 흐름에
다음처럼 대응한다.

| 개념 | 정본 workflow 대응 |
| --- | --- |
| Interview | 요청의 가정·성공 기준·비목표와 미해결 결정을 명시한다. |
| Seed | 승인된 기능 기획서를 standard track의 Seed로 사용한다. |
| Execute | `Explorer → Planner → Implementer`가 탐색, 계획, 구현을 수행한다. |
| Evaluate | Verifier와 Reviewer가 `Mechanical·Semantic·Independent Review`를 순서대로 기록한다. |
| Evolve | 재사용 지식이나 반복 friction의 처리를 기록하고, 개선이 필요하면 공용 `harness-improve` Skill로 Evidence→RED→GREEN→계약 검증을 수행한다. |

즉 이 대응은 개념 적용일 뿐, 프로세스가 스스로 모델을 호출하거나 저장소를 자동
변경한다는 뜻이 아니다.

## Claude Code와 Codex의 공유 방식

- `CLAUDE.md`는 `AGENTS.md`만 import한다.
- Claude Code의 정본 Skill은 `.claude/skills/work/`와
  `.claude/skills/harness-improve/`에 있다.
- Codex의 `.agents/skills/work`와 `.agents/skills/harness-improve`는 그 정본을
  가리키는 상대 어댑터다.
- 역할, 규칙, reference, 계약 검증은 `.harness/`에서 함께 관리한다.

이는 두 런타임에 같은 문구를 복사하는 방식이 아니라, 한 정본과 얇은 어댑터를
공유하는 방식이다.

## 증거의 경계

`bash .harness/tests/verify-contract.sh`는 파일 존재, 참조 문자열, 어댑터 대상,
검증 스크립트 형태, 그리고 보존된 scenario artifact를 검사한다. 이는 구조와
기록된 계약의 증거이지, 매번 모델을 호출하거나 모든 프롬프트에서 보편적으로
같은 행동을 보장하는 증거는 아니다. fixture는 보존된 출력이며 live agent
invocation은 결정적 계약 검증에 포함되지 않는다.

Rust 검증은 또 다른 경계다. `.harness/scripts/verify-rust.sh`는 manifest가 실제로
준비된 경우에만 Cargo 명령을 실행한다. 이 하네스 브랜치가 manifest를 추적하지
않는 사실은 Rust 동작 자체를 이 문서나 계약만으로 증명할 수 없다는 뜻이다.
