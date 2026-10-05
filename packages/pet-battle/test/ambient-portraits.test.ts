import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ambientPortrait, type AmbientPortrait } from '../src/view/ambient-portraits.ts';

const species = [
  {
    name: 'acorn_squirrel',
    rarity: 'epic',
    id: '001',
    crops: [
      [3, 5, 15, 10],
      [2, 6, 17, 12],
      [4, 10, 25, 18],
    ],
  },
  {
    name: 'star_wizard',
    rarity: 'epic',
    id: '006',
    crops: [
      [10, 9, 13, 6],
      [7, 9, 20, 8],
      [12, 16, 24, 10],
    ],
  },
  {
    name: 'midnight_zebra',
    rarity: 'rare',
    id: '002',
    crops: [
      [8, 7, 16, 10],
      [6, 7, 19, 11],
      [5, 9, 23, 11],
    ],
  },
  {
    name: 'cheek_hamster',
    rarity: 'rare',
    id: '005',
    crops: [
      [6, 8, 21, 9],
      [3, 9, 26, 9],
      [7, 10, 23, 10],
    ],
  },
  {
    name: 'mole_digger',
    rarity: 'common',
    id: '003',
    crops: [
      [9, 5, 14, 9],
      [8, 2, 16, 11],
      [9, 8, 14, 9],
    ],
  },
  {
    name: 'sprout_treant',
    rarity: 'common',
    id: '004',
    crops: [
      [8, 9, 16, 8],
      [5, 6, 22, 11],
      [8, 8, 20, 11],
    ],
  },
] as const;

function assertFits(portrait: AmbientPortrait): void {
  assert.ok(portrait.x >= 0 && portrait.y >= 0);
  assert.ok(portrait.x + portrait.width <= portrait.frameHeight);
  assert.ok(portrait.y + portrait.height <= portrait.frameHeight);
  assert.equal(
    portrait.scale,
    Math.min(2, Math.floor(40 / Math.max(portrait.width, portrait.height))),
  );
  assert.ok(Number.isInteger(portrait.scale) && portrait.scale >= 1);
  assert.ok(portrait.width * portrait.scale <= 40);
  assert.ok(portrait.height * portrait.scale <= 40);
}

test('공통 펫 6종·3단계는 첫 프레임의 얼굴만 정확히 잘라 40px 안에 정수 배율로 담는다', async () => {
  for (const pet of species) {
    for (const [index, crop] of pet.crops.entries()) {
      const stage = index + 1;
      const relative = `${pet.rarity}/${pet.name}/stage${stage}/pet_${pet.id}_s${stage}_idle.png`;
      const asset = `assets/pets/${relative}`;
      const frameHeight = stage === 3 && pet.rarity === 'epic' ? 48 : 32;
      const result = ambientPortrait(asset, 'PET');
      assert.equal(result.asset, asset, 'never substitute the current pet asset');
      assert.deepEqual(
        [result.x, result.y, result.width, result.height],
        crop,
        `${pet.name}/stage${stage}`,
      );
      assert.equal(result.frameHeight, frameHeight);
      assertFits(result);
      const image = await readFile(
        new URL(`../../../apps/desktop/renderer/assets/pets/${relative}`, import.meta.url),
      );
      assert.equal(
        image.readUInt32BE(20),
        frameHeight,
        'the audited face uses the real shared frame size',
      );
      assert.equal(image.readUInt32BE(16) % frameHeight, 0);
    }
  }
});

test('공통 에셋 URL의 접두 경로·쿼리·해시가 바뀌어도 같은 종·단계 얼굴을 선택한다', () => {
  for (const asset of [
    'file:///shared/pets/epic/star_wizard/stage3/pet_006_s3_idle.png',
    'https://assets.example/pets/epic/star_wizard/stage3/pet_006_s3_idle.png?v=2#preview',
    '../../renderer/assets/pets/epic/star_wizard/stage3/pet_006_s3_idle.png?next=/stage1/fake.png',
  ]) {
    assert.deepEqual(ambientPortrait(asset, 'PET'), {
      asset,
      x: 12,
      y: 16,
      width: 24,
      height: 10,
      frameHeight: 48,
      scale: 1,
    });
  }
});

test('전투 기본 펫 common·rare·epic도 각각 실제 첫 단계 얼굴을 사용한다', () => {
  for (const [rarity, crop] of [
    ['common', [8, 9, 16, 8]],
    ['rare', [6, 8, 21, 9]],
    ['epic', [3, 5, 15, 10]],
  ] as const) {
    const asset = `assets/pets/v2/${rarity}-idle.png?cache=1`;
    const result = ambientPortrait(asset, 'PET');
    assert.deepEqual([result.x, result.y, result.width, result.height], crop);
    assert.equal(result.frameHeight, 32);
    assert.equal(result.asset, asset);
    assertFits(result);
  }
});

test('적 7색·3표정은 크기 프리뷰와 무관하게 현재 표정의 얼굴만 담는다', async () => {
  for (const color of ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'rainbow']) {
    for (const face of ['steady', 'worried', 'exhausted']) {
      const asset = `assets/enemies/v2/${color}-${face}.png`;
      const expected = face === 'exhausted' ? [7, 14, 24, 12] : [7, 12, 23, 14];
      const image = await readFile(new URL(`../ui/${asset}`, import.meta.url));
      assert.equal(image.readUInt32BE(20), 32);
      for (const size of [56, 64, 80]) {
        const source = `${asset}?previewSize=${size}#portrait`;
        const result = ambientPortrait(source, 'ENEMY');
        assert.deepEqual(
          [result.x, result.y, result.width, result.height],
          expected,
          `${color}/${face}`,
        );
        assert.equal(result.asset, source);
        assert.equal(result.frameHeight, 32);
        assertFits(result);
      }
    }
  }
});

test('알 수 없는 펫은 원본을 유지하고 안전한 중앙 얼굴 영역을 사용한다', () => {
  for (const asset of [
    'assets/pets/new-friend.png',
    'assets/pets/epic/star_wizard/stage9/future.png',
  ]) {
    assert.deepEqual(ambientPortrait(asset, 'PET'), {
      asset,
      x: 8,
      y: 8,
      width: 16,
      height: 12,
      frameHeight: 32,
      scale: 2,
    });
  }
});
