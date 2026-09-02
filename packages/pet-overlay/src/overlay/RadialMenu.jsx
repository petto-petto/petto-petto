import React, { useState } from 'react';

const COLORS = { cyan: '#38e6ff', magenta: '#ff54c8', gold: '#ffd35a' };

// 커스텀 SVG 아이콘 (currentColor = 네온 색상)
function Icon({ name }) {
  const c = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'info':
      return (<svg {...c}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.6" r="1.15" fill="currentColor" stroke="none" /></svg>);
    case 'achievement':
      return (<svg {...c}><path d="M6 4h12v3.5a6 6 0 0 1-12 0V4z" /><path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10" /><path d="M18 5h2.5v1.5A3.5 3.5 0 0 1 17 10" /><line x1="9.5" y1="20" x2="14.5" y2="20" /><path d="M10.5 15.5V20M13.5 15.5V20" /></svg>);
    case 'settings':
      return (<svg {...c}><circle cx="12" cy="12" r="3.3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" /></svg>);
    case 'petmgmt':
      return (<svg {...c}><ellipse cx="12" cy="15.5" rx="4.2" ry="3.3" fill="currentColor" stroke="none" /><circle cx="7.3" cy="10.5" r="1.8" fill="currentColor" stroke="none" /><circle cx="16.7" cy="10.5" r="1.8" fill="currentColor" stroke="none" /><circle cx="9.6" cy="6.6" r="1.6" fill="currentColor" stroke="none" /><circle cx="14.4" cy="6.6" r="1.6" fill="currentColor" stroke="none" /></svg>);
    case 'battle':
      return (<svg {...c}><line x1="4.5" y1="19.5" x2="15" y2="9" /><line x1="19.5" y1="19.5" x2="9" y2="9" /><path d="M13 7.2l4.3-2.2-2.1 4.3z" fill="currentColor" stroke="none" /><path d="M11 7.2L6.7 5l2.1 4.3z" fill="currentColor" stroke="none" /><line x1="3" y1="17.8" x2="6.2" y2="21" /><line x1="21" y1="17.8" x2="17.8" y2="21" /></svg>);
    default:
      return null;
  }
}

// 기획: 정보 · 업적 · 설정 · 펫 관리 · 전투 (오버레이는 진입만). 링이 기존 펫을 감싼다.
const ITEMS = [
  { key: 'info', label: '정보', glow: 'cyan' },
  { key: 'achievement', label: '업적', glow: 'gold' },
  { key: 'settings', label: '설정', glow: 'cyan' },
  { key: 'petmgmt', label: '펫 관리', glow: 'magenta' },
  { key: 'battle', label: '전투', glow: 'magenta' },
];

export default function RadialMenu({ g, onClose }) {
  const { pet } = g;
  const [panel, setPanel] = useState(null);
  const R = 116;

  return (
    <div className="radial">
      <div className="radial-bg" onClick={onClose} />

      {ITEMS.map((it, i) => {
        const angle = (-90 + i * (360 / ITEMS.length)) * (Math.PI / 180);
        const x = Math.cos(angle) * R;
        const y = Math.sin(angle) * R;
        return (
          <button
            key={it.key}
            className={`radial-item glow-${it.glow}`}
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            onClick={() => setPanel(it)}
          >
            <span className="ri-icon" style={{ color: COLORS[it.glow] }}><Icon name={it.key} /></span>
            <span className="ri-label">{it.label}</span>
            {it.key === 'petmgmt' && pet.evolutionAvailable && <span className="ri-dot">✨</span>}
          </button>
        );
      })}

      {panel && (
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="panel-title"><span className="pt-icon" style={{ color: COLORS[panel.glow] }}><Icon name={panel.key} /></span> {panel.label}</div>
          <div className="panel-body">
            이 화면은 <b>{panel.label}</b> 담당 파트가 구현합니다.<br />(프로토타입: 오버레이는 진입 라우팅만)
          </div>
          {panel.key === 'petmgmt' && pet.evolutionAvailable && (
            <button className="evo-btn" onClick={() => { g.doEvolve(); setPanel(null); onClose(); }}>✨ 진화 실행</button>
          )}
          <button className="panel-close" onClick={() => setPanel(null)}>닫기</button>
        </div>
      )}
    </div>
  );
}
