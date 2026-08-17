# 공유 하네스 빠른 시작

## 결론

일반 기능 작업은 `work`를, 공유 하네스의 규칙·Skill·역할·검증을 바꾸는
작업은 `harness-improve`를 사용한다. 어떤 절차와 검사가 필요한지는
`AGENTS.md`와 각 정본 계약이 결정한다. 이 문서는 그 계약으로 들어가는 빠른
경로이며, 별도의 절차 정본이 아니다.

Claude Code와 Codex는 같은 `AGENTS.md`와 같은 검증 명령을 사용한다. Claude
Code는 `CLAUDE.md`를 통해 `AGENTS.md`를 읽고, Codex는 `.agents/skills/`의
어댑터를 통해 `.claude/skills/`의 정본 Skill을 발견한다. 호출 문법은 다르다.
Claude Code에서는 `/work`와 `/harness-improve`를 직접 호출한다.
Codex에서는 `$work`와 `$harness-improve`로 Skill을 언급한다. 근거는
[Claude Code Skill 호출 문서](https://code.claude.com/docs/en/slash-commands)와
[Codex Skill 문서](https://developers.openai.com/codex/skills)다.

## 기능 기획서가 필요한 경우

조건은 두 단계다. 먼저 정본 trigger 중 하나가 요청에 적용되는지
[정본 `work` Entry](../../.claude/skills/work/SKILL.md)에서 판단해 standard를
선택한다. 그다음 승인된 기획서를 확인하고, 없거나 모호한 경우에만 Specifier를
실행한다. 이미 `Approved`인 기획서는 Seed로 사용한다. 기획서가 없거나 모호하면
[Specifier 계약](../roles/specifier.md)의 `Draft`→요청자 승인→`Approved` 절차를
따른다. 정본 trigger가 적용되지 않은 모든 요청까지 기획서 부재만으로 이 gate를
넓히지 않는다. 기획서의 정본 위치와 파일명은
[기능 기획서 README](../specs/features/README.md)에 있다.

## 역할 흐름

Specifier는 정본 `work`가 요구하는 경우에만 앞에 붙는다. 승인된 Seed 뒤의
다섯 핵심 역할 흐름은 [정본 `work` standard track](../../.claude/skills/work/SKILL.md)이
소유한다.

```text
Explorer → Planner → Implementer → Verifier → Reviewer
```

각 역할의 구체적 완료 조건은 링크된 정본 계약에서 확인한다.

## 검증

`AGENTS.md`와 정본 `work`가 정한 **적용 가능한 검사**를 선택하고, 최종 변경 뒤의
새 출력을 보관한다. 일반 작업에 계약 검증을 일괄 강제하지 않는다.

공유 하네스 변경에는 정본 `harness-improve`가 RED/GREEN 뒤 계약 검증을 요구한다.
그 경우 저장소 루트에서 다음을 실행한다.

```bash
bash .harness/tests/verify-contract.sh
```

Rust 작업이면 정본 [Rust 규칙](../rules/rust.md)이 요구하는 완료 게이트도 실행한다.

```bash
bash .harness/scripts/verify-rust.sh
```

이 브랜치는 `Cargo.toml`과 `Cargo.lock`을 추적하지 않는다. 따라서 Rust 게이트는
기존 manifest가 별도로 준비된 경우에만 실행할 수 있으며, 하네스 작업 중 그
파일들을 추가·수정·stage하지 않는다.

## 완료 보고

완료 보고의 필드와 track별 조건은 [정본 `work` completion](../../.claude/skills/work/SKILL.md)이
소유한다. 공유 하네스 변경의 Evidence·승인·RED/GREEN·CHANGELOG 기록은
[`harness-improve`](../../.claude/skills/harness-improve/SKILL.md)와
`.harness/friction/README.md`를 따른다. 필요한 검사가 막히거나 실패하면
`AGENTS.md`의 Completion 규칙에 따라 blocker를 보고한다.
