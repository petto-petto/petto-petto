import React, { useRef } from 'react';
import { dragEnd, dragMove, dragStart, openGacha } from '../platform/bridge.js';
import { useOverlayHitTest } from './useHitTest.js';

/**
 * 보유 펫이 0마리일 때의 오버레이.
 *
 * 첫 펫은 뽑기로만 생기는데 메뉴에도 트레이에도 뽑기 진입점이 없다. 뽑기 창을 닫고 나면
 * 여기가 유일한 복귀 경로다.
 *
 * hit-test 훅을 직접 부르는 것이 중요하다. 이 컴포넌트는 `Overlay` 밖에서 그려지는데,
 * 훅이 없으면 창이 계속 클릭 통과 상태로 남아 버튼이 눌리지 않는다.
 *
 * 드래그는 펫과 따로 구현한다. 펫 쪽은 메뉴 닫기·클릭 반응·스프라이트 재생이 얽혀 있어
 * 그대로 가져오면 여기서 쓰지 않는 동작까지 딸려 온다.
 */
export default function EmptyPet() {
  useOverlayHitTest();
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return; // 좌클릭만
    // 버튼 위에서는 드래그를 시작하지 않는다. 포인터를 캡처해 버리면 클릭이 죽는다.
    if (e.target.closest?.('.empty-pet-cta')) return;
    drag.current = { sx: e.screenX, sy: e.screenY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStart(e.screenX, e.screenY);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    // 손떨림으로 창이 미끄러지지 않게 문턱을 둔다. 펫 드래그와 같은 값이다.
    if (!d.moved && Math.abs(e.screenX - d.sx) + Math.abs(e.screenY - d.sy) < 6) return;
    d.moved = true;
    dragMove(e.screenX, e.screenY);
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    dragEnd();
  };

  return (
    <div className="overlay-root">
      <div className="pet-anchor io">
        <div
          className="empty-pet pixel-panel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="드래그: 이동"
        >
          <div className="empty-pet-title">아직 함께할 펫이 없어요</div>
          <div className="empty-pet-body">소환의 숲에서 첫 펫을 만나 보세요.</div>
          <button className="empty-pet-cta pixel-button" onClick={() => void openGacha()}>
            펫 뽑으러 가기
          </button>
        </div>
      </div>
    </div>
  );
}
