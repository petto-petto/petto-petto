/** 보유 펫 명부·활성 펫·스프라이트 규칙의 실행 증거. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { petId } from '@pet/core';
import {
  activeCandidate,
  activePet,
  auraOf,
  auraRingsAt,
  AURA_PULSE_STEPS,
  AURA_ROUNDNESS,
  collectionFromRecords,
  discoveredSpeciesCount,
  findOwnedPet,
  frameIndexAt,
  growthSeeds,
  isMotionFinished,
  motionDurationMs,
  petAssetPath,
  PET_SPECIES,
  pickClickMotion,
  roomPetViews,
  speciesOf,
  spriteMetaPath,
  stageForEvolution,
  UnknownOwnedPetError,
  UnknownSpeciesError,
  withActivePet,
  withPetGrowth,
  type OwnedPetRecord,
  type PetGrowth,
  type RoomCollection,
  type SpriteMeta,
} from '@pet/room';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * 에셋 루트. 도메인 함수가 내는 경로는 **이 디렉터리 기준**이다.
 *
 * 런타임에는 창을 여는 쪽이 `?assets=` 로 알려 주고, 테스트에서는 워크스페이스 배치를 알고
 * 있으므로 직접 짚는다.
 */
const assetsDir = join(here, '..', '..', '..', 'apps', 'desktop', 'renderer', 'assets');

/** 여섯 종이 한 마리씩 있는 명부. stage 1·2·3과 등급 3종이 모두 들어 있다. */
function sampleCollection(): RoomCollection {
  const pet = (id: string, species: string, level: number, evolutionStage: 0 | 1 | 2) => ({
    id,
    speciesPetId: petId(species),
    level,
    evolutionStage,
  });
  return {
    pets: [
      pet('p1', '003', 3, 0),
      pet('p2', '004', 7, 0),
      pet('p3', '005', 20, 1),
      pet('p4', '002', 28, 1),
      pet('p5', '001', 40, 2),
      pet('p6', '006', 16, 0),
    ],
    activePetId: 'p6',
  };
}

function record(overrides: Partial<OwnedPetRecord> & { ownedPetId: string }): OwnedPetRecord {
  return {
    speciesId: '003',
    level: 1,
    evolutionStage: 0,
    nickname: null,
    isActive: false,
    ...overrides,
  };
}

/* ---------- 종 카탈로그 ---------- */

test('종 카탈로그는 실제 에셋의 pet.json과 어긋나지 않는다', () => {
  for (const species of PET_SPECIES) {
    const path = join(assetsDir, 'pets', species.rarity.toLowerCase(), species.slug, 'pet.json');
    const asset = JSON.parse(readFileSync(path, 'utf8')) as {
      petId: string;
      slug: string;
      name: string;
      grade: string;
    };
    assert.equal(asset.petId, species.petId, `${species.slug}의 petId가 다르다`);
    assert.equal(asset.slug, species.slug);
    assert.equal(asset.name, species.name, `${species.slug}의 표시명이 다르다`);
    assert.equal(asset.grade, species.rarity, `${species.slug}의 등급이 다르다`);
  }
});

test('petId는 종마다 유일하다 — 겹치면 도감 진행도가 틀어진다', () => {
  const ids = PET_SPECIES.map((species) => species.petId);
  assert.equal(new Set(ids).size, ids.length);
});

test('모르는 종을 조회하면 던진다', () => {
  assert.throws(() => speciesOf(petId('999')), UnknownSpeciesError);
});

/* ---------- 진화 → 단계 ---------- */

test('화면에 뜨는 단계는 레벨이 아니라 진화 횟수가 정한다', () => {
  assert.equal(stageForEvolution(0), 1);
  assert.equal(stageForEvolution(1), 2);
  assert.equal(stageForEvolution(2), 3);

  // 진화하지 않은 고레벨 펫은 1단계 모습 그대로다. 레벨로 유도하면 펫룸만 3단계로 그려
  // 오버레이와 다른 그림이 된다 — 바로 그 불일치를 막는 규칙이다.
  const notEvolved = {
    pets: [{ id: 'a', speciesPetId: petId('006'), level: 25, evolutionStage: 0 as const }],
    activePetId: 'a',
  };
  assert.equal(roomPetViews(notEvolved)[0]?.stage, 1);
});

/* ---------- 성장 투영 ---------- */

