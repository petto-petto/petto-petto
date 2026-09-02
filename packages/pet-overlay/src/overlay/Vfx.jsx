import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// 캔버스 파티클 VFX.
//  - 진화: 펫을 휘감고 소용돌이치는 무지개 오라(나선 필라멘트) + 화이트 플래시
//  - 레벨업: 골드 분수 / XP: 스파클
const SIZE = 480;
const CX = SIZE / 2;
const CY = SIZE / 2;

function drawStar(ctx, x, y, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

const Vfx = forwardRef(function Vfx(_, ref) {
  const canvasRef = useRef(null);
  const S = useRef({ particles: [], wisps: [], rings: [], flash: 0, aura: null, t: 0, raf: 0, running: false, ctx: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    S.current.ctx = ctx;
    return () => cancelAnimationFrame(S.current.raf);
  }, []);

  function loop() {
    const s = S.current;
    if (s.running || !s.ctx) return;
    s.running = true;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(40, now - last) / 1000;
      last = now;
      step(dt);
      const busy = s.particles.length || s.wisps.length || s.rings.length || s.flash > 0 || (s.aura && s.aura.life > 0);
      if (busy) s.raf = requestAnimationFrame(tick);
      else { s.running = false; s.ctx.clearRect(0, 0, SIZE, SIZE); }
    };
    s.raf = requestAnimationFrame(tick);
  }

  function push(p) { S.current.particles.push(p); }

  function spawnWisp() {
    const s = S.current;
    const life = 0.7 + Math.random() * 1.1;
    s.wisps.push({
      r: 46 + Math.random() * 92,                         // 펫을 감싸는 반경
      theta: Math.random() * Math.PI * 2,
      omega: (2.0 + Math.random() * 2.4) * (Math.random() < 0.85 ? 1 : -1), // 대부분 한 방향 → 휘몰아침
      dr: -(8 + Math.random() * 22),                       // 안쪽으로 빨려드는 소용돌이
      arc: 0.5 + Math.random() * 1.1,                      // 필라멘트 길이(호)
      hue: Math.floor(Math.random() * 360),
      life, max: life,
    });
  }

  function step(dt) {
    const s = S.current;
    const ctx = s.ctx;
    s.t += dt;

    // 오라: 지속적으로 위스프(필라멘트) 생성
    if (s.aura && s.aura.life > 0) {
      s.aura.life -= dt;
      if (s.aura.life > 0.25) { const n = 3; for (let i = 0; i < n; i++) spawnWisp(); }
    }

    for (const w of s.wisps) { w.life -= dt; w.theta += w.omega * dt; w.r = Math.max(16, w.r + w.dr * dt); w.hue = (w.hue + dt * 120) % 360; }
    s.wisps = s.wisps.filter((w) => w.life > 0);
    for (const p of s.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; }
    s.particles = s.particles.filter((p) => p.life > 0);
    for (const r of s.rings) { r.life -= dt; r.r += r.vr * dt; }
    s.rings = s.rings.filter((r) => r.life > 0);
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt / 0.5);

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 오라 소프트 글로우(맥동)
    if (s.aura && s.aura.life > 0) {
      const a = Math.min(1, s.aura.life / s.aura.max) * (0.7 + 0.3 * Math.sin(s.t * 7));
      const g = ctx.createRadialGradient(CX, CY, 12, CX, CY, 150);
      g.addColorStop(0, `rgba(150,120,255,${0.22 * a})`);
      g.addColorStop(0.55, `rgba(56,230,255,${0.12 * a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // 나선 필라멘트(위스프) — 펫 주위를 휘감으며 안쪽으로 빨려듦
    for (const w of s.wisps) {
      ctx.globalAlpha = Math.max(0, w.life / w.max) * 0.7;
      ctx.strokeStyle = `hsl(${Math.floor(w.hue)},100%,64%)`;
      ctx.lineWidth = 2.6;
      ctx.shadowBlur = 14;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(CX, CY, w.r, w.theta, w.theta + w.arc);
      ctx.stroke();
    }

    // 확장 링
    for (const r of s.rings) {
      ctx.globalAlpha = Math.max(0, r.life / r.max);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.shadowBlur = 16;
      ctx.shadowColor = r.color;
      ctx.beginPath(); ctx.arc(CX, CY, r.r, 0, Math.PI * 2); ctx.stroke();
    }

    // 화이트 플래시
    if (s.flash > 0) {
      const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 230);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * s.flash})`);
      g.addColorStop(0.4, `rgba(255,255,255,${0.32 * s.flash})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // 스파클
    for (const p of s.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = p.color;
      if (p.kind === 'star') drawStar(ctx, p.x, p.y, p.size * 1.8, p.size * 0.7, 4);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  const api = {
    evolve() {
      const s = S.current;
      if (!s.ctx) return;
      s.flash = 1;
      s.aura = { life: 1.9, max: 1.9 };
      for (let i = 0; i < 14; i++) spawnWisp(); // 시작부터 꽉 차게
      s.rings.push({ r: 14, vr: 380, life: 0.9, max: 0.9, color: '#ffffff', width: 4 });
      s.rings.push({ r: 8, vr: 280, life: 1.1, max: 1.1, color: '#c9a8ff', width: 3 });
      // 위로 흩날리는 반짝임
      for (let i = 0; i < 26; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 20 + Math.random() * 90;
        const life = 0.5 + Math.random() * 1.1;
        push({
          x: CX + Math.cos(ang) * rad, y: CY + Math.sin(ang) * rad,
          vx: (Math.random() - 0.5) * 24, vy: -(24 + Math.random() * 60), g: -6,
          life, max: life, size: 1.4 + Math.random() * 2,
          color: `hsl(${Math.floor(Math.random() * 360)},100%,74%)`, kind: 'star',
        });
      }
      loop();
    },
    levelUp() {
      const s = S.current;
      if (!s.ctx) return;
      s.rings.push({ r: 12, vr: 260, life: 0.8, max: 0.8, color: '#ffd35a', width: 3 });
      for (let i = 0; i < 80; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const spd = 150 + Math.random() * 260;
        const life = 0.7 + Math.random() * 1.0;
        push({
          x: CX, y: CY + 8,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, g: 280,
          life, max: life, size: 2 + Math.random() * 3,
          color: Math.random() < 0.5 ? '#ffd35a' : '#fff4c0',
          kind: Math.random() < 0.25 ? 'star' : 'dot',
        });
      }
      loop();
    },
    xp() {
      const s = S.current;
      if (!s.ctx) return;
      for (let i = 0; i < 16; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 130;
        const life = 0.5 + Math.random() * 0.5;
        push({
          x: CX, y: CY + 4,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 40, g: 120,
          life, max: life, size: 1.5 + Math.random() * 2.5,
          color: Math.random() < 0.5 ? '#6dffa0' : '#38e6ff', kind: 'dot',
        });
      }
      loop();
    },
  };

  useImperativeHandle(ref, () => api, []);

  return <canvas ref={canvasRef} className="vfx-canvas" style={{ width: SIZE, height: SIZE }} />;
});

export default Vfx;
