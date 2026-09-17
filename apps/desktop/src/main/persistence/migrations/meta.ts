import type { SqliteMigration } from '../sqlite-file.ts';

/**
 * meta 기능(정보 · 설정 · 업적 · 사용량 수집)의 테이블.
 *
 * 논리 모델은 기획서 10장이다. 이름에 `meta_` 를 붙인 이유: `petto.sqlite` 를 모든 기능이
 * 함께 쓰므로 `usage_daily` · `user_profile` 같은 일반적인 이름은 다른 기능과 부딪힌다.
 *
 * ## 표와 열의 설명은 SQL 주석으로 단다
 *
 * SQLite 에는 `COMMENT ON` 같은 문법이 없다. 대신 `CREATE TABLE` **괄호 안**의 `--` 주석은
 * 스키마 원문(`sqlite_master.sql`)에 그대로 저장돼, DB 도구로 표 정의를 열면 함께 보인다.
 * 괄호 앞이나 닫는 괄호 뒤의 주석은 버려지므로 표 설명은 여는 괄호와 같은 줄에 둔다.
 * 모든 표와 열에 설명이 있는지는 `test/meta-repository.test.cjs` 가 확인한다.
 *
 * 주석도 migration SQL 의 일부다. 배포한 뒤에 고치면 새로 설치한 DB 에만 반영되고 기존 DB 의
 * 스키마 원문은 그대로라, 설치마다 설명이 달라진다. 배포 후에는 다른 SQL 처럼 건드리지 않는다.
 *
 * ## 만들지 않은 것
 *
 * `achievement_definition` 은 표로 만들지 않았다. 업적 정의는 앱과 함께 배포되는 값이고
 * 사용자가 바꾸지 않는다. 표에 복사하면 앱을 업데이트할 때 두 원본이 어긋난다.
 *
 * enum 값에 `CHECK` 를 걸지 않았다. 수집 상태나 보상 종류가 하나 늘 때마다 migration 이 필요해진다.
 * 허용 값은 열 설명에 적고, 참·거짓만 `0/1` 로 제한한다.
 */
