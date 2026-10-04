# @pet/battle

Electron 내부 TypeScript 엔진 기반 전투 feature 패키지다. 전투 규칙, 이벤트, Electron IPC, 오버레이 UI,
프로토타입 에셋을 모두 이 디렉터리 안에서 소유한다. `packages/pet-core`와 `apps/desktop`의
수정 없이 단독으로 빌드·테스트·실행할 수 있다.

## 구조

```text
packages/pet-battle/
├── rust/              # 이전 엔진 계약·에셋 도구·명시적 sidecar 호환용
├── src/
│   ├── app/           # Electron IPC handler 계약
│   ├── domain/        # 실제 전투 엔진·저장 XP 진행 계산 (프로세스 내부 실행)
│   ├── adapters/      # 공통 파일 에셋 → BattleSpritePort
│   ├── integration/   # 주입된 PetClient / sprite Port
│   ├── ipc/           # Rust sidecar client/transport
│   ├── runtime/       # 이전 명시적 sidecar 준비·취소 호환 경로
│   ├── client.ts      # 소비자용 BattleClient 계약 (타입만)
│   ├── node.ts        # 호스트용 런타임 생성·IPC 조립·정리
│   ├── ui/            # 오버레이 DOM controller와 브라우저 fallback
│   └── view/          # 상태 → 배경·에셋·표정·크기 표현 모델
├── ui/                # 패키지 단독 Electron 프로토타입
├── assets/            # v2 도트 펫·적·배경 에셋
├── docs/              # 전투 시스템·UI 명세
└── test/              # TypeScript 계약 테스트
```

`ElectronBattleEngine`이 XP 반영, 적 HP, 정복, 다음 스테이지, 오버레이 전이를 관리한다.
실제 앱은 소유자가 저장한 XP만 읽는다. 화면은 엔진 응답을 표현하고 저장 값을 변경하지 않는다.

## 실행

```bash
npm run build --workspace @pet/battle
npm run test --workspace @pet/battle
npm run demo --workspace @pet/battle
```

데모에서 펫이나 적을 클릭하면 원형 제어 메뉴가 열린다. 실제 앱에 연결할 때는
`@pet/battle/node`의 `mountBattle`에 공통 `PetClient`, 성장 곡선, 에셋 루트, 허용할 전투창을 주입한다.
전투창은 패키지의 `ui/host-preload.cjs`를 사용하며 sandbox를 유지한다. 연결 예시는 `docs/token-growth-integration.md`에 있다.
일반 앱과 전투창, Electron 데모 모두 Cargo/Rust 설치가 필요하지 않다. 첫 승인 요청에서 메모리 내 엔진을 생성한다. `binaryPath`를 명시한 이전 소비자만 sidecar를 실행하며, `build:rust`와 `test:rust`는 선택적인 이전 엔진 검증용이다. [전환 설계·검증](docs/electron-engine-migration.md)을 참고한다.
실제 앱과 데모의 최초 크기는 640×420px, 최소 크기는 360×180px이며 모서리 크기 조절을 지원한다. 전투 펫 프레임은 96px이다.

HP에 따라 후퇴·추격 역할이 바뀌고 적은 점프 내려찍기한다. 카메라와 배경은 전투·보행 상태와 관계없이 펫의 지면 위치를 0.5초 늦게 따라간다. STOP·메뉴에서는 개체 이동만 멈추고 카메라는 남은 추적을 마무리한다. 실제 정복은 처치 연출 후 다음 적으로 자동 전환한다. HP 버튼으로 100%·60%·25%의 이동 패턴을 미리 볼 수 있다(메뉴를 닫으면 이동 재개).

## 외부 feature 연동

- 화면·소비자는 `import type { BattleClient } from '@pet/battle/client'`로 공개 계약을 사용한다. `createBattleRuntime()`의 반환값은 이 계약을 구현하고 호스트용 `close()`를 더한다. 기존 `mountBattle()` 연결 방식은 바뀌지 않는다.
- 실제 앱은 `PetBattleIntegration`에 공통 `PetClient`와 성장 곡선을 주입한다. 저장된 활성 개체·누적 XP를 읽어 상태를 복원한다. 상세 계약은 `docs/token-growth-integration.md`를 따른다.
- `BattleLifecyclePort`로 앱 종료·전투창 닫기를 주입한다. 준비된 런타임은 재진입용으로 유지하고 앱 종료 시 IPC·런타임을 정리한다.
- 모든 등급이 같은 21단계(7색×소·중·대)로 진행하며 Lv.50에 한 바퀴를 완료한다. HP 표는 `docs/battle-system.md`에 있다.
- `GROWTH_XP_ADDED`·`UPSERT_PET`·`SET_ACTIVE_PET`은 독립 sidecar의 기존 저수준 API 호환용이다. 실제 앱 renderer는 이를 호출할 수 없으며 성장 알림의 delta를 중복 가산하지 않는다.
- 화면은 `execute()` 응답의 `events`에서 `XP_APPLIED`, `ENEMY_DEFEATED`, `MODE_CHANGED` 등을 읽는다. 별도 구독 API는 제공하지 않는다.
- 합성 규칙은 이 패키지의 책임이 아니다. 전투는 전달받은 펫 ID와 성장 XP만 처리한다.
