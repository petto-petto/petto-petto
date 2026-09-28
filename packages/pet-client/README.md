# PetClient

같은 계약 패키지의 `TokenClient`는 AI 도구의 누적 사용량과 소비 가능한 공유 재화
잔액을 함께 제공한다. 사용량 통계는 소비해도 줄어들지 않는다. 뽑기·합성은
`TokenClient.balance()`와 `spendOnce()`를 사용하고, host가 같은 SQLite
트랜잭션 안에서 펫 Client 작업과 재화 차감을 묶는다.

펫 관련 기능에서 사용하는 공통 CRUD 인터페이스다. 종류 목록, 보유 개체, 성장 저장, 활성 선택과 합성 결과 저장을 제공한다.

```text
소비 기능 → PetClient → SqlitePetClient → PetRepository → 기존 petto.sqlite
```

`PetClient`만 인터페이스이고, `PetRepository`는 구체 클래스다. 이 패키지는 타입만 제공하며 Electron이나 SQLite 드라이버를 가져오지 않는다.

## 연결 방법

소비 패키지의 `dependencies`에 `"@pet/client": "*"`를 추가하고, TypeScript project reference에 `../pet-client`를 추가한다. 기능 코드에서는 인터페이스만 받는다.

```ts
import type { PetClient } from '@pet/client';

export function loadFusionMaterials(pets: PetClient) {
  return pets.listOwnedPets();
}
```

desktop host에서는 이미 열린 공용 DB로 한 번 조립한 뒤 필요한 기능에 전달한다. 아래 상대 경로는 `apps/desktop/src/main/` 기준이다.

```ts
import type { PetClient } from '@pet/client';
import { SqlitePetClient } from './clients/sqlite-pet-client.ts';
import { PetRepository } from './persistence/repositories/pet-repository.ts';

const pets: PetClient = new SqlitePetClient(new PetRepository(appDatabase));
// 각 기능의 생성자나 초기화 함수에 pets를 전달한다.
```

Repository가 DB를 새로 열거나 종료하지 않는다. `APP_MIGRATIONS`에는 `pet` migration이 등록되어 있어 기존 앱 시작 경로에서 두 테이블과 6종의 카탈로그가 생성된다. 기본 보유 개체는 지급하지 않는다. 기존 펫룸·성장 저장소의 데이터를 자동 이관하거나 기존 소비 기능을 전환하지 않으므로 각 담당자가 연결해야 한다.

## 사용 예

```ts
// 뽑기 기능이 등급과 종류를 결정하고 저장한다.
const candidates = pets.listSpecies('COMMON');
const count = pets.countSpecies('COMMON');
// candidates에서 뽑은 종류 ID를 전달한다. 동일 종류를 여러 번 뽑아도 된다.
const [first, second] = pets.createOwnedPets(['003', '003']);

// 특정 개체 선택·별명 수정.
if (first) {
  pets.setActivePet(first.ownedPetId);
  pets.updateNickname(first.ownedPetId, '모찌');
}

// 성장 기능이 계산한 네 값을 함께 저장한다.
if (second) {
  pets.updateGrowth(second.ownedPetId, {
    level: 2,
    totalXp: 12,
    xpIntoLevel: 2,
    evolutionStage: 0,
  });
}
```

합성 기능은 필요한 개체 수·등급·비용을 검증하고 결과 종류를 추첨한 뒤 `replaceOwnedPets(materialOwnedPetIds, resultSpeciesId)`를 호출한다. 재료 삭제와 결과 생성은 하나의 트랜잭션이며, 실패하면 전부 취소된다. 활성 개체·없는 개체·중복 개체 ID·빈 재료 목록은 거부한다. 성공 결과는 레벨 1·XP 0·진화 0·별명 없음·비활성이다.

## 계약 요약

- 모든 메서드는 동기식이다. 메서드와 반환 타입은 [src/index.ts](src/index.ts)에 있다.
- `speciesId`는 종류 ID(`'003'`), `ownedPetId`는 한 마리의 UUID다.
- `OwnedPet`은 종류 정보까지 결합한 결과다. 표시 이름은 `nickname ?? name`이다.
- `sprite`, `rarity`, `speciesId`와 `evolutionStage + 1`을 기존 에셋 경로 함수에 사용할 수 있다.
- `listSpecies()`와 `listOwnedPets()`는 필터 생략 시 전체를 조회한다. `createOwnedPets([])`는 아무것도 생성하지 않고 `[]`를 반환한다.
- `countOwnedSpecies()`와 `getHighestLevel()`은 현재 보유 기준이다. 과거 발견·역대 최고 기록이 아니다.
- 빈 목록은 `[]`, 빈 집계는 `0`, 미선택 활성 펫은 `null`이다. 없는 개체의 단건 조회·변경과 DB 실패는 예외를 던진다.
- 성장 값의 기본 정수·범위를 검사하지만 XP 공식, 진화 조건, 뽑기·합성 규칙은 호출자가 담당한다.
- XP 증가 알림은 성장 담당이 저장 성공 후 기존 방식으로 전달한다. 이 모듈은 이벤트를 발행하지 않는다.
- 트랜잭션은 한 호출의 원자성을 보장한다. 성공한 생성 요청을 다시 호출하면 새 개체가 생성되므로 성공 응답 후 같은 저장을 반복하지 않는다.

검증: `npm run test:storage --workspace @pet/desktop`, `bash .harness/scripts/verify-electron.sh`.
