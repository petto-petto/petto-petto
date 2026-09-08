import React, { useEffect, useState } from 'react';
import { useGrowth } from './growth/useGrowth.js';
import Overlay from './overlay/Overlay.jsx';
import { getPet, DEFAULT_PET_KEY } from './pets/catalog.ts';
import { isElectron, onActivePetChanged, roomScene, setActivePet } from './platform/bridge.js';

/**
 * 오버레이에 뜨는 펫은 **명부가 정한다.**
 *
 * 예전에는 이 창이 자기 활성 펫 키를 따로 저장했다. 그래서 펫룸에서 "오버레이로 지정"을
 * 눌러도 main 의 명부만 바뀌고 오버레이는 자기 값을 계속 보여 줬다 — 활성 펫의 진실의
 * 원천이 둘이었다. 이제 이 창은 명부를 읽고 push 를 구독하기만 한다
 * (`apps/desktop/src/main/room.ts` 참조).
 */
const PREVIEW_ROSTER = [
  {
    ownedPetId: `preview-${DEFAULT_PET_KEY}`,
    slug: DEFAULT_PET_KEY,
    name: getPet(DEFAULT_PET_KEY).name,
    isActive: true,
  },
];

/**
 * Electron 에서는 대역을 쓰지 않는다.
 *
 * 대역을 초기값으로 두면 명부가 도착하기 전 한순간 `preview-...` 개체의 성장 컨트롤러가
 * 만들어지고, 다음 저장에서 **실제 DB에 그 가짜 개체의 행이 남는다.** 명부에 없는 펫이
 * 성장 저장소에 생기는 것이라 조용히 쌓인다. 명부가 올 때까지는 아무것도 그리지 않는다.
 */
const INITIAL_ROSTER = isElectron ? [] : PREVIEW_ROSTER;

export default function App() {
  const [roster, setRoster] = useState(INITIAL_ROSTER);
  const [activeId, setActiveId] = useState(INITIAL_ROSTER[0]?.ownedPetId ?? null);

  useEffect(() => {
    let alive = true;

    void roomScene()
      .then((scene) => {
        if (!alive || !scene?.pets?.length) return;
        setRoster(scene.pets);
        setActiveId(scene.pets.find((pet) => pet.isActive)?.ownedPetId ?? scene.pets[0].ownedPetId);
      })
      .catch((error) => {
        // 여기서 조용히 넘기면 roster 가 빈 채로 남아 투명 창에 **아무것도 안 뜬다.**
        // 사용자에게는 "오버레이가 안 켜짐"으로만 보이고 단서가 없다.
        console.error('[overlay] 명부를 읽지 못해 미리보기 펫으로 시작합니다.', error);
        if (!alive) return;
        setRoster(PREVIEW_ROSTER);
        setActiveId(PREVIEW_ROSTER[0].ownedPetId);
      });

    const off = onActivePetChanged((view) => {
      if (!view) return;
      // 레벨 등 같이 온 최신값도 명부에 반영한다. 펫룸이 하는 것과 같은 처리다.
      setRoster((prev) =>
        prev.some((pet) => pet.ownedPetId === view.ownedPetId)
          ? prev.map((pet) => (pet.ownedPetId === view.ownedPetId ? view : pet))
          : [...prev, view],
      );
      setActiveId(view.ownedPetId);
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  const activeView = roster.find((pet) => pet.ownedPetId === activeId) ?? roster[0] ?? null;
  const g = useGrowth(
    activeView
      ? { ownedPetId: activeView.ownedPetId, petKey: activeView.slug, name: activeView.name }
      : null,
  );

  // 명부가 아직 안 왔다. 투명 창이라 아무것도 안 그리는 편이 대역을 한 프레임 비추는 것보다 낫다.
  if (!activeView) return null;

  // 스프라이트는 종이 정하고 표시명은 명부가 정한다(닉네임이 종 이름을 이긴다).
  const activePet = { ...getPet(activeView.slug), name: activeView.name };

  return (
    <Overlay
      g={g}
      activePet={activePet}
      roster={roster}
      activeId={activeId}
      onSelectPet={setActivePet}
    />
  );
}
