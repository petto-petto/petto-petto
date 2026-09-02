import React from 'react';

// 레벨업 연출: 문구(배너)만
export default function LevelUpFx({ level }) {
  return (
    <div className="fx fx-levelup">
      <div className="fx-banner levelup-banner">
        LEVEL&nbsp;UP!
        <div className="fx-sub">Lv. {level}</div>
      </div>
    </div>
  );
}
