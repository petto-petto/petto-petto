# 공통 클라이언트 → 전투 연결

## 전투의 역할

`PetClient 저장값 → PetBattleIntegration → Rust 전투 → 화면`

- 공개 타입은 `@pet/client`에서 가져오고, 구현체는 호스트가 주입한다.
- 전투가 호출하는 공통 API는 `getActivePet()`와 `listOwnedPets()`뿐이다.
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

아래는 연결 계약 예시이며, 다른 담당자의 앱 코드를 이 문서 작업에서 수정했다는 의미가 아니다.

```ts
import type { PetClient } from '@pet/client';
import { PetBattleIntegration, battleHandlers, spawnBattleSidecar } from '@pet/battle';

// pets: 호스트에서 생성한 PetClient 구현체
// levelXpCosts: 성장 담당자가 제공한 레벨별 필요 XP 배열
// intervalLevels: 전투 battle-rules.json의 등급별 정복 간격
const { client: engine, sidecar } = spawnBattleSidecar(binaryPath);
const battle = new PetBattleIntegration(pets, engine, {
  levelXpCosts,
  intervalLevels,
});
const handlers = battleHandlers(battle, host);
```

- 호스트는 반환된 핸들러를 IPC에 등록하고, 전투 창의 요청만 허용한다. `host.broadcast`는 전투 상태를 renderer로 전달한다.
- 펫룸·오버레이 담당자는 선택한 개체를 공통 `PetClient.setActivePet(ownedPetId)`로 저장해야 한다. 전투는 선택을 대신 저장하거나 별도 JSON 명부를 이관하지 않는다.
- 성장 담당자의 저장 성공 후 `battle.syncActivePet()` 결과를 화면에 전달한다. 다음 전투 조회에서도 자동 반영된다.
- 기존 호출부 호환용 `applyGrowthXp({ ownedPetId, amount, nowMs })`도 저장값 재조회만 한다. `amount`는 가산하지 않으며 다른 펫 알림은 무시한다.
- 공통 클라이언트에는 구독 API가 없으므로 전투가 존재하지 않는 이벤트 API를 가정하지 않는다.
- 종료 시 `sidecar.close()`를 호출한다.
- 생성자의 세 번째 인자는 이제 필수 `BattleGrowthRules`다. 예전 난수 함수 인자를 사용한 호출부는 변경해야 한다.

## 전투 진행과 화면

- Rust는 주입된 성장 곡선과 COMMON 12 / RARE 10 / EPIC 8레벨 상당 XP 구간으로 HP·스테이지를 계산한다.
- 최초 조회·재연결은 현재 진행도로 복원한다. 과거 정복 연출을 재생하지 않는다.
- 실행 중 정복은 HP 0 → 처치 연출 → 클릭 → 다음 적·배경 전환이다.
- 독립 demo는 시각 확인용이다. 공통 앱의 실제 연결 여부는 호스트의 위 주입 여부에 달려 있다.

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

- Track: standard. Seed: 공개 PetClient/TokenClient handoff 및 전투 폴더만 수정하라는 사용자 요구.
- Explorer: 기존 delta 기반 어댑터가 저장된 누적 XP를 읽지 않고, 활성 해제 때 이전 펫을 유지하는 경로를 확인했다.
- Planner / Implementer: 실패 테스트를 먼저 커밋하고 기존 읽기 전용 gateway로 통합했다.
- Verifier / Mechanical: 포맷·타입·전체 패키지 테스트 217개, Rust 테스트 26개, 새 실제 엔진 통합 테스트 1개 통과.
- Verifier / Semantic: 155 → 156 XP에서 HP 0·정복, 클릭 후 주황 적, 684 XP 재연결 시 4스테이지·수정 유적을 확인했다. 중복 알림과 활성 해제도 통과했다.
- 측정: 전투 integration 디렉터리 집중 테스트 6개의 라인 커버리지 100%, 분기 96.55%. 전체 앱 커버리지 수치가 아니다.
- Reviewer: 별도 에이전트 없이 같은 세션에서 변경 diff·호출부·소유권 경계를 검토했다. 이번 변경은 전투 패키지 안에만 있으며 GUI·사용자 DB는 검증하지 않았다.
- Evolve: 통계 값과 성장 값을 분리하고, 전투의 공개 연결 지점을 이 문서에 한정한다.
- 이전 문서에 기술한 앱·펫룸·토큰 저장 구현은 전투의 책임에서 제외했다. 이전 전투 밖 24파일 변경의 원복은 별도 승인 대상이다.
