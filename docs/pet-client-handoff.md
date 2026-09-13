# 공통 펫 데이터 모듈 — 작업 내용 및 사용 안내

공유일: 2026-09-13

## 무엇이 준비됐나요?

펫 데이터를 SQLite에 저장하고 조회하는 **공통 `PetClient` 모듈을 구현했습니다.** 각 기능에서 `PetClient`를 주입받아 사용하면 됩니다.

- 펫 종류 목록·등급별 목록과 개수 조회
- 보유 펫 목록·단건·활성 펫 조회
- 뽑기 결과 개체 저장
- 별명·성장 값 수정, 활성 펫 변경
- 합성 재료 삭제와 결과 펫 저장을 한 트랜잭션으로 처리
- 최초 실행 시 테이블과 기본 펫 종류 6종 등록

공통 모듈 구현과 테스트를 완료했습니다. **기존 화면·feature의 호출부 연결은 각 담당자의 작업으로 남아 있습니다.** 기존 펫룸 JSON과 성장 DB 데이터를 새 테이블로 자동 이관하지 않습니다.

## 구조와 DB

```text
각 기능 → PetClient 인터페이스 → SqlitePetClient 구현체 → PetRepository → petto.sqlite
```

외부 계약은 `PetClient`입니다. `PetRepository`는 별도 인터페이스 없이 구현한 구체 클래스입니다.

| 구성                          | 위치                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| 공개 인터페이스와 데이터 타입 | [packages/pet-client/src/index.ts](../packages/pet-client/src/index.ts)                  |
| Client 구현체                 | [sqlite-pet-client.ts](../apps/desktop/src/main/clients/sqlite-pet-client.ts)            |
| Repository                    | [pet-repository.ts](../apps/desktop/src/main/persistence/repositories/pet-repository.ts) |
| 테이블 생성 및 기본 종류 등록 | [migrations/pet.ts](../apps/desktop/src/main/persistence/migrations/pet.ts)              |
| 통합 테스트                   | [pet-client.test.cjs](../apps/desktop/test/pet-client.test.cjs)                          |

기존 공용 `petto.sqlite`에 다음 두 테이블을 추가했습니다.

| 테이블        | 저장 내용                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| `pet_species` | 종류 ID, 기본 이름, 등급, 에셋 폴더 식별자                                |
| `owned_pets`  | 개체 ID, 종류 ID, 별명, 레벨, 누적 XP, 현재 레벨 XP, 진화 단계, 활성 여부 |

기존 migration 등록부에 `pet / 1`을 추가했으므로 앱의 기존 DB 초기화 경로에서 자동 적용됩니다. 재실행 시 중복 적용하지 않습니다. 종류 6종은 COMMON/RARE/EPIC 각 2종이며, **종류 등록과 사용자에게 펫 지급은 별개**입니다. 처음에는 보유 펫이 없고 활성 펫도 없습니다.

## 연결 방법

### 1. 기능 패키지에 타입 의존성 추가

사용할 `packages/<기능>/package.json`의 기존 dependencies에 추가합니다.

```json
{
  "dependencies": {
    "@pet/client": "*"
  }
}
```

같은 패키지의 `tsconfig.json`에서는 기존 references에 다음 항목을 추가합니다.

```json
{
  "references": [{ "path": "../pet-client" }]
}
```

기존 설정을 대체하지 말고 항목만 추가합니다. 의존성을 변경한 후 레포 루트에서 `npm install`을 실행합니다.

### 2. 기능 코드는 PetClient를 전달받기

```ts
import type { PetClient } from '@pet/client';

export function loadMyPets(pets: PetClient) {
  return pets.listOwnedPets();
}
```

함수 인자나 기존 클래스 생성자로 전달받으면 됩니다. `@pet/client`는 타입만 제공하므로 import만으로 DB 연결이나 Client 인스턴스가 생기지는 않습니다.

### 3. 앱에서 구현체 조립 후 기능에 전달

아래는 `apps/desktop/src/main/` 기준 예제입니다. `appDatabase`는 기존 앱이 생성하고 `open()`까지 호출한 공유 DB입니다.

```ts
import type { PetClient } from '@pet/client';
import { SqlitePetClient } from './clients/sqlite-pet-client.ts';
import { PetRepository } from './persistence/repositories/pet-repository.ts';

const pets: PetClient = new SqlitePetClient(new PetRepository(appDatabase));
// 자신의 기능 초기화 함수나 생성자에 pets를 전달합니다.
```

같은 인스턴스를 필요한 기능에 전달해 사용합니다. 각 기능에서 DB를 새로 열거나 닫지 않습니다. SQLite 구현체의 실행 위치는 기존 DB가 있는 main입니다. 화면 코드에서는 해당 기능의 기존 연결 경로를 사용합니다.

## 제공 메서드

