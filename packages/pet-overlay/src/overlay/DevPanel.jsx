import React, { useEffect, useState } from 'react';
import { requiredXp } from '../growth/engine.js';
import { isElectron, previewRoomBackground, roomScene } from '../platform/bridge.js';

const SEASON_OPTIONS = [
  ['spring', '봄'],
  ['summer', '여름'],
  ['autumn', '가을'],
  ['winter', '겨울'],
];
const PHASE_OPTIONS = [
  ['dawn', '새벽'],
  ['day', '낮'],
  ['dusk', '노을'],
  ['night', '밤'],
];

/**
 * 펫룸 배경의 계절·시간대 미리보기.
 *
 * 배경 16장을 실제 날짜가 오기를 기다리지 않고 확인하려고 둔다. 원래 펫룸 하단에 있었지만
 * 개발용이라 이 패널로 옮겼다. 고정 상태는 main 이 들고 있고, 펫룸은 push 를 받아 따른다.
 */
function RoomBackgroundDebug() {
  const [season, setSeason] = useState('spring');
  const [phase, setPhase] = useState('day');
  const [previewing, setPreviewing] = useState(false);

  // 패널을 열 때 지금 펫룸이 보여 주는 장면에 선택기를 맞춘다.
  useEffect(() => {
    let alive = true;
    void roomScene().then((scene) => {
      if (!alive || !scene?.background) return;
      setSeason(scene.background.season);
      setPhase(scene.background.phase);
      setPreviewing(Boolean(scene.previewing));
    });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (nextSeason, nextPhase) => {
    setSeason(nextSeason);
    setPhase(nextPhase);
    setPreviewing(true);
    void previewRoomBackground(nextSeason, nextPhase);
  };

  const backToNow = () => {
    setPreviewing(false);
    void previewRoomBackground(null, null)
      .then(() => roomScene())
      .then((scene) => {
        if (!scene?.background) return;
        setSeason(scene.background.season);
        setPhase(scene.background.phase);
      });
  };

  return (
    <>
      <div className="dev-title">펫룸 배경</div>
      <div className="dev-btns dev-room-bg">
        <select
          aria-label="계절"
          value={season}
          onChange={(event) => pick(event.target.value, phase)}
        >
          {SEASON_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="시간"
          value={phase}
          onChange={(event) => pick(season, event.target.value)}
        >
          {PHASE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={!previewing} onClick={backToNow}>
          지금
        </button>
      </div>
    </>
  );
}

// 실제 Claude Code 없이도 성장/오버레이를 시연하기 위한 디버그 패널
export default function DevPanel({ g, open, onToggle, roster, activeId, onSelectPet }) {
  const { pet, session } = g;
  const need = requiredXp(pet.level);
  return (
    <div className={`devpanel io ${open ? 'open' : ''}`}>
      <button className="dev-toggle" onClick={onToggle}>
        {open ? '×' : '⚙'}
      </button>
      {open && (
        <div className="dev-body">
          <div className="dev-title">Growth Debug</div>
          <div className="dev-row">
            Lv <b>{pet.level}</b> · {pet.level >= 50 ? 'MAX' : `${pet.xpIntoLevel}/${need}`} · total{' '}
            {pet.totalXp}
          </div>
          <div className="dev-row">
            stage {pet.evolutionStage}
            {pet.evolutionAvailable ? ' · 진화가능 ✨' : ''}
          </div>
          <div className="dev-row">
            다음 XP까지: <b>{session.toNext ?? '-'}</b> 토큰
          </div>
          <div className="dev-btns">
            <button onClick={() => g.ingestTokens(2000)}>+2k 토큰</button>
            <button onClick={() => g.ingestTokens(10000)}>+10k 토큰</button>
            <button onClick={() => g.ingestTokens(100000)}>+100k 토큰</button>
            <button onClick={() => g.addBattleXp(5)}>전투 +5 XP</button>
            <button onClick={() => g.addBattleXp(200)}>테스트 +200 XP</button>
            <button disabled={!pet.evolutionAvailable} onClick={() => g.doEvolve()}>
              진화 실행
            </button>
            <button onClick={() => g.resetAll()}>저장 초기화</button>
          </div>
          {/*
            보유 펫 목록은 명부(`room:scene`)에서 온다. 카탈로그의 종 목록이 아니다 —
            아직 뽑지 않은 종을 오버레이에 세울 수는 없다. 누르면 명부에 지정을 요청만 하고,
            화면은 `room:activePetChanged` 를 받고 나서 바뀐다.
          */}
          <div className="dev-title">활성 펫 (보유 펫)</div>
          <div className="dev-btns dev-pets">
            {(roster ?? []).map((pet) => (
              <button
                key={pet.ownedPetId}
                className={activeId === pet.ownedPetId ? 'active' : ''}
                onClick={() => onSelectPet?.(pet.ownedPetId)}
                title={`${pet.rarity ?? ''} · ${pet.slug} · Lv.${pet.level ?? '-'}`}
              >
                {pet.name}
              </button>
            ))}
          </div>
          <RoomBackgroundDebug />
          <div className="dev-note">
            {isElectron ? 'Electron 오버레이 모드' : '브라우저 미리보기 모드'}
          </div>
        </div>
      )}
    </div>
  );
}
