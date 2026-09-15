import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MOTIONS, SPRITE_META, spritePng } from '../pets/catalog.ts';

// 담당자 제공 도트 스프라이트 렌더러 (README: pets/README.md).
// - 한 모션 = 가로 1행 시트 PNG. 프레임 i 소스 = (i×fw, 0, fw, fh)
// - idle 무한 루프 / click·click2·attack 1회 재생 후 idle 복귀
// - 확대는 정수 배율 nearest-neighbor (imageSmoothingEnabled=false)
// 메타는 fetch 없이 번들 모듈(SPRITE_META)에서 동기 참조 → Electron file:// 에서도 동작.

const imgCache = new Map(); // src -> HTMLImageElement(로드 완료)
const TARGET_H = 100; // 표시 목표 높이(px). 정수 배율은 여기서 산출(32→×3=96, 48→×2=96).

function metaFor(petId, stage, motion) {
  return SPRITE_META[`${petId}:${stage}:${motion}`];
}

function loadImage(src) {
  const cached = imgCache.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imgCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('sprite load fail: ' + src));
    img.src = src;
  });
}

export default forwardRef(function PetSprite({ pet, stage, onError }, ref) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  // 현재 재생 상태 + 모션별 이미지 캐시(현재 pet/stage 한정)
  const stateRef = useRef({ motion: 'idle', startMs: 0, img: null, meta: null });
  const imagesRef = useRef({}); // motion -> HTMLImageElement
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // pet/stage 변경 → idle 로드 후 나머지 모션 프리로드
  useEffect(() => {
    let alive = true;
    setReady(false);
    setFailed(false);
    imagesRef.current = {};
    (async () => {
      try {
        const idleImg = await loadImage(spritePng(pet, stage, 'idle'));
        if (!alive) return;
        imagesRef.current.idle = idleImg;
        stateRef.current = {
          motion: 'idle',
          startMs: performance.now(),
          img: idleImg,
          meta: metaFor(pet.petId, stage, 'idle'),
        };
        setReady(true);
        // click/click2/attack 백그라운드 프리로드(실패 무시 → 없으면 그 모션만 스킵)
        for (const m of MOTIONS) {
          if (m === 'idle') continue;
          loadImage(spritePng(pet, stage, m))
            .then((im) => {
              imagesRef.current[m] = im;
            })
            .catch(() => {});
        }
      } catch (e) {
        if (!alive) return;
        setFailed(true);
        onError?.(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pet.key, pet.petId, stage]);

  // rAF 렌더 루프
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const tick = (now) => {
      const st = stateRef.current;
      const { img, meta } = st;
      if (img && meta) {
        const period = 1000 / meta.fps;
        const f = Math.floor((now - st.startMs) / period);
        let i;
        if (meta.loop) {
          i = f % meta.n;
        } else {
          i = Math.min(f, meta.n - 1);
          if (f >= meta.n) {
            // 1회 재생 종료 → idle 복귀
            const idleImg = imagesRef.current.idle;
            const idleMeta = metaFor(pet.petId, stage, 'idle');
            stateRef.current = { motion: 'idle', startMs: now, img: idleImg, meta: idleMeta };
          }
        }
        const scale = Math.max(1, Math.round(TARGET_H / meta.fh));
        const dw = meta.fw * scale,
          dh = meta.fh * scale;
        if (canvas.width !== dw || canvas.height !== dh) {
          canvas.width = dw;
          canvas.height = dh;
        }
        ctx.imageSmoothingEnabled = false; // 크기 변경 시 리셋되므로 매 프레임 재설정
        ctx.clearRect(0, 0, dw, dh);
        ctx.drawImage(img, i * meta.fw, 0, meta.fw, meta.fh, 0, 0, dw, dh);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, pet.petId, stage]);

  // 상위(Overlay)에서 클릭/전투 시 모션 재생
  useImperativeHandle(
    ref,
    () => ({
      play(motion) {
        const img = imagesRef.current[motion];
        const meta = metaFor(pet.petId, stage, motion);
        if (!img || !meta) return; // 미로드/미존재 → 무시(idle 유지)
        stateRef.current = { motion, startMs: performance.now(), img, meta };
      },
    }),
    [pet.petId, stage],
  );

  if (failed) return null; // 상위에서 SVG 폴백
  return <canvas ref={canvasRef} className="pet-sprite" aria-hidden />;
});
