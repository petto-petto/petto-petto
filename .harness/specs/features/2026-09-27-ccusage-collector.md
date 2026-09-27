# Feature specification: ccusage 실제 수집기와 사용량 갱신

This specification owns the product what and why. The related implementation
plan owns the technical how.

## Status

Approved

## Owner

sh111-coder

## Problem and user outcome

meta의 사용량 화면과 설정의 수집 카드는 가짜 수집기(`FixtureCollector`)와 데모 사용량으로
동작한다. 사용자가 실제로 Claude Code·Codex·Gemini CLI를 써도 화면·코인·활동 시간·업적에
아무것도 반영되지 않는다.

사용자 관점의 결과: 앱을 켜 두면 세 도구의 로컬 기록이 1분마다 자동으로 반영되고, 기다리지
않고 바로 보고 싶을 때는 사용량 화면의 `갱신` 버튼으로 즉시 반영할 수 있다. 별도의 로그인,
API 키, hook 설치는 필요 없다.

## Scope

- 고정 버전 `ccusage`(20.0.24)를 앱 의존성으로 두고, 세 도구의 `daily --json` 출력을
  `SourceSnapshot`으로 변환하는 실제 수집기를 `FixtureCollector` 자리에 꽂는다.
- 수집 대상: Claude Code(`ccusage claude`), Codex(`ccusage codex`), Gemini CLI(`ccusage gemini`).
- 기존 1분 주기 집계를 유지하되, 이전 실행이 끝난 뒤 다음 실행을 예약해 겹치지 않게 한다.
- 사용량 화면(`정보 › 사용량`)에 켜진 모든 소스를 즉시 집계하는 `갱신` 버튼과 마지막 갱신
  시각을 추가한다.
- 데모 사용량은 환경변수 `META_DEMO_USAGE=1`일 때만 쓴다. 기본은 실제 수집기다.

## Non-goals

- 사용량 저장소를 `TokenClient`(SQLite)로 전환하는 일. meta 상태 저장은 현행 유지.
- 집계 주기 변경·사용자 설정. 1분 고정(기획서 8.3, 8.6).
- 사용자 지정 로그 경로, `CODEX_HOME` 등 환경변수 경로 존중(기획서 2.2 MVP 제외).
- 앱 패키징(asar·서명) 안에서의 바이너리 경로 처리. 저장소에 패키징 설정이 아직 없다.
- 세 CLI 원본 로그 직접 파싱(기획서 8.1).
- ccusage 버전 자동 업데이트. 앱 실행 중 자동 다운로드는 기획서 8.1이 금지한다. 버전 올리기는
  개발 단계에서 CI(`npm test`) + Dependabot으로 bump PR을 받고 파서 계약 테스트로 검증하는
  별도 작업으로 처리한다.

## Domain rules

- **번들 경계(8.1)**: ccusage는 `apps/desktop` 의존성에 정확한 버전으로 고정한다. 앱은
  플랫폼별 네이티브 바이너리(`@ccusage/ccusage-<platform>-<arch>/bin/ccusage`)를 직접
  실행하며, 사용자 전역 Node·ccusage에 의존하지 않는다.
- **네트워크 없음**: 항상 `--offline --no-cost`로 실행한다. 실행 중 가격표 조회나 다운로드를
  하지 않고, 비용 필드를 받지 않는다(INFO-008).
- **시간대(8.7)**: `--timezone`에 현재 시스템 IANA 시간대를 명시해 날짜 분류를 고정한다.
- **토큰 매핑(8.5)**: `modelBreakdowns[]`의 `inputTokens`·`outputTokens`·
  `cacheCreationTokens`·`cacheReadTokens`를 그대로 `TokenCounts`로 옮긴다. 행 키는
  `<date>|<modelName>`이며 모델명은 정규화하지 않는다. Codex의 `reasoningOutputTokens`는
  `outputTokens`에 포함된 값으로 확인된 경우에만 무시한다(Acceptance criteria 참조).
- **감지 판정**: ccusage는 로그 폴더가 없어도 빈 결과로 성공한다. 그래서 `not_found`는 앱이
  기본 위치(`~/.claude/projects`, `~/.codex/sessions`, `~/.gemini/tmp`) 존재 여부로 판정한다.
