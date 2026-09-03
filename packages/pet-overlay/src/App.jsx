import React, { useEffect, useState } from 'react';
import { useGrowth } from './growth/useGrowth.js';
import Overlay from './overlay/Overlay.jsx';
import { getPet, DEFAULT_PET_KEY } from './pets/registry.js';
import { loadOverlayState, saveOverlayState } from './overlay/state-storage.js';

export default function App() {
  const [petKey, setPetKey] = useState(DEFAULT_PET_KEY); // 활성 펫(도트 에셋) 선택
  const [overlayStateLoaded, setOverlayStateLoaded] = useState(false);
  const g = useGrowth(petKey); // 펫별 독립 성장 — 활성 펫의 레벨/경험치만 노출
  const activePet = getPet(petKey);

  useEffect(() => {
    let alive = true;
    void loadOverlayState().then(({ activePetKey }) => {
      if (!alive) return;
      if (activePetKey && getPet(activePetKey)) setPetKey(activePetKey);
      setOverlayStateLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (overlayStateLoaded) void saveOverlayState({ activePetKey: petKey });
  }, [overlayStateLoaded, petKey]);

  return <Overlay g={g} activePet={activePet} petKey={petKey} setPetKey={setPetKey} />;
}
