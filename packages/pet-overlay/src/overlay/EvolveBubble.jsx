import React, { useRef, useState } from 'react';
import { pickEvolveLine } from './evolve-lines.js';

/**
 * 이름 뒤에 붙일 주격 조사. 받침이 있으면 "이", 없으면 "가".
 *
 * 펫 이름과 닉네임은 정해져 있지 않다 — "두더지가"는 맞아도 "볼주머니햄가"는 틀린다.
 * 한글이 아닌 글자로 끝나면 받침을 알 수 없어 "이(가)"로 둔다.
 */
function subjectParticle(name) {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return '이(가)';
  return code % 28 === 0 ? '가' : '이';
}

/**
 * 펫이 진화시켜 달라고 말을 거는 말풍선. 두 단계로 동작한다.
 *
 * 1. **접힌 상태** — 펫 머리 옆의 "입력 중…" 말풍선. 친구가 무언가 말하려는 모습이라 눌러
 *    보고 싶어진다. 진화할 때까지 사라지지 않는다 — 경험치는 AI 도구를 쓸 때 쌓여서, 레벨이
 *    오르는 순간 사용자는 대개 다른 창에 있다. 잠깐 뜨고 사라지면 못 본다.
 * 2. **펼친 상태** — 펫이 1인칭으로 부탁한다(대사는 `evolve-lines.js` 에서 랜덤). 버튼은
 *    사용자의 대답이다.
 *
 * 진화는 자동이 아니다. 사용자가 직접 눌러야 모습이 바뀌고, 그래야 연출을 본다. 두 번 눌러야
 * 하므로 펫을 쓰다듬다 실수로 진화하는 일도 없다.
 *
 * `.pet` 바깥에 그린다. 펫에는 드래그·놀아주기 포인터 핸들러가 걸려 있어 그 안에 두면
 * 클릭이 펫 반응으로 먹힌다.
 */
export default function EvolveBubble({ petName, onEvolve }) {
  const [line, setLine] = useState(null);
  const lastLine = useRef(null);

  const open = () => {
    const next = pickEvolveLine(lastLine.current);
    lastLine.current = next;
    setLine(next);
  };

  if (!line) {
    const hint = `${petName}${subjectParticle(petName)} 할 말이 있대요`;
    return (
      <button className="evo-bubble" onClick={open} title={hint} aria-label={hint}>
        <span className="evo-dot" />
        <span className="evo-dot" />
        <span className="evo-dot" />
      </button>
    );
  }

  return (
    <div className="evo-call" role="dialog" aria-label={`${petName}의 부탁`}>
      <div className="evo-call-text">{line}</div>
      <div className="evo-call-actions">
        <button className="evo-call-btn pixel-button" onClick={onEvolve}>
          ✨ 진화시켜 줄게
        </button>
        <button className="evo-call-later pixel-button" onClick={() => setLine(null)}>
          나중에
        </button>
      </div>
    </div>
  );
}
