# Shared Electron Harness Design

## 목적

`ai-pet-design`의 하네스 개념만 `tamagochi-pet`으로 옮기고, Claude Code와 Codex가 동일한 규칙과 Skill 본문을 사용하게 한다. 프로젝트 산출물과 이전 언어·도메인 전용 문서는 옮기지 않는다.

## 범위

이관하는 것은 `/work`, `/harness-improve`, 역할 분리, 변경 유형별 검증, friction 기반 개선 루프다. Ouroboros는 설치하거나 실행하지 않고 다음 개념만 차용한다.

- 표준 작업 전 Interview/Seed로 요구사항과 성공 조건을 명확히 한다.
- 구현 뒤 Mechanical, Semantic, Independent Review를 서로 다른 증거로 수행한다.
- 반복 마찰을 모아 규칙·Skill·검증 절차의 개선 후보로 승격한다.

이관하지 않는 것은 이전 제품의 기획서, 도메인 소유권, TypeScript/Electron 규칙, 에셋 목록, mockup과 Ouroboros 런타임·MCP·EventStore·Ralph다.

## 단일 원본과 런타임 어댑터

- `AGENTS.md`가 두 도구에 적용되는 프로젝트 지침의 단일 원본이다.
- `CLAUDE.md`는 `@AGENTS.md`만 import하는 Claude Code 어댑터다.
- Skill 본문은 `.claude/skills/<name>/SKILL.md`가 단일 원본이다.
- `.agents/skills/<name>`은 해당 `.claude/skills/<name>`을 가리키는 상대 심볼릭 링크다.
- 공통 규칙, 역할, 검증 스크립트와 friction 기록은 `.harness/`에 둔다.
- 런타임별 자동 훅에 완료 의미를 맡기지 않는다. 두 도구 모두 Skill이 같은 검증 스크립트를 직접 실행한다.

## Electron 작업 규약

모든 TypeScript·Electron 변경은 `.harness/rules/electron.md`를 따른다. 기본 완료 게이트는 다음 순서다.

1. `npm run format:check`
2. `npm run typecheck`
3. `npm test`

규약은 prettier를 스타일의 단일 원본으로 삼고, `strict` 타입 검사를 켠 채 유지하며, "이 중 하나"를 판별 유니온으로 모델링하고 `never` 검사로 남김없이 다루기를 요구한다. 도메인 규칙을 Electron의 `main`·`preload`·렌더러 밖에 두어 창을 띄우지 않고 테스트할 수 있게 하고, 테스트가 소스를 직접 실행하는 패키지에는 지울 수 있는 TypeScript만 쓴다(`enum`·`namespace`·생성자 파라미터 프로퍼티 금지). 프로젝트에 아직 별도 Node/Electron 하한이 없으므로 임의 버전 하한은 만들지 않는다.

## Skill·문서 작성 규칙

사용자가 제공한 `writing-great-skills/SKILL.md`와 `GLOSSARY.md`를 `.harness/references/writing-great-skills/`에 원문 그대로 보관한다. Skill 또는 하네스 문서를 새로 만들거나 고칠 때는 두 파일을 먼저 끝까지 읽고 다음을 지킨다.

- 호출 조건과 leading words가 분명한 description
- 실행 순서와 확인 가능한 완료 조건
- 한 규칙은 한 곳에만 두는 single source of truth
- 필요한 시점에만 참조를 여는 progressive disclosure
- 중복·침전·불필요한 분기와 no-op 지침 제거
- 배포 전 baseline과 Skill 적용 시나리오의 RED–GREEN 비교

계약 검사는 두 참조 파일의 고정 SHA-256, 필수 경로, 어댑터 링크, stale 기술 참조와 Skill frontmatter를 검사한다.

## 작업 흐름

### 경량 트랙

명확한 버그 수정, 작은 리팩터링, 국소 문서 변경에 사용한다. 범위 확인, 최소 구현, Mechanical 검증, diff 검토로 끝낸다.

### 표준 트랙

새 기능, 공용 API, 저장 형식, 의존성 또는 하네스 변경에 사용한다.

1. Interview/Seed: 열린 질문, 가정, 성공 조건과 비목표를 확정한다.
2. Explore: 관련 코드와 기존 패턴을 찾는다.
3. Plan: 작은 검증 단위와 변경 순서를 정한다.
4. Implement: 테스트 우선으로 한 관심사씩 구현한다.
5. Mechanical: 포맷·컴파일·Clippy·테스트 결과를 수집한다.
6. Semantic: 요청의 성공 조건과 실제 동작을 대조한다.
7. Independent Review: 구현과 분리된 관점으로 회귀와 범위 이탈을 검토한다.
8. Evolve: 재사용할 지식과 반복 마찰만 회수한다.

## 이전 대비 변경

| 이전 | 이관 후 |
|---|---|
| Claude Code 전용 진입점과 Skill | `AGENTS.md` 공통 진입점과 Claude/Codex 어댑터 |
| 게임 도메인 규칙과 제품 기획 | 일반 TypeScript·Electron 규약과 npm 완료 게이트 |
| 런타임별 Stop 훅에 완료 검증 의존 | 두 도구가 같은 명시적 검증 스크립트 실행 |
| 요구사항이 곧바로 탐색·구현으로 이동 | 표준 트랙에 Interview/Seed 추가 |
| 검증과 리뷰 구분이 약함 | Mechanical/Semantic/Independent Review 분리 |
| Skill 작성 원칙이 외부 참고자료 | 원문을 하네스에 포함하고 작성 Rule 및 계약 검사로 연결 |
| 중복·stale 참조가 남을 수 있음 | Predictability, progressive disclosure, single source of truth 기준으로 정리 |

## 완료 조건

- Claude Code와 Codex가 같은 `AGENTS.md`, Electron 규칙, Skill 본문을 사용한다.
- 두 제공 문서가 원문과 바이트 단위로 동일하다.
- `work`와 `harness-improve`가 작성 규칙에 따른 트리거·절차·완료 조건을 가진다.
- 계약 검사와 Electron 검증 스크립트가 성공한다.
- 하네스 작업이 `tamagochi-pet`의 제품 소스를 변경하지 않는다.
- 이전 저장소의 비하네스 문서는 새 저장소에 존재하지 않는다.
