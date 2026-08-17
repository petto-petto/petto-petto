# 공유 하네스의 개념 적용과 경계

## 결론

이 저장소는 writing-great-skills의 저작 원칙과 Ouroboros의 개선 루프라는
**개념**을 공유 하네스에 적용한다. 그러나 writing-great-skills나 Ouroboros라는
별도 런타임, 패키지, 플러그인, 데몬, 훅, 자동 에이전트를 설치하거나 실행하지는
않는다. 실행되는 것은 저장소의 Markdown 지침과 쉘 검증뿐이다.

## writing-great-skills: 이전과 이후

| 이전에 피해야 할 상태 | 현재 적용 | 확인 근거 |
| --- | --- | --- |
| 같은 지침이 런타임별로 복제되어 서로 달라질 수 있음 | 정본 Skill은 `.claude/skills/`에 두고 Codex는 `.agents/skills/` 어댑터로 같은 디렉터리를 사용 | `verify-contract.sh`의 어댑터 대상 검사 |
| 지침을 근거 없이 추가하거나 오래된 설명을 남김 | `.harness/rules/skill-authoring.md`와 `$harness-improve`가 embedded reference 읽기, Evidence, pruning, RED/GREEN, CHANGELOG를 요구 | 규칙과 Skill의 정적 계약 검사 |
| 한 문서에 모든 설명을 중복해 놓음 | 공통 지침은 `AGENTS.md`, 역할 계약은 `.harness/roles/`, 상세 배경은 이 가이드처럼 분리 | 정본 경로와 링크를 사람이 검토하고 계약으로 구조를 검사 |

여기서 채택한 것은 예측 가능한 과정, 정본 위치, progressive disclosure,
duplication·sediment·no-op 제거, 그리고 관찰 가능한 완료 기준이다.
`.harness/references/writing-great-skills/`는 그 원칙을 읽기 위한 embedded
reference이며 수정 대상이나 실행 엔진이 아니다.

## Ouroboros: 이전과 이후

Ouroboros에서 가져온 것은 결과를 다시 근거로 삼아 다음 개선을 좁히는 순환의
발상이다. 이 저장소의 실제 순환은 다음처럼 관찰된다.

```text
반복 friction 또는 요청
  → Evidence와 baseline
  → 원인 분류·pruning·승인
  → 실행 계약 RED
  → 최소 정본 변경
  → 같은 계약 GREEN
  → verify-contract 및 CHANGELOG 기록
```

| 이전에 피해야 할 상태 | 현재 적용 | 설치 여부 |
| --- | --- | --- |
| 관찰 없는 규칙 추가 | `$harness-improve`의 Evidence와 baseline 요구 | 별도 Ouroboros 런타임 없음 |
| 개선 결과를 재현할 수 없음 | RED/GREEN 출력과 `verify-contract.sh` 기록 | 자동 반복 실행기 없음 |
| 해결책을 여러 위치에 복제 | 정본을 고치고 어댑터는 포인터로 유지 | 자동 코드 생성기 없음 |

따라서 "Ouroboros를 도입했다"는 말은 위의 evidence-driven 개선 흐름을 뜻할 뿐,
프로세스가 스스로 모델을 호출하거나 저장소를 자동 변경한다는 뜻이 아니다.

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
