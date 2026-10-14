import React from 'react';
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

export default function HangingMenu({ onClose }) {
  // 각 항목이 창 하나씩 연다. 예전에는 진화 가능할 때만 펫 관리가 펫룸 대신 자리 표시용
  // 패널을 띄워서 같은 버튼이 상황마다 달랐다. 진화는 펫 머리 위 말풍선(`EvolveBubble`)이 맡는다.
  const selectItem = (item) => {
    if (item.panelScreen) void openPanel(item.panelScreen);
    else if (item.opensBattle) void openBattle();
    else if (item.opensRoom) void openPetRoom();
    onClose();
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
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
