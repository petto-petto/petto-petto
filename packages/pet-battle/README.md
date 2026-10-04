# @pet/battle

펫룸에서 선택한 펫을 표시하고 저장된 XP로 전투 진행도를 계산하는 Electron feature 패키지다.
전투는 펫·성장 데이터를 읽기만 하며, 선택·XP·재화 저장은 각 소유 기능이 담당한다.

## 구조

하네스의 feature 내부 책임 분리와 기존 패키지 구조를 따른다.

```text
packages/pet-battle/
├── src/
│   ├── domain/       # 전투 엔진·XP 진행 계산
│   ├── app/          # 조회 연동·명령 정책·IPC와 수명 조립
│   ├── adapters/     # 룸 스냅샷·파일 이미지 변환
│   ├── view/         # 화면 모델·카메라·교전 모션 계산
│   ├── ui/           # 타입 검사되는 DOM controller
│   ├── client.ts     # 소비자용 읽기·화면 명령 계약
│   ├── contracts.ts  # 전투 상태·명령·결과 타입
│   ├── index.ts      # 기능 공개 진입점
│   └── node.ts       # 호스트 의존성을 받아 내부 엔진 조립
├── ui/               # HTML·CSS·preload·단독 Electron 실행
├── assets/           # 실제 사용하는 전투 적·배경과 생성 원본
├── test/             # 단위·계약·통합·화면 검증
├── docs/             # 기능 명세·연동 안내·과거 작업 기록
├── battle-rules.json # 연동 설정
├── package.json
└── tsconfig.json
```

`dist/`와 `tsconfig.tsbuildinfo`는 빌드 산출물이며 커밋하지 않는다.
`src/ui`는 TypeScript로 빌드되는 화면 로직, `ui`는 Electron이 직접 여는 화면 파일이다.
공통 펫 이미지는 호스트가 제공하며, 전투 전용 적·배경만 이 패키지의 assets에 둔다.

## 실행과 검증

```bash
npm run build --workspace @pet/battle
npm run test --workspace @pet/battle
npm run test:integration --workspace @pet/battle
npm run test:electron --workspace @pet/battle
npm run demo --workspace @pet/battle
```

실제 앱은 루트의 `npm start`로 실행한다. 앱·데모·통합 검증 모두 TypeScript 엔진을 사용한다.
Rust 엔진, Cargo 빌드, 별도 엔진 프로세스와 바이너리 경로 옵션은 제공하지 않는다.
단독 데모는 명시적인 데모 명부를 사용하며 실제 앱의 저장소와 분리된다.

## 앱 연결

- `@pet/battle/client`는 소비자용 BattleClient 타입을 제공한다.
- `@pet/battle/node`의 mountBattle에 PetClient·룸 선택 조회·성장 곡선·이미지 경로·전투창 식별 및 종료 신호를 주입한다.
- 전투창은 `ui/host-preload.cjs`를 사용하며 sandbox와 발신자 검증을 유지한다.
- 성장 정보가 없는 개체는 외형·모션만 표시하고 연결 대기를 안내한다. 다른 개체의 XP를 사용하지 않는다.
- 전투창 기본 크기는 640×420, 최소 크기는 360×180이다. 창을 다시 열면 STOP·투명도 설정을 유지한다.

## 문서

- [전투 규칙](docs/battle-system.md)
- [화면 동작](docs/battle-ui.md)
- [외부 Client 연결](docs/token-growth-integration.md)
- [패키지 구조 정리와 검증](docs/package-structure.md)

날짜가 붙은 문서와 엔진 전환 기록은 당시 구현의 작업 이력이다. 현재 실행 방법과 구조는 이 README를 따른다.