export const META_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'meta',
    version: 1,
    name: 'create meta tables',
    up(database) {
      database.exec(`
        CREATE TABLE meta_source ( -- 사용량을 모으는 AI 코딩 도구별 수집 상태. 도구마다 한 행
          provider TEXT PRIMARY KEY NOT NULL, -- 도구: claude_code | codex | gemini_cli
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), -- 사용자가 수집을 켰는가 (1 켬 / 0 끔)
          status TEXT NOT NULL, -- 수집 상태: connected(수집 중) | not_found(기록 없음) | paused(수집 중지) | scanning(확인 중) | error(집계 오류)
          has_baseline INTEGER NOT NULL CHECK (has_baseline IN (0, 1)), -- 기준점이 있는가. 0 이면 baseline_* 열과 meta_source_baseline_row 를 보지 않는다. 수집을 다시 켜면 0 이 되고 다음 집계가 새로 잡는다
          baseline_total_observed INTEGER, -- 기준점을 잡을 때 도구 기록의 누적 관측 토큰 합계. 기록이 이보다 줄면 초기화된 것으로 보고 기준점을 다시 잡는다
          baseline_captured_at TEXT, -- 기준점을 잡은 시각 (ISO 8601)
          disabled_at TEXT, -- 사용자가 수집을 끈 시각 (ISO 8601). 다시 켜면 NULL
          last_success_at TEXT, -- 마지막으로 집계에 성공한 시각 (ISO 8601)
          last_error TEXT, -- 마지막 집계의 사용자 안내 문구 (실패 원인, 기준점 재설정 안내). 문제없이 집계하면 NULL
          ever_connected INTEGER NOT NULL CHECK (ever_connected IN (0, 1)) -- 한 번이라도 정상 감지된 적이 있는가. 최초 실행 판단에 쓴다. 기준점은 껐다 켜면 비워지므로 따로 둔다
        );

        CREATE TABLE meta_source_baseline_row ( -- 기준점을 잡을 때 본 도구 기록의 누적 사용량. 도구·날짜·모델별 한 행
          -- 합계만 두면 어느 날짜의 행이 늘었는지 알 수 없어 증가분을 날짜별로 나누지 못한다
          provider TEXT NOT NULL, -- 도구 (meta_source.provider)
          local_date TEXT NOT NULL, -- 사용한 로컬 날짜 (YYYY-MM-DD)
          raw_model TEXT NOT NULL, -- 도구 기록에 적힌 원본 모델명
          input INTEGER NOT NULL, -- 입력 토큰
          output INTEGER NOT NULL, -- 출력 토큰
          cache_create INTEGER NOT NULL, -- 캐시 생성 토큰
          cache_read INTEGER NOT NULL, -- 캐시 읽기 토큰
          PRIMARY KEY (provider, local_date, raw_model)
        );

        CREATE TABLE meta_usage_daily ( -- 앱 설치 이후 늘어난 토큰 사용량. 도구·날짜·모델별 한 행. 기준점 이전 사용량은 들어오지 않는다
          provider TEXT NOT NULL, -- 도구: claude_code | codex | gemini_cli
          local_date TEXT NOT NULL, -- 사용한 로컬 날짜 (YYYY-MM-DD)
          raw_model TEXT NOT NULL, -- 도구 기록에 적힌 원본 모델명. 모델 행은 도구와 원본 모델명으로 구분한다
          input INTEGER NOT NULL, -- 입력 토큰
          output INTEGER NOT NULL, -- 출력 토큰
          cache_create INTEGER NOT NULL, -- 캐시 생성 토큰
          cache_read INTEGER NOT NULL, -- 캐시 읽기 토큰. 관측 토큰에는 들어가고 보상 대상 토큰에서는 빠진다
          PRIMARY KEY (provider, local_date, raw_model)
        );

        CREATE TABLE meta_activity_minute ( -- 토큰 사용이 늘어난 로컬 분. 같은 분에 도구 셋이 늘어도 한 행이라 활동 시간은 1분이다
          local_minute TEXT PRIMARY KEY NOT NULL -- 로컬 분 (YYYY-MM-DDTHH:mm)
        );

        CREATE TABLE meta_processed_delta ( -- 이미 반영한 사용량 증가분. 집계 도중 앱이 꺼졌다 다시 돌아도 같은 증가분을 두 번 더하지 않게 한다
          dedupe_key TEXT PRIMARY KEY NOT NULL -- 증가분 키: 도구:이전 합계->현재 합계 (예: codex:0->300)
        );

        CREATE TABLE meta_pending_usage_grant ( -- 재화 지급에 실패해 다음 집계에서 다시 시도할 사용량 보상
          -- 기획서 10장에 없는 표다. 기준점은 이미 앞으로 갔으므로 이 기록이 없으면 재시작 뒤 보상이 사라진다
          dedupe_key TEXT PRIMARY KEY NOT NULL, -- 증가분 키 (meta_processed_delta.dedupe_key 와 같은 값)
          reward_tokens INTEGER NOT NULL -- 보상 대상 토큰 = 입력 + 출력 + 캐시 생성. 코인 환산은 재화 기능이 한다
        );

        CREATE TABLE meta_processed_event ( -- 이미 반영한 다른 기능의 이벤트 (합성 완료, 전투 종료 등). 같은 이벤트가 다시 와도 한 번만 센다
          -- 기획서 10장에 없는 표다. 없으면 재시작 뒤 같은 이벤트를 두 번 센다
          event_id TEXT PRIMARY KEY NOT NULL -- 이벤트를 보낸 기능이 만든 식별자. 다시 보내도 바뀌지 않는다
        );

        CREATE TABLE meta_achievement_fact ( -- 업적 판정에 쓰는 사실 값 (펫, 합성, 전투). 펫 사실은 관측한 최고치라 펫을 잃어도 줄지 않는다
          fact_key TEXT PRIMARY KEY NOT NULL, -- 사실 이름: firstPet | firstEpic | dexOwned | dexTotal | dexComplete | fusionCount | commonFusionEpic | maxPetLevel | maxLevelReached | evolutionCount | battleWins | maxStreak. 코드가 모르는 이름은 읽을 때 무시한다
          fact_value INTEGER NOT NULL -- 값. 개수와 레벨은 그 수, 여부는 1(예) / 0(아니오)
        );

        CREATE TABLE meta_achievement_progress ( -- 업적별 사용자 진행. 업적 정의는 코드에 있고 이 표에는 진행만 둔다
          achievement_id TEXT PRIMARY KEY NOT NULL, -- 업적 id (예: collection.first_pet). 코드의 업적 정의와 짝이다
          progress INTEGER NOT NULL, -- 진행 값 = min(현재 사실, 목표). 줄지 않는다
          unlocked_at TEXT -- 해제한 시각 (ISO 8601). 아직 해제하지 않았으면 NULL
        );

        CREATE TABLE meta_achievement_reward ( -- 업적 보상 지급 기록. 업적 하나에 보상이 종류별로 한 행씩 생긴다
          achievement_id TEXT NOT NULL, -- 보상을 준 업적 id
          reward_key TEXT NOT NULL, -- 지급 멱등 키. 같은 키로는 두 번 지급하지 않는다. achievement:업적 id (코인) | achievement-title:업적 id | achievement-trophy:업적 id
          kind TEXT NOT NULL, -- 보상 종류: coin(코인) | title(칭호) | trophy(트로피)
          status TEXT NOT NULL, -- 처리 상태: pending(지급 대기, 재시도 대상) | done(지급 완료)
          attempts INTEGER NOT NULL, -- 지급 시도 횟수
          last_error TEXT, -- 사용자에게 보여줄 마지막 실패 원인. 지급에 성공하면 NULL
          detail TEXT, -- 지급 결과 설명 (예: 트로피가 룸에 놓였는지 보관함에 갔는지). 없으면 NULL
          PRIMARY KEY (achievement_id, reward_key)
        );

        CREATE TABLE meta_profile ( -- 정보 탭의 프로필. 한 행만 있다
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), -- 항상 1. 행이 둘 생기지 않게 막는다
          equipped_title TEXT -- 장착한 칭호. 최대 하나이고, 장착을 해제했으면 NULL
        );

        CREATE TABLE meta_profile_title ( -- 사용자가 얻은 칭호. 얻은 순서대로 쌓인다
          title TEXT PRIMARY KEY NOT NULL -- 칭호 이름
        );

        CREATE TABLE meta_settings ( -- 설정 화면의 값. 한 행만 있고, 이 행이 있으면 meta 를 저장한 적이 있다는 뜻이다. 켬·끔 열은 1 켬 / 0 끔
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), -- 항상 1. 행이 둘 생기지 않게 막는다
          overlay_visible INTEGER NOT NULL CHECK (overlay_visible IN (0, 1)), -- 오버레이 펫 표시 (초기값 1)
          pet_size TEXT NOT NULL, -- 펫 크기: small | normal | large (초기값 normal). 설정 패널 크기는 바뀌지 않는다
          autostart INTEGER NOT NULL CHECK (autostart IN (0, 1)), -- 부팅할 때 자동 실행 (초기값 0)
          notify_levelup INTEGER NOT NULL CHECK (notify_levelup IN (0, 1)), -- 레벨업 알림 (초기값 1)
          notify_achievement INTEGER NOT NULL CHECK (notify_achievement IN (0, 1)), -- 업적 달성 알림 (초기값 1)
          notify_gacha_ready INTEGER NOT NULL CHECK (notify_gacha_ready IN (0, 1)) -- 뽑기 가능 알림 (초기값 0)
        );
      `);
    },
  },
];
