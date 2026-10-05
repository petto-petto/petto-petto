# @pet/battle

펫룸에서 선택한 펫을 표시하고 저장된 XP로 전투 진행도를 계산하는 Electron feature 패키지다. 전투는 펫·성장 데이터를 읽기만 하며 선택·XP·재화 저장은 각 소유 기능이 담당한다.

## 폴더 역할

| 위치                                   | 책임                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| `src/domain`                           | XP 진행·전투 단계 같은 순수 규칙                                     |
| `src/app`                              | 전투 명령 흐름과 조회 Client 조립                                    |
| `src/ports`                            | 전투가 요구하는 경계 인터페이스                                      |
| `src/platform`                         | 파일 조회·IPC 등 기술 구현                                           |
| `src/view`                             | DOM과 무관한 장면·모션·배치 계산                                     |
| `src/ui`                               | TypeScript 화면 로직                                                 |
| `src/testing`                          | 독립 화면 미리보기용 가짜 Client                                     |
| `ui/`                                  | HTML·CSS·preload·창 설정 원본                                        |
| `ui/assets/{enemies,backgrounds,pets}` | 실행 화면에서 읽는 전투 이미지 원본                                  |
| `ui/art/{enemies,backgrounds}`         | 적 비교 시안과 배경 생성 원본·중간 파일. 실행 빌드에서 제외          |
| `dist/`                                | TypeScript 컴파일 및 `ui/` 실행 파일의 빌드 출력. 직접 편집하지 않음 |
| `test/`                                | 단위·계약·통합·브라우저·Electron 검증                                |

전투 전용 실행 이미지는 `ui/assets`에서 관리하고 빌드 시 `dist/ui/assets`로 복사한다. `ui/art` 제작 자료는 앱에서 읽지 않는다. 공통 펫 스프라이트는 `apps/desktop/renderer/assets/pets`가 단일 원본이며 호스트가 경로를 주입한다.

다른 feature 패키지와 같이 별도 패키지 `docs/`는 두지 않는다. 기능 명세는 [하네스 전투 명세](../../.harness/specs/features/2026-09-30-battle-integration.md), 실행과 폴더 안내는 이 README, Client 연결 계약은 [전투 Client handoff](../../docs/pet-battle-client-handoff.md)에 둔다. 이전 구현 과정의 날짜별 작업 기록은 현재 실행 안내로 취급하지 않는다.

## 실행

루트 `npm start`가 UI 정적 파일과 TypeScript를 모두 빌드해 Electron에서 `dist/ui/index.html`을 연다. 단독 데모는 명시적인 데모 명부를 사용하고 실제 앱 저장소에 연결하지 않는다.

```bash
npm run build --workspace @pet/battle
npm run demo --workspace @pet/battle
npm run test --workspace @pet/battle
npm run test:integration --workspace @pet/battle
npm run test:electron --workspace @pet/battle
```

## 앱 연결

- `@pet/battle/client`은 소비자가 호출하는 읽기·화면 명령 Client다.
- `@pet/battle/node`의 `mountBattle`에 PetClient, 룸 선택 Client, 성장 곡선, 이미지 경로, 창 식별 및 종료 신호를 주입한다.
- 전투 UI는 `@pet/battle/ui`로 공개한다. Electron 창은 sandbox preload와 context isolation을 사용한다.
- 전투는 누적 XP를 읽어 적·단계·HP를 복원하고 XP를 쓰지 않는다. 성장 Client가 연결되지 않은 개체는 외형·모션과 연결 대기를 표시하며 다른 개체의 XP를 가져오지 않는다.
- 전투창은 기본 640×420, 최소 360×180이며 크기 조절을 지원한다. 창을 다시 열면 STOP·투명도 설정을 유지한다.
