import React from 'react';

// 프로토타입 플레이스홀더(치비 고양이 마법사). 진화: Lv15 보라 마법사 모자 → Lv35 모자+망토.
// 눈 깜빡임/꼬리 흔들기는 CSS. 최종 도트/스프라이트는 디자인·에셋 파트에서 교체.
export default function Pet({ stage = 0, face = 'idle' }) {
  return (
    <svg className="pet-svg" viewBox="0 0 100 106" width="100" height="106" aria-hidden>
      <ellipse cx="50" cy="99" rx="24" ry="4" fill="rgba(0,0,0,.32)" />

      {/* 꼬리 */}
      <path className="tail" d="M68 86 q24 3 20 -20 q-3 -13 -13 -9 q10 3 6 15 q-3 9 -15 6 z" fill="#fff" stroke="#cdd6e6" strokeWidth="1.4" />

      {/* 망토 (2단 진화, 몸통 뒤) */}
      {stage >= 2 && (
        <path d="M32 63 Q14 74 20 99 L80 99 Q86 74 68 63 Q50 71 32 63 Z" fill="#7b46e0" stroke="#5b32b0" strokeWidth="1.3" strokeLinejoin="round" />
      )}

      {/* 몸통 + 발 */}
      <ellipse cx="50" cy="82" rx="19" ry="15" fill="#fff" stroke="#cdd6e6" strokeWidth="1.6" />
      <ellipse cx="40" cy="94" rx="6.5" ry="4" fill="#fff" stroke="#cdd6e6" strokeWidth="1.4" />
      <ellipse cx="60" cy="94" rx="6.5" ry="4" fill="#fff" stroke="#cdd6e6" strokeWidth="1.4" />

      {/* 귀 (머리 뒤에 배치 → 자연스럽게 연결). 곡선 + 둥근 끝 */}
      <path d="M16 30 C 16 14, 20 6, 26 4 C 32 6, 38 16, 45 27 C 34 30, 23 32, 16 30 Z" fill="#fff" stroke="#cdd6e6" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M84 30 C 84 14, 80 6, 74 4 C 68 6, 62 16, 55 27 C 66 30, 77 32, 84 30 Z" fill="#fff" stroke="#cdd6e6" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M23 28 C 23 17, 26 11, 29 10 C 33 13, 37 20, 41 27 C 33 29, 27 30, 23 28 Z" fill="#ffb3d1" />
      <path d="M77 28 C 77 17, 74 11, 71 10 C 67 13, 63 20, 59 27 C 67 29, 73 30, 77 28 Z" fill="#ffb3d1" />
      {/* 머리 (귀 아래를 덮어 자연스럽게) */}
      <circle cx="50" cy="44" r="27" fill="#fff" stroke="#cdd6e6" strokeWidth="1.6" />

      {/* 볼터치 */}
      <ellipse cx="31" cy="50" rx="5" ry="3.1" fill="#ffc2dd" />
      <ellipse cx="69" cy="50" rx="5" ry="3.1" fill="#ffc2dd" />

      {/* 눈 (표정별) */}
      {face === 'happy' ? (
        <g>
          <path d="M33 44 q5 -6 10 0" fill="none" stroke="#3a3f4b" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M57 44 q5 -6 10 0" fill="none" stroke="#3a3f4b" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      ) : face === 'bored' ? (
        <g>
          {/* 반쯤 감긴 눈(축 처짐) */}
          <path d="M34 46 q5 3 10 0" fill="none" stroke="#3a3f4b" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M56 46 q5 3 10 0" fill="none" stroke="#3a3f4b" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      ) : (
        <g className="eyes">
          <ellipse cx="39" cy="45" rx="4.4" ry="5.6" fill="#3a3f4b" />
          <ellipse cx="61" cy="45" rx="4.4" ry="5.6" fill="#3a3f4b" />
          <circle cx="40.6" cy="43" r="1.5" fill="#fff" />
          <circle cx="62.6" cy="43" r="1.5" fill="#fff" />
        </g>
      )}

      {/* 코 */}
      <path d="M47.5 53 L52.5 53 L50 55.5 Z" fill="#ff9ab8" />
      {/* 입 (표정별) */}
      {face === 'happy' ? (
        <path d="M43 55.5 q7 6 14 0" fill="none" stroke="#3a3f4b" strokeWidth="1.8" strokeLinecap="round" />
      ) : face === 'bored' ? (
        <path d="M45.5 57.5 q4.5 1.6 9 0" fill="none" stroke="#3a3f4b" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M50 55.5 q-3 3 -6 1 M50 55.5 q3 3 6 1" fill="none" stroke="#3a3f4b" strokeWidth="1.5" strokeLinecap="round" />
      )}

      {/* 1단 진화: 보라 마법사 모자 (머리 위) */}
      {stage >= 1 && (
        <g>
          <path d="M34 22 Q46 0 61 -3 Q66 7 59 13 L60 22 Z" fill="#8a5cf6" stroke="#5b32b0" strokeWidth="1.3" strokeLinejoin="round" />
          <ellipse cx="49" cy="22" rx="30" ry="6.5" fill="#7b46e0" stroke="#5b32b0" strokeWidth="1.3" />
          <path d="M49 5 l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#ffd35a" />
        </g>
      )}
    </svg>
  );
}
