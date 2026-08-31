# @pet/battle

Electron + Rust 기반 전투 feature 패키지다. 전투 규칙, 이벤트, JSON-lines IPC, 오버레이 UI,
프로토타입 에셋을 모두 이 디렉터리 안에서 소유한다. `packages/pet-core`와 `apps/desktop`의
수정 없이 단독으로 빌드·테스트·실행할 수 있다.

## 구조

```text
packages/pet-battle/
├── rust/              # 전투 규칙, 상태 전이, 모션 계산, JSON-lines sidecar
├── src/
│   ├── app/           # Electron IPC handler 계약
│   ├── ipc/           # Rust sidecar client/transport
│   ├── ui/            # 오버레이 DOM controller와 브라우저 fallback
│   └── view/          # 상태 → 배경·에셋·표정·크기 표현 모델
├── ui/                # 패키지 단독 Electron 프로토타입
├── assets/            # v1/v2 펫·적·배경 에셋
├── docs/              # 전투 시스템·UI 명세
└── test/              # TypeScript 계약 테스트
```

Rust가 XP 반영, 적 HP, 정복, 다음 스테이지, 오버레이 전이의 기준 상태를 관리한다.
TypeScript는 Rust 응답을 화면 표현으로 변환하며 전투 수치를 다시 계산하지 않는다.

## 실행

```bash
npm run build --workspace @pet/battle
npm run test --workspace @pet/battle
npm run test:rust --workspace @pet/battle
npm run demo --workspace @pet/battle
```

데모에서 펫이나 적을 클릭하면 원형 제어 메뉴가 열린다. 실제 앱에 연결할 때는
`battleHandlers`가 제공하는 채널을 등록하고 renderer에 `BattleGateway`만 노출하면 된다.

## 외부 feature 연동

- 성장 feature는 `GROWTH_XP_ADDED` 명령으로 `petId`, `amount`, `nowMs`를 전달한다.
- 펫 목록 변경은 `UPSERT_PET`, 활성 펫 변경은 `SET_ACTIVE_PET`을 사용한다.
- 화면은 `BattleEvent`의 `XP_APPLIED`, `ENEMY_DEFEATED`, `MODE_CHANGED` 등을 구독할 수 있다.
- 합성 규칙은 이 패키지의 책임이 아니다. 전투는 전달받은 펫 ID와 성장 XP만 처리한다.
