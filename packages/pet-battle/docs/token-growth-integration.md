# 공통 클라이언트 → 전투 연결

## 전투의 역할

`RoomSelectionClient 선택 + PetClient 저장 성장 → 전투 Adapter → Electron 내부 TypeScript 엔진 → 화면`

2026-10-04부터 기본 앱·Electron 데모는 Cargo/Rust를 실행하지 않습니다. [전환 설계·검증](electron-engine-migration.md)을 따릅니다. 아래 과거 작업 기록의 Rust 검증 수치는 당시 구현에 대한 기록입니다.

- 공개 타입은 `@pet/client`에서 가져오고, 구현체는 호스트가 주입한다.
- 현재 앱의 선택은 `RoomSelectionClient.getSnapshot()`에서, 실제 성장은 같은 개체의 `PetClient.listOwnedPets()`에서 읽는다. `selection`을 생략한 기존 소비자는 `getActivePet()`를 사용한다. 에셋 구성은 `listSpecies()`를 사용하며 공통 저장 명령은 호출하지 않는다.
- 개체 ID·이름·등급·레벨·누적 XP·에셋·진화 단계를 읽는다. 이름은 별명이 있으면 별명을 쓴다.
- 매 요청에 저장된 누적 XP를 동기화한다. 같은 성장 알림을 다시 받아도 XP를 더하지 않는다.
- 활성 펫이 없으면 선택 안내를 표시한다. 조회 오류는 미보유로 위장하지 않고 호출자에게 전달한다.
- 화면에는 전투·미리보기 명령만 허용한다. 임의 성장·명부 변경 명령은 거절한다.

## 토큰은 왜 직접 적용하지 않는가?

`TokenClient.totals()`의 `reward`에는 캐시 생성 토큰이 포함된다. 펫별 귀속이나 성장 저장 완료 알림도 제공하지 않는다.
따라서 그 합계를 전투에서 XP로 바꾸면 성장 담당자의 환산·중복 방지 규칙과 충돌한다.

토큰 수집·기록·통계·XP 환산·성장 저장은 해당 기능 담당자가 수행한다.
전투는 그 결과가 저장된 `PetClient.totalXp`만 사용하며, SQL·Repository·마이그레이션·다른 패키지 내부 구현을 추가하지 않는다.

## 호스트 연결 예시

소비자가 사용하는 전투 소유 인터페이스는 `BattleClient`다. 계약 전용 진입점은 타입만 제공하며 DB·Electron·Rust 프로세스를 로드하지 않는다.

```ts
import type { BattleClient } from '@pet/battle/client';

function readBattle(client: BattleClient) {
  return client.execute({ type: 'GET_STATE', nowMs: Date.now() });
}
```

- `BattleClientCommand`는 조회·전투 시작/중지·미리보기·표시 설정의 기존 14개 명령만 허용한다.
- 펫 선택 저장·명부 변경·XP 지급·엔진 동기화 명령은 공개 계약에서 제외한다. IPC와 직접 integration 호출은 같은 허용 정책으로 차단한다. IPC에서는 명령 검사 후에만 내부 런타임을 생성한다.
- 내부 `BattleGateway`/`RustBattleClient`는 전체 엔진 프로토콜을 유지한다. 외부 소비자가 이 저수준 API로 다른 기능의 저장 책임을 대신하지 않는다.
- 실제 런타임은 `BattleRuntime extends BattleClient`이며 호스트만 `close()`로 수명을 관리한다. 기존 `createBattleRuntime()`·`mountBattle()` 이름과 호출 방식은 유지한다.
- 금지 명령은 기존처럼 비동기 실패로 전달하고 공통 `PetClient` 조회·저장이나 엔진 실행을 시작하지 않는다. 신뢰하지 않는 창은 명령 검사 전에 거부한다.

전체 앱은 `@pet/battle/node`의 `mountBattle`을 호출한다. 런타임·전투 설정·이미지 매핑·명령 등록은 전투 패키지가 소유하고 앱은 의존성과 신뢰할 창을 제공한다.

