# @pet/main-overlay

공통 데스크톱 앱이 표시하는 메인 펫 오버레이의 React UI와 성장 도메인 패키지다.
Electron 창·preload·SQLite는 `apps/desktop`이 소유한다.
펫 정보와 스프라이트는 `apps/desktop/renderer/assets/pets`를 단일 원본으로 사용하며,
빌드 전에 해당 JSON에서 카탈로그를 생성한다.

## 화면 확인

저장·창 제어까지 포함한 오버레이는 저장소 루트에서 실행한다.

```bash
npm start
```

펫을 전환하고, 개발 패널에서 XP를 지급해 XP 바·레벨업·진화를 확인할 수 있다. 펫을
좌클릭하면 반응 모션, 우클릭하면 원형 메뉴가 표시된다.

## 포함 범위

- 펫별 독립 성장 상태, 토큰 잔여분 이월, 레벨·수동 진화
- 수동 경험치 지급과 저장 경계(`GrowthStore`)
- 6종 펫 레지스트리, 진화 단계별 스프라이트 경로, 프레임·정수배율 계산
- 렌더러가 소비할 `OverlayView`

## 통합 경계

1. `apps/desktop`은 SQLite/IPC와 창 제어를 구현한다.
2. 렌더러는 `overlayView()`의 `idleSpritePath`와 같은 경로에서 JSON 메타데이터를 읽어
   실제 프레임 크기를 결정한다. 모든 스프라이트는 정수배율로 렌더링한다.

이 패키지는 Electron을 직접 실행하지 않는다.