test('레벨과 진화 단계는 성장 저장소가 정하고 명부는 그 값을 받아 적는다', () => {
  const growth = new Map<string, PetGrowth>([['p1', { level: 11, evolutionStage: 1 }]]);
  const after = withPetGrowth(sampleCollection(), growth);

  const moved = after.pets.find((pet) => pet.id === 'p1');
  assert.equal(moved?.level, 11);
  assert.equal(moved?.evolutionStage, 1);
  assert.equal(roomPetViews(after).find((view) => view.ownedPetId === 'p1')?.stage, 2);

  // 성장 기록이 없는 개체는 건드리지 않는다.
  const untouched = sampleCollection().pets.find((pet) => pet.id === 'p2');
  assert.deepEqual(
    after.pets.find((pet) => pet.id === 'p2'),
    untouched,
  );
  // 명부에 없는 개체가 와도 무시한다.
  assert.equal(
    withPetGrowth(sampleCollection(), new Map([['nope', { level: 9, evolutionStage: 0 as const }]]))
      .pets.length,
    6,
  );
});

test('성장 저장소에 넘기는 씨앗은 종 slug 를 펫 key 로 쓴다', () => {
  const seeds = growthSeeds(sampleCollection());
  assert.equal(seeds.length, 6);

  const wizard = seeds.find((seed) => seed.ownedPetId === 'p6');
  // 오버레이 카탈로그의 key 와 같은 값이라 변환 표가 필요 없다.
  assert.equal(wizard?.petKey, 'star_wizard');
  assert.equal(wizard?.displayName, '별빛마법사');
  assert.equal(wizard?.level, 16);
  assert.equal(wizard?.evolutionStage, 0);
});

/* ---------- 명부와 활성 펫 ---------- */

test('보유 개체 목록을 명부로 바꾸면 활성 펫이 정확히 하나다', () => {
  const { collection, skipped } = collectionFromRecords([
    record({ ownedPetId: 'a', speciesId: '003' }),
    record({ ownedPetId: 'b', speciesId: '006', level: 16, isActive: true, nickname: '별이' }),
  ]);
  assert.deepEqual(skipped, []);
  assert.equal(collection.activePetId, 'b');
  assert.equal(activePet(collection)?.nickname, '별이');
  assert.equal(roomPetViews(collection).filter((view) => view.isActive).length, 1);
  // 별명이 없으면 키 자체가 없다 — exactOptionalPropertyTypes와 맞춘다.
  assert.ok(!('nickname' in (collection.pets[0] as object)));
});

test('보유 펫이 없으면 명부도 활성 펫도 비어 있다', () => {
  const { collection } = collectionFromRecords([]);
  assert.deepEqual(collection, { pets: [], activePetId: null });
  assert.equal(activePet(collection), null);
  assert.deepEqual(roomPetViews(collection), []);
  assert.equal(activeCandidate(collection), null);
});

test('펫룸이 모르는 종은 빼고, 뺀 개체를 알려 준다', () => {
  const { collection, skipped } = collectionFromRecords([
    record({ ownedPetId: 'a', speciesId: '999', isActive: true }),
    record({ ownedPetId: 'b', speciesId: '004' }),
  ]);
  assert.deepEqual(
    collection.pets.map((pet) => pet.id),
    ['b'],
  );
  assert.deepEqual(
    skipped.map((pet) => pet.ownedPetId),
    ['a'],
  );
  // 빠진 개체가 활성이었으면 활성이 없는 것으로 본다. 첫 마리를 세우는 것은 호출한 쪽이다.
  assert.equal(collection.activePetId, null);
  assert.equal(activeCandidate(collection), 'b');
});

test('활성이 이미 있으면 새로 세울 개체가 없다', () => {
  assert.equal(activeCandidate(sampleCollection()), null);
});

test('활성 펫을 바꾸면 이전 활성은 자동으로 풀린다', () => {
  const before = sampleCollection();
  const after = withActivePet(before, 'p1');

  assert.equal(after.activePetId, 'p1');
  const actives = roomPetViews(after).filter((view) => view.isActive);
  assert.equal(actives.length, 1);
  assert.equal(actives[0]?.ownedPetId, 'p1');
  // 원본은 건드리지 않는다.
  assert.equal(before.activePetId, 'p6');
});

test('명부에 없는 펫은 활성으로 지정할 수 없다', () => {
  assert.throws(() => withActivePet(sampleCollection(), 'nope'), UnknownOwnedPetError);
  assert.throws(() => findOwnedPet(sampleCollection(), 'nope'), UnknownOwnedPetError);
});

test('도감 진행도는 마리 수가 아니라 종 수다 (에셋 가이드 §9)', () => {
  const collection = sampleCollection();
  assert.equal(discoveredSpeciesCount(collection), 6);

  const duplicated = {
    pets: [
      ...collection.pets,
      { id: 'extra', speciesPetId: petId('006'), level: 5, evolutionStage: 0 as const },
    ],
    activePetId: collection.activePetId,
  };
  assert.equal(duplicated.pets.length, 7);
  assert.equal(discoveredSpeciesCount(duplicated), 6);
});