```ts
import { mountBattle } from '@pet/battle/node';
import { RoomSelectionAdapter } from '@pet/room';

// pets: 호스트에서 생성한 PetClient 구현체
// room: 기존 RoomState. 룸의 저장·조회 동작은 변경하지 않는다.
// levelXpCosts: 성장 담당자가 제공한 레벨별 필요 XP 배열
const closeBattle = mountBattle(pets, ipcMain, {
  selection: new RoomSelectionAdapter(() => room.scene().pets),
  petAssetsDir, // 앱이 소유한 공통 펫 원본 에셋 루트
  levelXpCosts,
  isBattleSender: (id) => getBattleWindow()?.webContents.id === id,
  lifecycle: {
    onQuit(listener) {
      app.once('before-quit', listener);
      return () => {
        app.removeListener('before-quit', listener);
      };
    },
    onWindowClosed: subscribeBattleWindowClosed,
  },
});
// 호스트 연결을 별도로 해제할 때만 closeBattle()을 직접 호출한다.
```

- `mountBattle`은 `battle:command`만 등록한다. 승인된 전투창의 첫 허용 요청에서 내부 엔진을 생성한다. 상태는 응답으로 반환하며 다른 기능으로 broadcast하지 않는다.
- 기본 경로에는 Cargo 빌드나 외부 프로세스 준비가 없다. `binaryPath`를 명시한 이전 소비자만 해당 실행 파일을 검사하고 sidecar를 사용한다. 준비 제한·5초 실패 대기 옵션은 그 호환 경로에만 적용된다.
- `BattleLifecyclePort`는 등록 해제 함수를 반환하는 `onQuit`·`onWindowClosed` 두 신호다. 준비된 런타임은 유지하므로 재개방 시 STOP·투명도·미리보기가 초기화되지 않는다. 앱 종료는 IPC·런타임과 신호 구독을 정리한다.
- 전투창은 `@pet/battle/ui/host-preload.cjs`로 `window.petBattle.execute()`만 노출한다. `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`를 유지한다. 독립 데모의 `preload.cjs`와 바꾸어 쓰지 않는다.
- 창 크기는 `@pet/battle/ui/window-options.json`을 데모와 공유한다. 실제 창 생성·종료·폰트 주입은 호스트 책임이다.
- GUI 없이도 `createBattleRuntime(pets, { petAssetsDir, levelXpCosts })`를 생성하고 `execute()` / `close()`를 호출할 수 있다. 기존 동기 카탈로그 검증을 유지하며 기본 경로에는 별도 엔진 파일이 필요하지 않다.
- 현재 앱은 룸의 선택을 읽기 전용 `selection` Client로 전달한다. `selection` 미주입 소비자만 공통 `PetClient.setActivePet(ownedPetId)` 저장을 따라간다. 전투는 선택을 대신 저장하거나 JSON 명부를 이관하지 않는다. 메인 오버레이 연결은 별도 범위다.
- 성장 담당자의 저장 성공 후 다음 전투 조회에서 자동 반영된다. 기존 저수준 `PetBattleIntegration`을 직접 사용하는 호출자는 `syncActivePet()`으로 즉시 재조회할 수도 있다.
- 기존 호출부 호환용 `applyGrowthXp({ ownedPetId, amount, nowMs })`도 저장값 재조회만 한다. `amount`는 가산하지 않으며 다른 펫 알림은 무시한다.
- 공통 클라이언트에는 구독 API가 없으므로 전투가 존재하지 않는 이벤트 API를 가정하지 않는다.
- 종료 시 `closeBattle()`은 IPC를 해제하고 런타임을 종료한다. 반복 호출은 안전하며 종료된 연결은 다시 생성되지 않는다. 명시적 sidecar가 있으면 함께 종료한다.
- 저수준 `PetBattleIntegration`의 세 번째 인자는 필수 `BattleGrowthRules`, 네 번째는 선택적 `RoomSelectionClient`다. Node 진입점 사용 시 레거시 `intervalLevels` 필드는 패키지가 자체 설정에서 가져온다.

## 전투 진행과 화면

