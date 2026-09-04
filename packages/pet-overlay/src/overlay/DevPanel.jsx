import React from 'react';
import { requiredXp } from '../growth/engine.js';
import { isElectron } from '../platform/bridge.js';
import { PETS } from '../pets/registry.js';

// 실제 Claude Code 없이도 성장/오버레이를 시연하기 위한 디버그 패널
export default function DevPanel({ g, open, onToggle, petKey, setPetKey }) {
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
          <div className="dev-title">펫 선택 (도트 에셋)</div>
          <div className="dev-btns dev-pets">
            {PETS.map((p) => (
              <button
                key={p.key}
                className={petKey === p.key ? 'active' : ''}
                onClick={() => setPetKey?.(p.key)}
                title={`${p.grade} · ${p.slug}`}
              >
                {p.name}
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
