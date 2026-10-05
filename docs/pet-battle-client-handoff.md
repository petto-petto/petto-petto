# 공통 클라이언트 → 전투 연결

## 전투의 역할

`RoomSelectionClient 선택 + PetClient 저장 성장 → 전투 Adapter → Electron 내부 TypeScript 엔진 → 화면`

기본 앱과 Electron 데모는 Cargo/Rust를 실행하지 않습니다. 상세 실행·폴더 안내는 [전투 패키지 README](../packages/pet-battle/README.md)를 따릅니다.

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

소비자가 사용하는 전투 소유 인터페이스는 `BattleClient`다. 계약 전용 진입점은 타입만 제공하며 DB 연결이나 외부 프로세스를 만들지 않는다.

```ts
import type { BattleClient } from '@pet/battle/client';

function readBattle(client: BattleClient) {
  return client.execute({ type: 'GET_STATE', nowMs: Date.now() });
}
```

- `BattleClientCommand`는 조회·전투 시작/중지·미리보기·표시 설정의 기존 14개 명령만 허용한다.
- 펫 선택 저장·명부 변경·XP 지급·엔진 동기화 명령은 공개 계약에서 제외한다. IPC와 직접 integration 호출은 같은 허용 정책으로 차단한다. IPC에서는 명령 검사 후에만 내부 런타임을 생성한다.
- 내부 `BattleGateway`는 전체 엔진 프로토콜을 유지한다. 외부 소비자가 이 저수준 API로 다른 기능의 저장 책임을 대신하지 않는다.
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
- 전투는 Electron 내부 엔진만 사용한다. 외부 바이너리·빌드 준비 옵션은 없다.
- `BattleLifecyclePort`는 등록 해제 함수를 반환하는 `onQuit`·`onWindowClosed` 두 신호다. 준비된 런타임은 유지하므로 재개방 시 STOP·투명도·미리보기가 초기화되지 않는다. 앱 종료는 IPC·런타임과 신호 구독을 정리한다.
- 전투창은 `@pet/battle/ui/host-preload.cjs`로 `window.petBattle.execute()`만 노출한다. `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`를 유지한다. 독립 데모의 `preload.cjs`와 바꾸어 쓰지 않는다.
- 창 크기는 `@pet/battle/ui/window-options.json`을 데모와 공유한다. 실제 창 생성·종료·폰트 주입은 호스트 책임이다.
- GUI 없이도 `createBattleRuntime(pets, { petAssetsDir, levelXpCosts })`를 생성하고 `execute()` / `close()`를 호출할 수 있다. 기존 동기 카탈로그 검증을 유지하며 기본 경로에는 별도 엔진 파일이 필요하지 않다.
- 현재 앱은 룸의 선택을 읽기 전용 `selection` Client로 전달한다. `selection` 미주입 소비자만 공통 `PetClient.setActivePet(ownedPetId)` 저장을 따라간다. 전투는 선택을 대신 저장하거나 JSON 명부를 이관하지 않는다. 메인 오버레이 연결은 별도 범위다.
- 성장 담당자의 저장 성공 후 다음 전투 조회에서 자동 반영된다. 기존 저수준 `PetBattleIntegration`을 직접 사용하는 호출자는 `syncActivePet()`으로 즉시 재조회할 수도 있다.
- 기존 호출부 호환용 `applyGrowthXp({ ownedPetId, amount, nowMs })`도 저장값 재조회만 한다. `amount`는 가산하지 않으며 다른 펫 알림은 무시한다.
- 공통 클라이언트에는 구독 API가 없으므로 전투가 존재하지 않는 이벤트 API를 가정하지 않는다.
- 종료 시 `closeBattle()`은 IPC를 해제하고 런타임을 종료한다. 반복 호출은 안전하며 종료된 연결은 다시 생성되지 않는다.
- 저수준 `PetBattleIntegration`의 세 번째 인자는 필수 `BattleGrowthRules`, 네 번째는 선택적 `RoomSelectionClient`다. Node 진입점 사용 시 레거시 `intervalLevels` 필드는 패키지가 자체 설정에서 가져온다.

## 전투 진행과 화면

- 내부 TypeScript 엔진은 주입된 성장 곡선과 모든 등급 공통 `[2, 2, 3]` 레벨 상당 XP 구간으로 HP·스테이지를 계산한다. 각 색의 소·중·대를 거쳐 Lv.50에 21단계를 정복한다. 전투 단계는 [하네스 전투 명세](../.harness/specs/features/2026-09-30-battle-integration.md)를 따른다.
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
npm run test:electron --workspace @pet/battle
```

패키지 통합 테스트는 읽기 전용 PetClient 계약 fixture와 TypeScript 엔진을 연결한다.
HP·정복·다음 적·배경, 중복 알림, 재연결, 활성 해제를 확인한다. 다른 기능 구현체나 사용자 DB를 쓰지 않는다.
따라서 전체 앱·실제 SQLite·GUI 검증을 대체하지 않는다.
