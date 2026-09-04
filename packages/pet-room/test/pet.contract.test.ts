/** 보유 펫 명부·활성 펫·스프라이트 규칙·영속의 실행 증거. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { petId } from '@pet/core';
import {
  activePet,
  discoveredSpeciesCount,
  findOwnedPet,
  frameIndexAt,
  fromSnapshot,
  isMotionFinished,
  mockXpRatio,
  motionDurationMs,
  petAssetPath,
  PET_SPECIES,
  pickClickMotion,
  roomPetViews,
  seedCollection,
  speciesOf,
  spriteMetaPath,
  stageOfLevel,
  toSnapshot,
  UnknownOwnedPetError,
  UnknownSpeciesError,
  withActivePet,
  type RoomSnapshot,
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

/* ---------- 레벨 → 단계 ---------- */

test('레벨 경계는 10과 20이다 (에셋 가이드 §3)', () => {
  assert.equal(stageOfLevel(1), 1);
  assert.equal(stageOfLevel(9), 1);
  assert.equal(stageOfLevel(10), 2);
  assert.equal(stageOfLevel(19), 2);
  assert.equal(stageOfLevel(20), 3);
  assert.equal(stageOfLevel(29), 3);
});

/* ---------- 명부와 활성 펫 ---------- */

test('시드 명부는 활성 펫이 정확히 하나다', () => {
  const collection = seedCollection();
  assert.equal(collection.pets.length, 6);
  const active = activePet(collection);
  assert.equal(active.id, collection.activePetId);
  assert.equal(roomPetViews(collection).filter((view) => view.isActive).length, 1);
});

test('시드 명부는 stage 1·2·3과 등급 3종을 모두 화면에 낸다', () => {
  const views = roomPetViews(seedCollection());
  assert.deepEqual(new Set(views.map((view) => view.stage)), new Set([1, 2, 3]));
  assert.deepEqual(new Set(views.map((view) => view.rarity)), new Set(['COMMON', 'RARE', 'EPIC']));
});

test('시드에는 EPIC stage3(48px 캔버스)가 들어 있다 — 32 하드코딩이 있으면 드러난다', () => {
  const views = roomPetViews(seedCollection());
  assert.ok(views.some((view) => view.rarity === 'EPIC' && view.stage === 3));
});

test('활성 펫을 바꾸면 이전 활성은 자동으로 풀린다', () => {
  const before = seedCollection();
  const after = withActivePet(before, 'seed-001');

  assert.equal(after.activePetId, 'seed-001');
  const actives = roomPetViews(after).filter((view) => view.isActive);
  assert.equal(actives.length, 1);
  assert.equal(actives[0]?.ownedPetId, 'seed-001');
  // 원본은 건드리지 않는다.
  assert.equal(before.activePetId, 'seed-006');
});

test('명부에 없는 펫은 활성으로 지정할 수 없다', () => {
  assert.throws(() => withActivePet(seedCollection(), 'nope'), UnknownOwnedPetError);
  assert.throws(() => findOwnedPet(seedCollection(), 'nope'), UnknownOwnedPetError);
});

test('도감 진행도는 마리 수가 아니라 종 수다 (에셋 가이드 §9)', () => {
  const collection = seedCollection();
  assert.equal(discoveredSpeciesCount(collection), 6);

  const duplicated = {
    pets: [...collection.pets, { id: 'extra', speciesPetId: petId('006'), level: 5 }],
    activePetId: collection.activePetId,
  };
  assert.equal(duplicated.pets.length, 7);
  assert.equal(discoveredSpeciesCount(duplicated), 6);
});

test('닉네임이 있으면 종 이름 대신 닉네임을 보여준다', () => {
  const collection = {
    pets: [{ id: 'a', speciesPetId: petId('006'), level: 21, nickname: '별이' }],
    activePetId: 'a',
  };
  assert.equal(roomPetViews(collection)[0]?.name, '별이');
});

test('XP 비율은 진짜 경험치가 아니라 레벨에서 만든 표시값이다', () => {
  assert.equal(mockXpRatio(3), 0.3);
  assert.equal(mockXpRatio(20), 0);
  assert.ok(mockXpRatio(29) < 1);
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

/* ---------- 영속 ---------- */

test('저장하고 다시 읽으면 명부와 활성 펫이 그대로다', () => {
  const before = withActivePet(seedCollection(), 'seed-003');
  const after = fromSnapshot(toSnapshot(before));
  assert.deepEqual(after.pets, before.pets);
  assert.equal(after.activePetId, 'seed-003');
});

test('저장된 상태가 없으면 시드로 시작한다', () => {
  assert.deepEqual(fromSnapshot(undefined), seedCollection());
});

test('활성 펫이 명부에서 사라졌으면 첫 마리로 되돌린다 — 활성이 없는 상태는 없다', () => {
  const snapshot: RoomSnapshot = {
    version: 1,
    pets: [{ id: 'a', speciesPetId: '006', level: 5 }],
    activePetId: 'gone',
  };
  assert.equal(fromSnapshot(snapshot).activePetId, 'a');
});

test('저장 파일이 손상돼도 앱이 죽지 않고 시드로 되돌아간다', () => {
  const unknownSpecies: RoomSnapshot = {
    version: 1,
    pets: [{ id: 'a', speciesPetId: '999', level: 5 }],
    activePetId: 'a',
  };
  assert.deepEqual(fromSnapshot(unknownSpecies), seedCollection());

  const wrongVersion = { version: 99, pets: [], activePetId: 'a' } as unknown as RoomSnapshot;
  assert.deepEqual(fromSnapshot(wrongVersion), seedCollection());
});

test('닉네임이 없으면 스냅샷에 키 자체가 없다 — exactOptionalPropertyTypes와 맞춘다', () => {
  const snapshot = toSnapshot(seedCollection());
  assert.ok(!('nickname' in (snapshot.pets[0] as object)));

  const named = toSnapshot({
    pets: [{ id: 'a', speciesPetId: petId('006'), level: 5, nickname: '별이' }],
    activePetId: 'a',
  });
  assert.equal(named.pets[0]?.nickname, '별이');
  assert.equal(fromSnapshot(named).pets[0]?.nickname, '별이');
});
