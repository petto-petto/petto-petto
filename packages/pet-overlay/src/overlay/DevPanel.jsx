import React from 'react';
import { requiredXp } from '../growth/engine.js';
import { isElectron } from '../platform/bridge.js';

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
          <div className="dev-note">
            {isElectron ? 'Electron 오버레이 모드' : '브라우저 미리보기 모드'}
          </div>
        </div>
      )}
    </div>
  );
}