test('닉네임이 있으면 종 이름 대신 닉네임을 보여준다', () => {
  const collection = {
    pets: [
      {
        id: 'a',
        speciesPetId: petId('006'),
        level: 21,
        evolutionStage: 2 as const,
        nickname: '별이',
      },
    ],
    activePetId: 'a',
  };
  assert.equal(roomPetViews(collection)[0]?.name, '별이');
});

/* ---------- 스프라이트 규칙 ---------- */

test('경로는 등급 소문자 폴더로 조립되고, 조립한 파일이 실제로 존재한다', () => {
  const path = petAssetPath('EPIC', 'star_wizard', '006', 3, 'idle');
  // 에셋 루트 기준 상대 경로다. `assets/` 접두사는 붙지 않는다 — 루트가 어디인지는
  // `?assets=` 로 주입되고 도메인은 모른다.
  assert.equal(path, 'pets/epic/star_wizard/stage3/pet_006_s3_idle.png');
  assert.ok(!path.startsWith('/'), 'loadFile 앱에서 선두 슬래시는 파일 시스템 루트다');

  for (const species of PET_SPECIES) {
    for (const stage of [1, 2, 3] as const) {
      for (const motion of ['idle', 'click', 'click2', 'attack'] as const) {
        const relative = petAssetPath(species.rarity, species.slug, species.petId, stage, motion);
        readFileSync(join(assetsDir, relative));
        readFileSync(join(assetsDir, spriteMetaPath(relative)));
      }
      readFileSync(
        join(assetsDir, petAssetPath(species.rarity, species.slug, species.petId, stage, 'card')),
      );
    }
  }
});

test('모션 메타의 frameWidth × frameCount가 실제 PNG 폭과 맞는다', () => {
  // 시트가 가로 1행이라는 §4의 전제. 어긋나면 프레임이 어긋나 잘린다.
  for (const species of PET_SPECIES) {
    for (const stage of [1, 2, 3] as const) {
      const png = petAssetPath(species.rarity, species.slug, species.petId, stage, 'idle');
      const meta = JSON.parse(
        readFileSync(join(assetsDir, spriteMetaPath(png)), 'utf8'),
      ) as SpriteMeta;
      assert.equal(meta.columns, meta.frameCount, `${species.slug} s${stage}: 가로 1행이 아니다`);

      // PNG 헤더(IHDR)의 폭·높이를 직접 읽는다.
      const bytes = readFileSync(join(assetsDir, png));
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      assert.equal(
        width,
        meta.frameWidth * meta.frameCount,
        `${species.slug} s${stage}: 시트 폭 불일치`,
      );
      assert.equal(height, meta.frameHeight, `${species.slug} s${stage}: 시트 높이 불일치`);
    }
  }
});

test('card는 메타가 없다 — 없는 json을 찾으면 실패한다 (에셋 가이드 §5)', () => {
  const card = petAssetPath('EPIC', 'star_wizard', '006', 3, 'card');
  assert.throws(() => readFileSync(join(assetsDir, spriteMetaPath(card))));
});

const idleMeta: SpriteMeta = {
  frameWidth: 32,
  frameHeight: 32,
  frameCount: 4,
  columns: 4,
  fps: 6,
  loop: true,
};
const clickMeta: SpriteMeta = { ...idleMeta, frameCount: 5, columns: 5, fps: 9, loop: false };

test('루프 모션은 프레임을 순환한다', () => {
  assert.equal(frameIndexAt(idleMeta, 0), 0);
  assert.equal(frameIndexAt(idleMeta, 166), 0);
  assert.equal(frameIndexAt(idleMeta, 167), 1);
  // 4프레임 / 6fps ≈ 666ms에 한 바퀴.
  assert.equal(frameIndexAt(idleMeta, 667), 0);
});

test('1회 재생 모션은 마지막 프레임에서 멈춘다 — 루프로 처리하면 재생 끝에 튄다', () => {
  assert.equal(frameIndexAt(clickMeta, 0), 0);
  assert.equal(frameIndexAt(clickMeta, 10_000), clickMeta.frameCount - 1);
  assert.equal(frameIndexAt(clickMeta, Number.MAX_SAFE_INTEGER), clickMeta.frameCount - 1);
});

test('1회 재생의 끝을 판정할 수 있고, 루프 모션은 끝나지 않는다', () => {
  const duration = motionDurationMs(clickMeta);
  assert.equal(duration, (5 / 9) * 1000);
  assert.equal(isMotionFinished(clickMeta, duration - 1), false);
  assert.equal(isMotionFinished(clickMeta, duration), true);
  assert.equal(isMotionFinished(idleMeta, 10_000), false);
});