모든 메서드는 **동기식**이며 `await` 없이 호출합니다. 쓰기 메서드는 저장된 펫 정보를 반환합니다.

| 메서드                                                   | 반환·동작                                          | 주요 사용자               |
| -------------------------------------------------------- | -------------------------------------------------- | ------------------------- |
| `listSpecies(rarity?)`                                   | 종류 목록. 생략하면 전체                           | 뽑기·합성                 |
| `countSpecies(rarity?)`                                  | 종류 개수. 생략하면 전체                           | 뽑기·설정                 |
| `listOwnedPets(speciesId?)`                              | 보유 개체 목록. 생략하면 전체                      | 합성·펫룸                 |
| `getOwnedPet(ownedPetId)`                                | 개체 단건 정보                                     | 개체 정보를 사용하는 기능 |
| `countOwnedPets()`                                       | 현재 보유 마리 수                                  | 설정·정보                 |
| `countOwnedSpecies()`                                    | 현재 보유한 종류 수                                | 설정·정보                 |
| `getHighestLevel()`                                      | 현재 보유 펫의 최고 레벨. 없으면 0                 | 설정·정보                 |
| `getActivePet()`                                         | 활성 개체 정보. 미선택이면 null                    | 전투·오버레이·설정        |
| `createOwnedPets(speciesIds)`                            | 새 개체 배열. 여러 마리도 전부 성공 또는 전부 취소 | 뽑기                      |
| `updateNickname(ownedPetId, nickname)`                   | 별명 변경. null 또는 공백만 전달하면 별명 제거     | 별명 수정 기능            |
| `updateGrowth(ownedPetId, growth)`                       | 계산된 성장 값 네 개를 함께 저장                   | 성장                      |
| `setActivePet(ownedPetId)`                               | 기존 활성 해제 후 해당 개체 활성화                 | 오버레이·펫룸             |
| `replaceOwnedPets(materialOwnedPetIds, resultSpeciesId)` | 재료 개체 삭제와 결과 개체 생성                    | 합성                      |

등급은 `'COMMON' | 'RARE' | 'EPIC'`입니다. 기존 뽑기·합성 코드의 소문자 등급은 호출 전에 대응하는 대문자 값으로 변환합니다.

## 반환 데이터에서 구분할 것

`speciesId`는 **종류**, `ownedPetId`는 **한 마리**의 ID입니다. 같은 종류를 두 번 뽑으면 speciesId는 같고 ownedPetId는 다릅니다. 선택·성장·별명·합성 재료 지정에는 ownedPetId를 사용합니다.

```ts
import type { OwnedPet } from '@pet/client';

// 실제 조회 결과의 모양을 설명하는 예시입니다.
const pet: OwnedPet = {
  ownedPetId: '개체 UUID',
  speciesId: '003',
  name: '두더지',
  nickname: null,
  rarity: 'COMMON',
  sprite: 'mole_digger',
  level: 1,
  totalXp: 0,
  xpIntoLevel: 0,
  evolutionStage: 0,
  isActive: false,
};
```

표시 이름은 `pet.nickname ?? pet.name`입니다. 종류 정보까지 결합해서 반환하므로 이름·등급을 얻으려고 추가 조회할 필요가 없습니다.

이미지는 기존 에셋 파일을 사용합니다. `sprite`는 에셋 폴더 식별자이고, 진화 단계 `0/1/2`는 에셋의 stage `1/2/3`에 대응합니다. 영어 이름과 다음 레벨 필요 XP는 반환 필드에 없습니다. 다음 레벨 필요 XP는 기존 성장 함수에서 계산합니다.

## 기능별 사용 예제

아래 예제의 `pets`는 위에서 전달받은 `PetClient`입니다.

### 뽑기

```ts
const candidates = pets.listSpecies('COMMON');
const candidateCount = candidates.length;
// 기존 뽑기 기능에서 등급 확률과 candidates 내 1/n 추첨을 수행합니다.
// 아래 ID 배열은 추첨이 끝난 결과의 예시입니다.
const acquired = pets.createOwnedPets(['003', '004', '003']);
```

같은 종류 ID를 여러 번 전달할 수 있습니다. 각 개체는 레벨 1, XP 0, 진화 0, 별명 없음, 비활성 상태로 생성됩니다. 10연 뽑기는 결과 ID 10개를 한 번에 전달하면 됩니다. 후보가 없으면 뽑기 기능에서 중단 처리합니다.

### 합성

```ts
// 선택 화면에 사용할 목록입니다.
const materials = pets.listOwnedPets();

// 합성 기능에서 재료 수·등급·비용 검증과 결과 추첨을 끝낸 뒤 호출합니다.
function saveFusion(selectedOwnedPetIds: string[], resultSpeciesId: string) {
  return pets.replaceOwnedPets(selectedOwnedPetIds, resultSpeciesId);
}
```

