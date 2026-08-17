# 공유 하네스 빠른 시작

## 결론

일반 기능 작업은 `$work`를, 공유 하네스의 규칙·Skill·역할·검증을 바꾸는
작업은 `$harness-improve`를 사용한다. 새 기능의 요구가 불명확하거나 승인된
기능 기획서가 없으면, 구현 전에 조건부 Specifier 절차로 기획서를 승인받는다.

Claude Code와 Codex는 같은 `AGENTS.md`와 같은 검증 명령을 사용한다. Claude
Code는 `CLAUDE.md`를 통해 `AGENTS.md`를 읽고, Codex는 `.agents/skills/`의
어댑터를 통해 `.claude/skills/`의 정본 Skill을 발견한다. 두 환경 모두에서
`$work` 또는 `$harness-improve`를 호출한 뒤 아래 절차와 명령을 따른다.

## 기능 기획서가 필요한 경우

다음 중 하나이면 standard track을 선택하고, 이미 승인된 기능 기획서가 있는지
먼저 확인한다.

- 새롭거나 변경되는 사용자 가시 행동
- 도메인 규칙
- 공개 인터페이스
- 영속 형식
- 승인된 기획서가 없는 모호한 기능 요청

승인된 기획서가 있으면 그것을 Seed로 사용한다. 없거나 모호하면 Specifier가
`.harness/specs/features/YYYY-MM-DD-<feature-name>.md`에 `Draft`를 만들고,
요청자 승인 후에만 `Approved`로 바꾼다. 승인 전에는 이후 역할 흐름을 시작하지
않는다.

## 역할 흐름

Specifier는 위 조건에서만 앞에 붙는 준비 역할이다. 승인된 Seed가 준비된 뒤의
다섯 핵심 역할 순서는 항상 다음과 같다.

```text
Explorer → Planner → Implementer → Verifier → Reviewer
```

각 역할의 결과와 남은 공백을 기록한다. 특히 Verifier와 Reviewer의 검토 결과를
생략하지 않는다.

## 검증

저장소 루트에서 하네스 변경 여부와 관계없이 다음 계약 검증을 실행한다.

```bash
bash .harness/tests/verify-contract.sh
```

Rust 작업이면 같은 루트에서 Rust 완료 게이트도 실행한다.

```bash
bash .harness/scripts/verify-rust.sh
```

이 브랜치는 `Cargo.toml`과 `Cargo.lock`을 추적하지 않는다. 따라서 Rust 게이트는
기존 manifest가 별도로 준비된 경우에만 실행할 수 있으며, 하네스 작업 중 그
파일들을 추가·수정·stage하지 않는다.

## 완료 보고

완료라고 보고하려면 선택한 track, 성공 기준과 non-goal, 변경 파일, focused
evidence, 각 적용 검증 명령의 새 출력, diff 검토 결과, 그리고 남은 공백을
기록한다. standard track은 승인된 Seed 경로, 다섯 역할의 결과, Mechanical·Semantic·
Independent Review 결과와 Evolve 처분도 포함한다.

하네스 변경은 추가로 Evidence, 승인 경계, RED 출력, GREEN 출력, 계약 검증,
`CHANGELOG.md` 갱신을 기록한다. 하나라도 막혔거나 실패했으면 완료로 표현하지
않고 그 사실과 다음 조치를 보고한다.
