/**
 * 앱에 끼우는 채널 맵의 계약.
 *
 * 채널 핸들러는 렌더러에서만 불려서 타입 검사가 호출부를 보지 못한다. 갈래 하나가 사라져도
 * 컴파일은 통과한다 — 실제로 `settings:notification` 의 `levelup` 갈래가 리팩터링 중에 지워졌는데
 * 어떤 테스트도 잡지 못했다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryCollection,
  InMemoryCurrency,
  InMemoryMetaStore,
  InMemoryPetClient,
  MetaAppState,
  metaHandlers,
  type MetaHost,
  STUB_GROWTH_RULES,
} from '@pet/meta';

const noopHost: MetaHost = {
  showPanel: () => {},
  hidePanel: () => {},
  applyOverlayVisibility: () => {},
  applyPetSize: () => {},
  broadcast: () => {},
  openExternal: async () => {},
  revealPath: () => {},
  petPortrait: () => undefined,
};

function handlers() {
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryCurrency(),
    new InMemoryPetClient(),
    STUB_GROWTH_RULES,
  );
  return { state, map: metaHandlers(state, noopHost) };
}

test('SET: 알림 세 가지를 모두 끄고 켤 수 있다', () => {
  const { state, map } = handlers();
  const toggle = map['settings:notification'];
  assert.ok(toggle, 'settings:notification 채널이 있어야 한다');

  const cases = [
    ['levelup', () => state.meta.settings.notifyLevelup],
    ['achievement', () => state.meta.settings.notifyAchievement],
    ['gacha_ready', () => state.meta.settings.notifyGachaReady],
  ] as const;

  for (const [key, read] of cases) {
    toggle(key, false);
    assert.equal(read(), false, `${key} 를 끌 수 있어야 한다`);
    toggle(key, true);
    assert.equal(read(), true, `${key} 를 켤 수 있어야 한다`);
  }
});

test('INFO: 고른 펫이 없으면 초상화 채널은 오류 없이 비어 있다', () => {
  const { map } = handlers();
  const portrait = map['info:pet-portrait'];
  assert.ok(portrait);
  assert.equal(portrait(), undefined);
});

test('INFO: 활성 펫이 있으면 초상화 채널이 진화 단계를 넘긴다', () => {
  const pets = new InMemoryPetClient();
  const wizard = pets.give('006', { level: 21, evolutionStage: 1 });
  pets.setActivePet(wizard.ownedPetId);
  let received: unknown;
  const state = new MetaAppState(
    new InMemoryMetaStore(),
    '~/Library/…',
    '0.1.0',
    new InMemoryCollection(),
    new InMemoryCurrency(),
    pets,
    STUB_GROWTH_RULES,
  );
  const map = metaHandlers(state, {
    ...noopHost,
    petPortrait: (pet) => {
      received = pet;
      return 'file:///portrait.png';
    },
  });

  assert.equal(map['info:pet-portrait']?.(), 'file:///portrait.png');
  // 레벨(21)로 단계를 추측하지 않고 저장된 진화 단계(1)를 그대로 넘긴다.
  assert.equal((received as { evolutionStage: number }).evolutionStage, 1);
  assert.equal((received as { speciesId: string }).speciesId, '006');
});
