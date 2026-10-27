import React, { useEffect, useRef, useState } from 'react';
import HangingMenu from './HangingMenu.jsx';
import Toasts from './Toasts.jsx';
import DevPanel from './DevPanel.jsx';
import Pet from './Pet.jsx';
import PetSprite from './PetSprite.jsx';
import LevelUpFx from './LevelUpFx.jsx';
import EvolutionFx from './EvolutionFx.jsx';
import EvolveBubble from './EvolveBubble.jsx';
import SpeechBubble from './SpeechBubble.jsx';
import Vfx from './Vfx.jsx';
import {
  dragStart,
  dragMove,
  dragEnd,
  onBubbles,
  openGacha,
  openPanel,
} from '../platform/bridge.js';
import { MENU_HINT_STORAGE_KEY, MENU_HINT_TEXT, currentSpeech, enqueueNotices } from './speech.ts';

/** 첫 펫 우클릭 안내를 본 적이 있는가. 저장소를 못 쓰면 본 것으로 친다 — 매번 뜨는 것보다 낫다. */
function menuHintSeen() {
  try {
    return window.localStorage.getItem(MENU_HINT_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markMenuHintSeen() {
  try {
    window.localStorage.setItem(MENU_HINT_STORAGE_KEY, '1');
  } catch {
    // 기억하지 못하면 다음 실행에서 한 번 더 볼 뿐이다.
  }
}
import { useOverlayHitTest } from './useHitTest.js';
import { stageForEvolution, randomClick } from '../pets/catalog.ts';

export default function Overlay({ g, activePet, roster, activeId, onSelectPet }) {
  const { pet, overlayState, toasts, levelUpFx, evolveFx, xpFx, attackFx, mood } = g;
  const [menuOpen, setMenuOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [spriteFailed, setSpriteFailed] = useState(false);
  // 1분 집계가 보낸 알림. 한 번에 하나씩 보이고, 누르거나 `나중에`로 닫으면 다음 것이 나온다.
  const [notices, setNotices] = useState([]);
  const [menuHintPending, setMenuHintPending] = useState(() => !menuHintSeen());
  const drag = useRef(null);
  const vfxRef = useRef(null);
  const petSpriteRef = useRef(null);

  // 빈 상태 패널도 같은 규칙을 써야 해서 훅으로 뺐다(`useHitTest.js`).
  useOverlayHitTest(menuOpen);

  useEffect(
    () => onBubbles((incoming) => setNotices((queue) => enqueueNotices(queue, incoming))),
    [],
  );

  const dismissMenuHint = () => {
    markMenuHintSeen();
    setMenuHintPending(false);
  };
  const dropNotice = () => setNotices((queue) => queue.slice(1));
  const followNotice = (notice) => {
    dropNotice();
    if (notice.kind === 'achievement') void openPanel('achievements');
    else void openGacha();
  };

  // VFX 트리거
  useEffect(() => {
    if (evolveFx) vfxRef.current?.evolve();
  }, [evolveFx?.key]);
  useEffect(() => {
    if (levelUpFx) vfxRef.current?.levelUp();
  }, [levelUpFx?.key]);
  useEffect(() => {
    if (xpFx) vfxRef.current?.xp();
  }, [xpFx?.key]);

  // 스프라이트 모션 트리거: XP 획득 → 기뻐서 폴짝(click2), 전투 → attack
  useEffect(() => {
    if (xpFx) petSpriteRef.current?.play('click2');
  }, [xpFx?.key]);
  useEffect(() => {
    if (attackFx) petSpriteRef.current?.play('attack');
  }, [attackFx?.key]);

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
      if (menuOpen)
        setMenuOpen(false); // 열려있으면 클릭으로 닫기
      else {
        g.reaction();
        petSpriteRef.current?.play(randomClick());
      } // 클릭 반응(click/click2 랜덤)
    }
  };
  const onContextMenu = (e) => {
    e.preventDefault();
    // 안내가 가르친 대로 우클릭했다. 다시 알려 줄 필요가 없다.
    if (menuHintPending) dismissMenuHint();
    setMenuOpen((v) => !v);
  };

  const pct = Math.round((g.levelProgress ?? 0) * 100); // 누적 토큰까지 반영(연속)
  const stage = stageForEvolution(pet.evolutionStage); // 0/1/2 → 스프라이트 1/2/3
  const evolving = !!evolveFx;
  const speech = currentSpeech({
    menuOpen,
    menuHintPending,
    evolutionAvailable: pet.evolutionAvailable,
    notices,
  });
  // (SVG 폴백용) 표정: 반응/획득 중이면 happy, 오래 XP 없으면 bored, 그 외 idle
  const face =
    overlayState === 'reaction' || overlayState === 'gainxp' || overlayState === 'levelup'
      ? 'happy'
      : mood === 'bored'
        ? 'bored'
        : 'idle';

  return (
    <div className="overlay-root">
      <div className="pet-anchor io">
        {menuOpen && <HangingMenu onClose={() => setMenuOpen(false)} />}

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
            <div className="pet-level px">
              <span>LV</span>
              <strong>{pet.level}</strong>
            </div>
            <div className="pet-exp-wrap">
              <div className="pet-exp">
                <span style={{ width: pct + '%' }} />
              </div>
              <span className="pet-exp-value">{pct}%</span>
            </div>
          </div>
          <div className="pet-body">
            {spriteFailed ? (
              <Pet stage={pet.evolutionStage} face={face} />
            ) : (
              <PetSprite
                ref={petSpriteRef}
                pet={activePet}
                stage={stage}
                onError={() => setSpriteFailed(true)}
              />
            )}
          </div>
          <div className="pet-name">
            <span aria-hidden="true">◆</span>
            {activePet?.name ?? pet.name}
          </div>
          {face === 'bored' && <div className="mood-zzz">💤</div>}
        </div>

        {/* 펫이 하는 말은 한 번에 하나다. 순서(첫 안내 > 알림 > 진화)와 메뉴가 열리면 비키는 규칙은 `speech.ts`. */}
        {speech?.kind === 'menu-hint' && (
          <SpeechBubble
            label={`${activePet?.name ?? pet.name}의 인사`}
            text={MENU_HINT_TEXT}
            primary={{ label: '알겠어', onClick: dismissMenuHint }}
          />
        )}
        {/* 진화할 때까지 남는 작은 말풍선. 누르면 진화 안내가 펼쳐진다. */}
        {speech?.kind === 'evolve' && (
          <EvolveBubble petName={activePet?.name ?? pet.name} onEvolve={() => g.doEvolve()} />
        )}
        {speech?.kind === 'notice' && (
          <SpeechBubble
            key={speech.notice.kind}
            label={`${activePet?.name ?? pet.name}의 알림`}
            text={speech.notice.text}
            primary={{
              label: speech.notice.kind === 'achievement' ? '보상 받으러 가기' : '뽑으러 가기',
              onClick: () => followNotice(speech.notice),
            }}
            secondary={{ label: '나중에', onClick: dropNotice }}
          />
        )}

        <Toasts toasts={toasts} />
        <Vfx ref={vfxRef} />
      </div>

      <DevPanel
        g={g}
        open={devOpen}
        onToggle={() => setDevOpen((v) => !v)}
        roster={roster}
        activeId={activeId}
        onSelectPet={onSelectPet}
      />
    </div>
  );
}
