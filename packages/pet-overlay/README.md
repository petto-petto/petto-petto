# @pet/main-overlay

기존 Electron/React 프로토타입의 메인 펫 오버레이와 성장 시스템을 그대로 이관한 패키지다.
원본 React UI, 스프라이트, Electron 투명 오버레이 창, hook 수신 서버를 포함한다.

## 화면 확인

패키지에서 의존성을 설치한 뒤 아래 명령으로 원본과 같은 Electron 오버레이를 연다.

```bash
cd packages/pet-overlay
npm install
npm run electron:dev
```

펫을 전환하고, 개발 패널에서 XP를 지급해 XP 바·레벨업·진화를 확인할 수 있다. 펫을
좌클릭하면 반응 모션, 우클릭하면 원형 메뉴가 표시된다.

## 포함 범위

- 펫별 독립 성장 상태, 토큰 잔여분 이월, 레벨·수동 진화
- `input_tokens + output_tokens`만 전달받는 XP 경계 (`5,000` 토큰 = `1 XP`)
- 중복 사용량 이벤트 방지와 저장 경계(`GrowthStore`)
- 6종 펫 레지스트리, 진화 단계별 스프라이트 경로, 프레임·정수배율 계산
- 렌더러가 소비할 `OverlayView`

## 통합 경계

1. 앱은 `GrowthStore`를 SQLite/IPC 등의 실제 저장소로 구현한다.
2. 사용량 수집기는 캐시 토큰을 제외한 input + output 토큰과 안정적인 이벤트 ID를
   `OverlayGrowthState.applyUsage()`에 전달한다.
3. 렌더러는 `overlayView()`의 `idleSpritePath`와 같은 경로에서 JSON 메타데이터를 읽어
   실제 프레임 크기를 결정한다. 모든 스프라이트는 정수배율로 렌더링한다.

이 패키지는 원본 프로토타입의 hook 수신, 창 위치 영속, 클릭 통과 제어까지 포함한다.
SQLite 통합과 모노레포 앱 연결은 후속 통합 단계에서 수행한다.

## 로컬 SQLite

Electron main 프로세스가 `userData/pet-overlay.sqlite`를 소유하며, renderer는 preload의
성장 저장 API만 사용한다. DB 파일·마이그레이션·트랜잭션은
`electron/database/`의 범용 계층에, 펫 성장 테이블은 `electron/persistence/`에 분리했다.

`better-sqlite3`를 설치하거나 Electron 버전을 올린 뒤에는 현재 플랫폼의 ABI에 맞춰 다음을
실행한다.

```bash
npm run rebuild:native
```
