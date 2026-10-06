import { useEffect, useRef } from 'react';
import { setInteractive } from '../platform/bridge.js';

/**
 * 투명 오버레이의 연속 hit-test.
 *
 * 커서가 `.io`(펫·메뉴·패널) 위에 있을 때만 창이 입력을 받고, 그 밖에서는 클릭이 뒤 창으로
 * 통과한다. 이게 없으면 창 전체가 클릭을 먹어 아래 창을 못 쓰거나, 반대로 아무것도 못
 * 누른다 — 실제로 빈 상태 패널이 이 훅 밖에 있어서 버튼이 눌리지 않았다.
 *
 * `forceOn` 은 메뉴처럼 커서가 벗어나도 계속 입력을 받아야 하는 경우에 쓴다.
 */
export function useOverlayHitTest(forceOn = false) {
  const forceRef = useRef(forceOn);
  const lastSent = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = !!(el && el.closest && el.closest('.io'));
      const want = over || forceRef.current;
      if (want !== lastSent.current) {
        lastSent.current = want;
        setInteractive(want);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    forceRef.current = forceOn;
    if (forceOn && lastSent.current !== true) {
      lastSent.current = true;
      setInteractive(true);
    }
  }, [forceOn]);
}