재료 ID는 모두 서로 다른 보유 개체여야 합니다. 같은 종류 여러 마리는 가능하지만 같은 개체 ID를 반복할 수는 없습니다. 활성 펫은 재료로 사용할 수 없습니다. 사용하려면 다른 펫을 먼저 활성화해야 합니다.

재료 삭제 또는 결과 생성에 실패하면 **변경 전체가 rollback**됩니다. 성공 후 기존 mock 재고에서도 한 번 더 차감·지급하지 말고, 반환 결과 또는 `listOwnedPets()`로 상태를 갱신합니다. 재료 수·등급·결과 추첨과 재화 차감은 합성 기능의 책임입니다.

### 오버레이·전투·성장

```ts
const active = pets.getActivePet();
if (active) {
  const displayName = active.nickname ?? active.name;
  const assetStage = active.evolutionStage + 1;
  // active.level, active.rarity, active.sprite 등을 기존 표시 코드에 전달합니다.
}
```

```ts
import type { PetGrowth } from '@pet/client';

function saveGrowth(ownedPetId: string, calculatedGrowth: PetGrowth) {
  return pets.updateGrowth(ownedPetId, calculatedGrowth);
}
```

`calculatedGrowth`에는 `level`, `totalXp`, `xpIntoLevel`, `evolutionStage`가 모두 필요합니다. XP 환산·레벨업·진화 조건은 성장 기능에서 계산합니다. `updateGrowth`는 전달된 값을 저장하며 XP를 자동으로 더하지 않습니다.

전투의 XP 증가 알림도 성장 담당이 저장 성공 후 기존 방식으로 전달합니다. `PetClient`에는 이벤트 발행·구독 메서드가 없습니다. 펫룸의 레벨 기반 진화 표시와 오버레이의 진화 기준이 다르므로 연결 시 성장 담당과 기준을 맞춰야 합니다.

### 설정·정보

```ts
const active = pets.getActivePet();
const ownedCount = pets.countOwnedPets();
const ownedSpeciesCount = pets.countOwnedSpecies();
const highestLevel = pets.getHighestLevel();
```

종류 수와 최고 레벨은 **현재 보유 기준**입니다. 과거 발견한 종 수나 역대 최고 레벨로 사용하면 안 됩니다. `countSpecies()`는 DB 등록 종 수이며, 기존 설정의 도감 목표 슬롯 수와 별개입니다.

## 실패·빈 결과 처리

- 보유 목록이 비어 있으면 `[]`, 집계 대상이 없으면 `0`, 활성 선택이 없으면 `null`입니다.
- 없는 개체 단건 조회·수정, 잘못된 성장 값, 잘못된 합성 재료, DB 오류는 예외를 던집니다.
- 별명은 앞뒤 공백을 제거하고 빈 값은 null로 저장합니다.
- 저장 성공을 확인한 뒤 화면 상태를 반영합니다. 성공한 `createOwnedPets`를 다시 호출하면 새 개체가 추가 생성됩니다.

```ts
try {
  const currentPets = pets.listOwnedPets();
  // currentPets로 화면 상태를 갱신합니다.
} catch (error) {
  const message = error instanceof Error ? error.message : '펫 조회에 실패했습니다.';
  // 해당 기능의 기존 오류 표시 경로에 message를 전달합니다.
}
```

## 연결 담당자가 할 일

1. 자신의 패키지에 `@pet/client` 타입 의존성을 추가합니다.
2. 앱 초기화 코드에서 조립한 Client를 자신의 기능에 전달합니다.
3. 기존 펫 mock 조회·저장 호출을 필요한 Client 메서드로 교체합니다.
4. 기존 데이터 보존이 필요하면 종류 키와 개체 ID를 확인해 이관합니다. 같은 펫 값을 기존 저장소와 새 DB 양쪽에 계속 쓰지 않도록 전환합니다.

초기 보유 펫 지급, 기존 사용자 데이터 자동 이관, 재화·확률·성장 계산은 이번 공통 모듈에 포함하지 않았습니다. 설정 요구사항 링크는 접근하지 못했으며 설정 관련 메서드는 기존 meta 코드에서 확인한 요구를 기준으로 제공합니다.

## 검증

실제 임시 SQLite 파일을 사용하여 신규 테스트 9개를 추가했습니다. 종류 seed와 에셋 정보 일치, 재연결 후 보존, 개체 분리, 활성 선택, 합성·다중 생성 rollback, 기존 성장 데이터 보존, migration 실패 복구를 검증했습니다.

- `npm run test:storage --workspace @pet/desktop`: 저장소 테스트 17개 통과.
- `bash .harness/scripts/verify-electron.sh`: 형식·타입 검사 통과, 패키지 테스트 163개 통과.

검증 범위는 공통 데이터 모듈입니다. 각 feature 화면에 연결한 뒤에는 해당 기능의 동작도 별도로 확인해야 합니다.
