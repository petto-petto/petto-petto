import React from 'react';

/**
 * 펫이 먼저 말을 거는 말풍선. 첫 펫 안내와 1분 집계 알림(뽑기 가능·업적 달성)이 쓴다.
 *
 * 모양은 진화 말풍선의 펼친 상태(`.evo-call`)와 같은 부품이다 — 펫이 말하는 자리는 하나뿐이고,
 * 무엇을 먼저 말할지는 `speech.ts`가 정한다. `.pet` 바깥에 그리는 이유도 진화 말풍선과 같다.
 */
export default function SpeechBubble({ label, text, primary, secondary }) {
  return (
    <div className="evo-call speech-call" role="dialog" aria-label={label}>
      <div className="evo-call-text">{text}</div>
      <div className="evo-call-actions">
        <button className="evo-call-btn pixel-button" onClick={primary.onClick}>
          {primary.label}
        </button>
        {secondary && (
          <button className="evo-call-later pixel-button" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
}
