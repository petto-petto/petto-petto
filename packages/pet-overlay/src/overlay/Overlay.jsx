import React, { useEffect, useRef, useState } from 'react';
import RadialMenu from './RadialMenu.jsx';
import Toasts from './Toasts.jsx';
import DevPanel from './DevPanel.jsx';
import Pet from './Pet.jsx';
import PetSprite from './PetSprite.jsx';
import LevelUpFx from './LevelUpFx.jsx';
import EvolutionFx from './EvolutionFx.jsx';
import Vfx from './Vfx.jsx';
import { setInteractive, dragStart, dragMove, dragEnd } from '../platform/bridge.js';
import { stageForEvolution, randomClick } from '../pets/registry.js';

export default function Overlay({ g, activePet, petKey, setPetKey }) {
  const { pet, overlayState, toasts, levelUpFx, evolveFx, xpFx, attackFx, mood } = g;
  const [menuOpen, setMenuOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [spriteFailed, setSpriteFailed] = useState(false);
  const drag = useRef(null);
  const vfxRef = useRef(null);
  const petSpriteRef = useRef(null);
  const menuOpenRef = useRef(false);
  const lastSent = useRef(null);

  // 연속 hit-test: 커서가 .io(펫/메뉴/패널) 위이거나 메뉴가 열려 있으면 입력 활성화, 그 외엔 클릭 통과.
  useEffect(() => {
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = !!(el && el.closest && el.closest('.io'));
      const want = over || menuOpenRef.current;
      if (want !== lastSent.current) { lastSent.current = want; setInteractive(want); }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
    if (menuOpen && lastSent.current !== true) { lastSent.current = true; setInteractive(true); }
  }, [menuOpen]);

  // VFX 트리거
  useEffect(() => { if (evolveFx) vfxRef.current?.evolve(); }, [evolveFx?.key]);
  useEffect(() => { if (levelUpFx) vfxRef.current?.levelUp(); }, [levelUpFx?.key]);
  useEffect(() => { if (xpFx) vfxRef.current?.xp(); }, [xpFx?.key]);

  // 스프라이트 모션 트리거: XP 획득 → 기뻐서 폴짝(click2), 전투 → attack
  useEffect(() => { if (xpFx) petSpriteRef.current?.play('click2'); }, [xpFx?.key]);
  useEffect(() => { if (attackFx) petSpriteRef.current?.play('attack'); }, [attackFx?.key]);

  // 드래그 = 창(윈도우) 이동. 스크린 절대 좌표 기준 → 모니터를 넘어가도 정확. (펫은 창 중앙 고정)
  const onPointerDown = (e) => {
    if (e.button !== 0) return; // 좌클릭만. 우클릭은 onContextMenu.
    drag.current = { sx: e.screenX, sy: e.screenY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStart(e.screenX, e.screenY);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.screenX - d.sx) + Math.abs(e.screenY - d.sy) < 6) return;
    d.moved = true;
    if (menuOpen) setMenuOpen(false);
    dragMove(e.screenX, e.screenY);
    g.pokeActivity(); // 드래그 = 상호작용 → 심심 타이머 리셋
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    dragEnd();
    if (d && !d.moved) {
      if (menuOpen) setMenuOpen(false); // 열려있으면 클릭으로 닫기
      else { g.reaction(); petSpriteRef.current?.play(randomClick()); } // 클릭 반응(click/click2 랜덤)
    }
  };
  const onContextMenu = (e) => { e.preventDefault(); setMenuOpen((v) => !v); };

  const pct = Math.round((g.levelProgress ?? 0) * 100); // 누적 토큰까지 반영(연속)
  const stage = stageForEvolution(pet.evolutionStage);   // 0/1/2 → 스프라이트 1/2/3
  const evolving = !!evolveFx;
  // (SVG 폴백용) 표정: 반응/획득 중이면 happy, 오래 XP 없으면 bored, 그 외 idle
  const face = (overlayState === 'reaction' || overlayState === 'gainxp' || overlayState === 'levelup')
    ? 'happy'
    : mood === 'bored' ? 'bored' : 'idle';

  return (
    <div className="overlay-root">
      <div className="pet-anchor io">
        {menuOpen && <RadialMenu g={g} onClose={() => setMenuOpen(false)} />}

        {levelUpFx && <LevelUpFx key={levelUpFx.key} level={levelUpFx.level} />}
        {evolveFx && <EvolutionFx key={evolveFx.key} />}

        <div
          className={`pet state-${overlayState} mood-${mood} ${evolving ? 'evolving' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
          title="좌클릭: 놀아주기 · 우클릭: 메뉴 · 드래그: 이동(모니터 간 포함)"
        >
          <div className="pet-top">
            <div className="pet-level px">Lv. {pet.level}</div>
            <div className="pet-exp"><span style={{ width: pct + '%' }} /></div>
          </div>
          <div className="pet-body">
            {spriteFailed
              ? <Pet stage={pet.evolutionStage} face={face} />
              : <PetSprite ref={petSpriteRef} pet={activePet} stage={stage} onError={() => setSpriteFailed(true)} />}
          </div>
          <div className="pet-name">{activePet?.name ?? pet.name}</div>
          {pet.evolutionAvailable && <div className="evo-badge" title="진화 가능">✨</div>}
          {face === 'bored' && <div className="mood-zzz">💤</div>}
        </div>

        <Toasts toasts={toasts} />
        <Vfx ref={vfxRef} />
      </div>

      <DevPanel g={g} open={devOpen} onToggle={() => setDevOpen((v) => !v)} petKey={petKey} setPetKey={setPetKey} />
    </div>
  );
}