- 내부 TypeScript 엔진은 주입된 성장 곡선과 모든 등급 공통 `[2, 2, 3]` 레벨 상당 XP 구간으로 HP·스테이지를 계산한다. 각 색의 소·중·대를 거쳐 Lv.50에 21단계를 정복한다. 상세 표는 `battle-system.md`를 따른다.
- 최초 조회·재연결은 현재 진행도로 복원한다. 과거 정복 연출을 재생하지 않는다.
- 실행 중 정복은 HP 0 → 처치 연출 → 다음 적·배경 자동 전환이다. 클릭은 선택적인 처치 연출 생략이다.
- 독립 Electron demo도 동일 내부 엔진에 데모 명부만 명시적으로 주입한다. 일반 `npm start`와 demo 모두 Cargo를 호출하지 않는다.
- 현재 앱은 룸에서 지정한 펫을 다음 전투 조회에 반영한다. 공통 활성값과 달라도 룸 선택이 우선하며, 룸의 선택 없음도 다른 활성 펫으로 대체하지 않는다. `selection` 미주입 호출만 공통 활성값을 따른다.
- 전투 `FileBattleSpriteAdapter`는 주입된 공통 종 목록과 원본 에셋의 프레임 메타로 종·진화 단계별 이미지를 제공한다. `BattleSpritePort`는 화면 에셋 해석만 위한 Port이며 펫 데이터용 PetClient를 복제하지 않는다. 등급별 대표 이미지는 독립 demo와 명시적인 미리보기 버튼에만 사용한다.
- 전투는 room JSON을 삭제·이관·기록하지 않는다. JSON에만 있는 펫도 외형·모션을 표시하되 `growthStatus: UNLINKED`와 성장 연결 대기를 안내한다. 내부 XP는 `null`이며 stage1/HP100%에서 실제 성장·정복 이벤트를 만들지 않는다. 같은 종의 공통 개체에 추측 연결하지 않는다.
- 공통 명부에서 정확한 `ownedPetId`·종·스프라이트가 확인되면 `LINKED`로 전환해 저장 성장 전체를 읽는다. 최초 연결은 기존 진행도로 복원하며 과거 정복을 재생하지 않는다. 연결이 사라지면 이전 정복 연출과 실제 성장 표시를 정리한다.
- 앱은 읽기 전용 `PetClientRoomAdapter`와 `RoomSelectionAdapter`(`@pet/room`)를 전투에만 주입한다. 두 Adapter에는 선택·성장 저장 메서드가 없다. `RoomState`·`RoomCollectionPort`의 저장·조회 동작은 원격 main과 동일하다.

### 레벨 사이 XP와 HP 표시

- 레벨 숫자가 바뀌지 않아도 `PetClient.totalXp`가 늘면 다음 상태 조회에서 HP가 감소한다. 전투 화면은 기존 약 80ms 조회 주기를 사용하며 IPC 지연·진행 중 요청에 따라 실제 반영 시점은 달라진다.
- HP 표시는 수신된 실제 값 사이를 0.7초 동안 부드럽게 보간한다. 다음 값을 예측하거나 토큰 잔여분을 임의 XP로 변환하지 않는다. 미리보기 HP가 선택되어 있으면 그것이 우선하므로 실제 XP 검증은 미리보기를 해제한 상태에서 한다.
- **현재 연결 한계:** 오버레이 성장 저장은 `pet_profiles`, 공통 `PetClient` 조회는 `owned_pets`다. 오버레이의 `growth:save-all`만으로 공통 XP가 갱신되지는 않는다. 전투가 두 저장소를 직접 읽어 합치지 않는다.
- 성장 담당자는 해당 `ownedPetId`에 대해 `PetClient.updateGrowth(ownedPetId, growth)`로 `level`, `totalXp`, `xpIntoLevel`, `evolutionStage`를 함께 저장해야 한다. 저장 성공 후 다음 전투 조회 또는 `syncActivePet()`으로 반영한다. 연결되기 전에는 오버레이의 XP 증가가 전투에 실시간 전달된다고 보장하지 않는다.

## 검증

```bash
npm run build --workspace @pet/battle
npm test --workspace @pet/battle
npm run test:integration --workspace @pet/battle
npm run test:rust --workspace @pet/battle
```

패키지 통합 테스트는 읽기 전용 PetClient 계약 fixture와 실제 Rust 프로세스를 연결한다.
HP·정복·다음 적·배경, 중복 알림, 재연결, 활성 해제를 확인한다. 다른 기능 구현체나 사용자 DB를 쓰지 않는다.
따라서 전체 앱·실제 SQLite·GUI 검증을 대체하지 않는다.

## 작업 기록

아래는 당시 검증 기록이다. 2026-09-29부터 구간·색·크기는 `2026-09-29-window-and-progression.md`의 승인 규칙으로 변경되었다.

