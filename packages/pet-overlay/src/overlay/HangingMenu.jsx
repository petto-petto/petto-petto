import React, { useEffect, useState } from 'react';
import { menuState, openBattle, openGacha, openPanel, openPetRoom } from '../platform/bridge.js';
import { MENU_ITEMS, infoScreenFor, menuBadges } from './menu-model.ts';

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
    case 'room':
      return (
        <svg {...c}>
          <ellipse cx="12" cy="15.5" rx="4.2" ry="3.3" fill="currentColor" stroke="none" />
          <circle cx="7.3" cy="10.5" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="16.7" cy="10.5" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="9.6" cy="6.6" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="14.4" cy="6.6" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'gacha':
      // 소환의 숲의 씨앗에서 돋는 새싹.
      return (
        <svg {...c}>
          <path d="M12 21v-8" />
          <path d="M12 13c0-3.5-2.6-5.6-6.5-5.6 0 3.6 2.6 5.6 6.5 5.6z" fill="currentColor" />
          <path d="M12 11c0-3.2 2.3-5.3 6-5.3 0 3.3-2.3 5.3-6 5.3z" fill="currentColor" />
          <ellipse cx="12" cy="20.5" rx="5" ry="1.6" />
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

// 팻말은 왼쪽부터 펫룸 · 뽑기 · 전투 · 정보 순으로 매단다(동선 2단계 B). 합성·도감은 펫룸에서 간다.
export default function HangingMenu({ onClose }) {
  // 배지는 메뉴를 열 때마다 새로 읽는다. 읽기 전·실패하면 배지 없이 그린다.
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    void menuState().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  const badges = menuBadges(state);

  // 각 팻말은 창 하나씩 연다. 진화는 펫 머리 위 말풍선(`EvolveBubble`)이 맡는다.
  const selectItem = (item) => {
    if (item.key === 'room') void openPetRoom();
    else if (item.key === 'gacha') void openGacha();
    else if (item.key === 'battle') void openBattle();
    else if (item.key === 'info') void openPanel(infoScreenFor(state));
    onClose();
  };

  return (
    <div className="hmenu">
      <div className="hmenu-bg" onClick={onClose} />
      <div className="hmenu-board" aria-label="펫 제어 메뉴">
        <div className="hmenu-rail" aria-hidden="true" />
        <div className="hmenu-items">
          {MENU_ITEMS.map((it) => {
            const badge = badges[it.key] ?? null;
            return (
              <button
                key={it.key}
                className="hmenu-item pixel-button"
                onClick={() => selectItem(it)}
                aria-label={badge ? `${it.label} · ${badge}` : it.label}
              >
                {badge && <span className="hmenu-badge">{badge}</span>}
                <span className="hmenu-icon">
                  <Icon name={it.key} />
                </span>
                <span className="hmenu-label">{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
