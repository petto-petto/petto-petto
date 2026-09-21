import React, { useState } from 'react';
import { openBattle, openPanel, openPetRoom } from '../platform/bridge.js';

// 커스텀 SVG 아이콘
function Icon({ name }) {
  const c = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (name) {
    case 'info':
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <circle cx="12" cy="7.6" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'petmgmt':
      return (
        <svg {...c}>
          <ellipse cx="12" cy="15.5" rx="4.2" ry="3.3" fill="currentColor" stroke="none" />
          <circle cx="7.3" cy="10.5" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="16.7" cy="10.5" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="9.6" cy="6.6" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="14.4" cy="6.6" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'battle':
      return (
        <svg {...c}>
          <line x1="4.5" y1="19.5" x2="15" y2="9" />
          <line x1="19.5" y1="19.5" x2="9" y2="9" />
          <path d="M13 7.2l4.3-2.2-2.1 4.3z" fill="currentColor" stroke="none" />
          <path d="M11 7.2L6.7 5l2.1 4.3z" fill="currentColor" stroke="none" />
          <line x1="3" y1="17.8" x2="6.2" y2="21" />
          <line x1="21" y1="17.8" x2="17.8" y2="21" />
        </svg>
      );
    default:
      return null;
  }
}

// 팻말은 왼쪽부터 전투 · 펫 관리 · 정보 순으로 매단다. 각 메뉴의 기존 동작은 유지한다.
const ITEMS = [
  { key: 'battle', label: '전투', opensBattle: true },
  { key: 'petmgmt', label: '펫 관리', opensRoom: true },
  { key: 'info', label: '정보', panelScreen: 'info' },
];

export default function HangingMenu({ g, onClose }) {
  const { pet } = g;
  const [panel, setPanel] = useState(null);

  const selectItem = (item) => {
    if (item.panelScreen) {
      void openPanel(item.panelScreen);
      onClose();
      return;
    }
    if (item.opensBattle) {
      void openBattle();
      onClose();
      return;
    }
    if (item.opensRoom && !pet.evolutionAvailable) {
      void openPetRoom();
      onClose();
      return;
    }
    setPanel(item);
  };

  return (
    <div className="hmenu">
      <div className="hmenu-bg" onClick={onClose} />
      <div className="hmenu-board" aria-label="펫 제어 메뉴">
        <div className="hmenu-rail" aria-hidden="true" />
        <div className="hmenu-items">
          {ITEMS.map((it) => (
            <button key={it.key} className="hmenu-item pixel-button" onClick={() => selectItem(it)}>
              <span className="hmenu-icon">
                <Icon name={it.key} />
              </span>
              <span className="hmenu-label">{it.label}</span>
              {it.key === 'petmgmt' && pet.evolutionAvailable && (
                <span className="hmenu-dot">✨</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {panel && (
        <div className="panel pixel-panel" onClick={(e) => e.stopPropagation()}>
          <div className="panel-title">
            <span className="pt-icon">
              <Icon name={panel.key} />
            </span>{' '}
            {panel.label}
          </div>
          <div className="panel-body">
            이 화면은 <b>{panel.label}</b> 담당 파트가 구현합니다.
            <br />
            (프로토타입: 오버레이는 진입 라우팅만)
          </div>
          {panel.key === 'petmgmt' && pet.evolutionAvailable && (
            <>
              <button
                className="evo-btn"
                onClick={() => {
                  g.doEvolve();
                  setPanel(null);
                  onClose();
                }}
              >
                ✨ 진화 실행
              </button>
              <button
                className="panel-close"
                onClick={() => {
                  void openPetRoom();
                  setPanel(null);
                  onClose();
                }}
              >
                펫룸 열기
              </button>
            </>
          )}
          <button className="panel-close" onClick={() => setPanel(null)}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