- Track: standard. Seed: 공개 PetClient/TokenClient handoff 및 전투 폴더만 수정하라는 사용자 요구.
- Explorer: 기존 delta 기반 어댑터가 저장된 누적 XP를 읽지 않고, 활성 해제 때 이전 펫을 유지하는 경로를 확인했다.
- Planner / Implementer: 실패 테스트를 먼저 커밋하고 기존 읽기 전용 gateway로 통합했다.
- Verifier / Mechanical: 포맷·타입·전체 패키지 테스트 217개, Rust 테스트 26개, 새 실제 엔진 통합 테스트 1개 통과.
- Verifier / Semantic: 155 → 156 XP에서 HP 0·정복, 클릭 후 주황 적, 684 XP 재연결 시 4스테이지·수정 유적을 확인했다. 중복 알림과 활성 해제도 통과했다.
- 측정: 전투 integration 디렉터리 집중 테스트 6개의 라인 커버리지 100%, 분기 96.55%. 전체 앱 커버리지 수치가 아니다.
- Reviewer: 별도 에이전트 없이 같은 세션에서 변경 diff·호출부·소유권 경계를 검토했다. 이번 변경은 전투 패키지 안에만 있으며 GUI·사용자 DB는 검증하지 않았다.
- Evolve: 통계 값과 성장 값을 분리하고, 전투의 공개 연결 지점을 이 문서에 한정한다.
- 이전 문서에 기술한 앱·펫룸·토큰 저장 구현은 전투의 책임에서 제외했다. 사용자 승인 후 전투 밖 24파일을 `3f58442` 기준으로 원복했다. 사용자 DB는 변경하지 않았으며, 공통 클라이언트 원본 구현은 보존했다.
- 이후 사용자가 앱 main·preload·펫룸의 최소 연결을 명시적으로 승인하여 아래 작업을 진행했다. 토큰·성장·DB 테이블 변경은 복구하지 않았다.

## 후속 작업 — 오버레이 지정과 전투 선택 동기화

- Track: standard. Seed: 승인된 `.harness/specs/features/2026-09-03-pet-room.md`, `docs/pet-client-handoff.md`, 사용자의 최소 연결 승인. 최신 공통 계약의 빈 명부·저장된 진화 단계 기준을 적용한다.
- Explorer: JSON 명부와 공통 명부 분리, 앱의 데모 fallback, 전투의 등급별 대표 에셋 선택을 확인했다.
- Planner: 공통 명부 표시·선택 → 전투 IPC 주입 → 종·진화 이미지 → 실제 저장소와 엔진 검증. 기존 JSON 이관, 토큰 환산, 성장 계산, 테이블 변경, 획득 기능은 제외했다.
- Implementer: 네 실패 테스트를 커밋한 후 최소 연결을 구현했다. 성장 곡선은 호스트가 이미 사용하던 `OVERLAY_GROWTH_RULES`를 주입하며 계산 코드를 수정하지 않았다.
- Semantic: 임시 SQLite에서 펫룸 선택 → 실행 중 Rust 전환 → 별빛마법사 stage2 → 같은 EPIC의 다람쥐 stage1 → 재연결 유지를 검증했다. 기존 XP 보존, 미보유, 알 수 없는 ID, 조회 실패, 전투창 외 IPC 차단도 검증한다.
- Mechanical: `npm run build`, 공통 검증 게이트(포맷·타입·패키지 테스트 224개), `ELECTRON_RUN_AS_NODE=1 electron --test apps/desktop/test/battle-runtime.test.cjs`(5개) 통과. scene 집중 커버리지는 라인 96.88%, 분기 88.73%이며 전체 앱 수치가 아니다.
- 검증 이슈: 전체 `test:storage`는 43개 중 42개 통과. 기존 `token-client.test.cjs:234`의 scope 예상값에 `meta`가 누락되어 1개 실패한다. 해당 테스트와 migration은 이번 변경 전과 같으며 토큰 담당 파일은 수정하지 않았다. 테스트 수에는 공유 선택 테스트의 두 실행이 포함된다.
- Reviewer: 같은 세션에서 별도 diff 검토를 수행했다. 선택 실패 시 성공 이벤트를 보내지 않음, 공통 DB·성장·토큰 구현 미변경, 실제 에셋 파일 존재, 종 조회 실패 전 sidecar 미실행을 확인했다. 별도 리뷰 에이전트는 사용하지 않았다.
- Evolve: 활성 펫은 종 ID가 아닌 공통 ownedPetId로 연결하며, 그림은 등급이 아니라 실제 종과 저장된 진화 단계로 결정한다.
- 제한: 사용자 DB·실제 GUI를 조작하지 않는다. 예전 JSON에만 있는 개체의 이관과 오버레이 성장 저장소의 공통 성장 반영은 해당 담당자의 별도 작업이다.