- **꺼진 소스(8.4)**: 꺼진 소스는 주기·갱신·재스캔 어디서도 ccusage를 실행하지 않는다. 다시
  켜면 새 기준점을 잡으므로 꺼져 있던 기간은 영구 제외된다. 기존 파이프라인 규칙 그대로다.
- **겹침 방지(8.3)**: 수집 실행 중에 들어온 주기·갱신·재스캔 요청은 새 실행을 만들지 않고
  진행 중인 실행에 합류한다. 1분 주기는 이전 집계 완료 후 60초 뒤에 다음 집계를 예약한다.
- **갱신 버튼 = 주기 집계와 같은 경로(COLLECT-003)**: 별도 구현 없이 켜진 모든 소스에 대해
  같은 수집·집계 함수를 부른다. 증가분이 없으면 아무것도 적립하지 않는다.

## Acceptance criteria

| 관측 가능한 결과 | 확인 방법 |
| --- | --- |
| 세 도구의 실제 ccusage JSON 샘플이 날짜·모델별 `SourceSnapshot` 행으로 변환된다 | 파서 계약 테스트 — 픽스처 JSON |
| 빈 `daily`는 빈 스냅샷, 스키마 불일치는 `unsupported_schema` | 파서 계약 테스트 |
| 기본 위치가 없으면 ccusage를 실행하지 않고 `not_found` | 수집기 테스트 — 가짜 실행기 호출 횟수 0 |
| 비정상 종료·타임아웃·JSON 파싱 실패는 `execution_failed`, 다른 소스에 영향 없음 | 수집기 테스트 |
| 꺼진 소스는 실행하지 않는다 | 수집기 테스트 — 가짜 실행기 호출 기록 |
| 실행 중 두 번째 요청은 새 실행 없이 같은 결과를 받는다 | 수집기 테스트 — 동시 호출 2회, 실행 1회 |
| Codex `reasoningOutputTokens`의 포함 여부가 확정돼 있다 | 토큰 수를 아는 합성 Codex 세션으로 ccusage 출력 확인, 결과를 파서 주석과 테스트에 기록 |
| `갱신` 버튼을 누르면 켜진 소스가 즉시 집계되고 화면과 마지막 갱신 시각이 바뀐다 | 실제 앱 실행 — Claude Code 사용 후 버튼 클릭 |
| 갱신 중에는 버튼이 비활성·`갱신 중…`으로 보이고 연타해도 실행이 한 번이다 | 실제 앱 실행 + 수집기 테스트 |
| 기본 실행에서 데모 사용량이 심기지 않고, 설정 카드에 실제 감지 상태가 보인다 | 실제 앱 실행 |
| 실행 시간이 1분 주기에 비해 충분히 짧다 | 실제 로그로 실행 시간 측정 후 결과 보고 |

## Edge and error cases

- 바이너리 미설치(현재 플랫폼용 optional dependency 없음) → 모든 소스 `execution_failed`,
  앱은 계속 뜬다. 로그에 원인을 남기고 사용자에게는 분류된 문구만 보인다(11.1).
- ccusage 실행이 10초를 넘기면 종료시키고 `execution_failed`.
- 첫 정상 스캔은 기준점만 만든다(8.2). 설치 직후 `갱신`을 눌러도 과거 기록은 적립되지 않는다.
- 누적값이 줄면 기존 `rebased` 규칙(8.8)을 따른다.
- 갱신 실패 시 버튼은 원래 상태로 돌아오고, 마지막 정상 데이터를 유지한 채 짧은 오류를 띄운다.

## API and data impact

- `pet-meta`: `parseCcusageDaily(provider, json)` 순수 함수 추가. `MetaAppState`가 수집기를
  생성자로 주입받는다(현재 내부에서 `FixtureCollector` 생성). 데모 시드는 주입된 수집기가
  `FixtureCollector`일 때만 동작한다.
- `apps/desktop`: `CcusageCollector`(바이너리 실행, 감지, 합류, 스냅샷 캐시) 추가. 1분
  주기를 완료 후 재예약 방식으로 변경. 시작·주기·재스캔·갱신 전에 수집을 먼저 실행한다.
- IPC: 사용량 화면의 `갱신`을 위한 채널 1개 추가(켜진 모든 소스 집계 후 결과 반환).
- 저장 데이터 형식 변경 없음. 의존성 추가: `ccusage@20.0.24`(exact).

## Open questions

없음.

## Related implementation plan

pending
