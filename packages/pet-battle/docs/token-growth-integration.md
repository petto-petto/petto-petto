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

아래는 일반 연결 계약 예시다. 현재 전체 앱의 조립은 `apps/desktop/src/main/battle.ts`에서 수행하며, 허용된 전투창의 명령만 처리한다.

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
- 독립 demo는 시각 확인용이다. `npm start`는 Rust 엔진을 빌드하고 공통 `PetClient`를 주입한다.
- 펫룸은 공통 보유 목록을 표시하며 `setActivePet` 저장 성공 후 선택을 알린다. 전투는 다음 상태 조회에서 같은 개체로 전환한다.
- 호스트는 공통 종 목록과 원본 에셋의 프레임 메타를 사용해 종·진화 단계별 이미지를 제공한다. 등급별 대표 이미지는 독립 demo와 명시적인 미리보기 버튼에만 사용한다.
- 기존 room JSON은 삭제·이관·이중 기록하지 않는다. JSON에만 있는 시드 펫은 공통 보유 펫으로 간주하지 않으며, 공통 목록이 비어 있으면 빈 상태로 표시한다.

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