test('click과 click2가 모두 뽑힌다 — 한 종만 쓰면 반복 클릭이 죽어 보인다', () => {
  assert.equal(pickClickMotion(0), 'click');
  assert.equal(pickClickMotion(0.49), 'click');
  assert.equal(pickClickMotion(0.5), 'click2');
  assert.equal(pickClickMotion(0.999), 'click2');
  // 경계값 1.0이 들어와도 배열 밖을 짚지 않는다.
  assert.equal(pickClickMotion(1), 'click2');
});

/* ---------- 활성 펫 오라 ---------- */

test('등급이 올라갈수록 오라가 두껍고 느리다 — 가챠의 등급 연출과 같은 눈금이다', () => {
  const common = auraOf('COMMON');
  const rare = auraOf('RARE');
  const epic = auraOf('EPIC');

  assert.deepEqual(
    [common.token, rare.token, epic.token],
    ['common', 'rare', 'epic'],
    '색 토큰은 CSS 의 --grade-* 이름과 같아야 한다',
  );
  assert.ok(common.rings < rare.rings && rare.rings < epic.rings);
  assert.ok(common.periodMs < rare.periodMs && rare.periodMs < epic.periodMs);
  // 가챠 `introDuration` 과 같은 값에서 시작한다.
  assert.deepEqual([common.periodMs, rare.periodMs, epic.periodMs], [1_800, 2_400, 3_200]);
});

test('오라는 바깥으로 갈수록 옅어지고, 고리는 겹치지 않는다', () => {
  const spec = auraOf('EPIC');
  const rings = auraRingsAt(spec, 0, false);

  assert.equal(rings.length, spec.rings);
  for (let index = 1; index < rings.length; index += 1) {
    const inner = rings[index - 1];
    const outer = rings[index];
    assert.ok(inner !== undefined && outer !== undefined);
    assert.ok(outer.offset > inner.offset, '바깥 고리가 더 멀어야 한다');
    assert.ok(outer.alpha < inner.alpha, '바깥 고리가 더 옅어야 한다');
    assert.ok(outer.alpha >= 0);
  }
});

test('오라는 실루엣보다 부풀어 있다 — 0이면 팔·다리를 그대로 따라가 빛으로 안 읽힌다', () => {
  assert.ok(AURA_ROUNDNESS > 0);
  // 가장 안쪽 고리조차 실루엣에서 이만큼은 떨어져 있어야 좁은 홈이 메워진다.
  assert.ok(AURA_ROUNDNESS >= 2, '너무 작으면 부풀린 티가 안 난다');
});

test('등급 고리는 금색 선택 림보다 바깥에 있다 — 같은 자리면 등급 색이 통째로 가려진다', () => {
  for (const rarity of ['COMMON', 'RARE', 'EPIC'] as const) {
    const first = auraRingsAt(auraOf(rarity), 0, false)[0];
    assert.ok(first !== undefined);
    // 금색 림은 1px 다. 실제로 2px 에 두었더니 COMMON 회색이 화면에서 사라졌다.
    assert.ok(first.offset > 1, `${rarity}: 가장 안쪽 등급 고리가 금색 림에 겹친다`);
  }
});

test('맥동은 칸으로 움직인다 — 연속으로 밝히면 도트 화면에서 색이 뭉개진다', () => {
  const spec = auraOf('RARE');
  const seen = new Set<number>();
  // 두 주기를 훑어도 나타나는 밝기는 칸 수만큼뿐이다.
  for (let elapsed = 0; elapsed < spec.periodMs * 2; elapsed += 10) {
    const first = auraRingsAt(spec, elapsed, false)[0];
    assert.ok(first !== undefined);
    seen.add(first.alpha);
  }
  assert.ok(seen.size <= AURA_PULSE_STEPS + 1, `밝기 종류가 ${seen.size}가지다`);
});

test('움직임을 줄여 달라고 하면 맥동이 멈추되 오라는 사라지지 않는다', () => {
  const spec = auraOf('COMMON');
  const still = auraRingsAt(spec, 0, true);

  for (const elapsed of [0, 400, 900, 1_700, 5_000]) {
    assert.deepEqual(auraRingsAt(spec, elapsed, true), still, '멈춘 오라는 시각에 흔들리지 않는다');
  }
  // 선택 표시는 정보라서 없앨 수 없다. 없애도 되는 것은 움직임뿐이다(design.md §8).
  assert.equal(still.length, spec.rings);
  assert.ok(still[0] !== undefined && still[0].alpha > 0);
});
