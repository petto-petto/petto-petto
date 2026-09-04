import { useCallback, useEffect, useRef, useState } from 'react';
import { GrowthController } from './controller.js';
import { createPet, requiredXp } from './engine.js';
import { TOKENS_PER_XP } from './constants.js';
import { getPet } from '../pets/catalog.ts';
import { loadAll, saveAll, clearAll } from './storage.js';

let seq = 0;

// 펫별 독립 성장: 펫 key 마다 GrowthController 를 따로 두고, 활성 펫의 상태만 노출한다.
// 토큰/전투 XP 는 "현재 활성 펫"에게만 적용(성장 문서 §3). 펫을 바꾸면 그 펫의 레벨/경험치가 보인다.
export function useGrowth(activePetKey) {
  const controllers = useRef(new Map());
  const savedRef = useRef({}); // 비동기 DB hydrate 후 펫별 스냅샷을 채운다.
  const getCtrl = useCallback((key) => {
    let c = controllers.current.get(key);
    if (!c) {
      const def = getPet(key);
      const base = createPet(key, def?.name ?? key);
      const saved = savedRef.current[key];
      // 저장된 성장 수치(level/xp/stage/tokenBank)는 복원하되 id/name 은 레지스트리 기준으로 유지
      const pet = saved?.pet ? { ...base, ...saved.pet, id: base.id, name: base.name } : base;
      c = new GrowthController(
        pet,
        saved ? { tokenBank: saved.tokenBank, lastBaseXp: saved.lastBaseXp } : null,
      );
      controllers.current.set(key, c);
    }
    return c;
  }, []);
  const activeKeyRef = useRef(activePetKey);

  // 변경 시 펫별 스냅샷을 저장 (작은 JSON → 동기 저장으로 충분, 유실 위험 없음)
  const persist = useCallback(() => {
    const map = {};
    for (const [k, c] of controllers.current) map[k] = c.snapshot();
    void saveAll(map);
  }, []);

  const [pet, setPet] = useState(() => getCtrl(activePetKey).pet);
  const [hydrated, setHydrated] = useState(false);
  const [overlayState, setOverlayState] = useState('idle'); // idle|reaction|gainxp
  const [toasts, setToasts] = useState([]);
  const [session, setSession] = useState(() => ({ toNext: getCtrl(activePetKey)._toNext() }));
  const [levelUpFx, setLevelUpFx] = useState(null);
  const [evolveFx, setEvolveFx] = useState(null);
  const [xpFx, setXpFx] = useState(null); // 경험치 획득 신호 (VFX 트리거)
  const [attackFx, setAttackFx] = useState(null); // 전투 신호 (attack 모션 트리거)
  const [mood, setMood] = useState('normal'); // normal | happy | bored
  const stateTimer = useRef(null);
  const lastXpAt = useRef(Date.now()); // 마지막 경험치 획득 시각
  const happyTimer = useRef(null);

  const pushToast = useCallback((text, kind) => {
    const id = ++seq;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2000);
  }, []);

  const setTransient = useCallback((state, ms) => {
    setOverlayState(state);
    clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => setOverlayState('idle'), ms);
  }, []);

  const fireLevelUp = useCallback((level) => {
    const key = ++seq;
    setLevelUpFx({ key, level });
    setTimeout(() => setLevelUpFx((cur) => (cur && cur.key === key ? null : cur)), 2600);
  }, []);

  const handleResult = useCallback(
    (res) => {
      if (!res) return;
      setPet(res.pet);
      for (const ev of res.events) {
        if (ev.type === 'xp') {
          pushToast(`XP +${ev.amount}`, 'xp');
          setXpFx({ key: ++seq, amount: ev.amount });
        } else if (ev.type === 'evolution-available') pushToast('진화 가능!', 'evo');
      }
      if (res.leveledUp) fireLevelUp(res.pet.level); // 레벨업은 문구(배너)만
      if (res.gained > 0) {
        setTransient('gainxp', 1200);
        // 경험치를 얻으면 신나함(happy) → 잠시 후 normal
        lastXpAt.current = Date.now();
        setMood('happy');
        clearTimeout(happyTimer.current);
        happyTimer.current = setTimeout(() => setMood('normal'), 2500);
      }
    },
    [pushToast, setTransient, fireLevelUp],
  );

  // 상호작용(클릭/드래그/전투) 시 심심 타이머 리셋 + bored 해제
  const pokeActivity = useCallback(() => {
    lastXpAt.current = Date.now();
    setMood((m) => (m === 'bored' ? 'normal' : m));
  }, []);

  // 수동 시연·향후 외부 연동이 호출하는 경험치 반영 진입점.
  const ingestTokens = useCallback(
    (tokens) => {
      if (!hydrated) return;
      const res = getCtrl(activeKeyRef.current).applyNow({ tokens, timestamp: Date.now() });
      setSession({ toNext: res.toNext });
      handleResult(res);
      persist();
    },
    [getCtrl, handleResult, hydrated, persist],
  );

  const addBattleXp = useCallback(
    (amount) => {
      if (!hydrated) return;
      setAttackFx({ key: ++seq }); // 전투 → attack 모션
      pokeActivity();
      handleResult(getCtrl(activeKeyRef.current).addExternalXp(amount, 'battle'));
      persist();
    },
    [getCtrl, handleResult, hydrated, pokeActivity, persist],
  );

  const doEvolve = useCallback(() => {
    if (!hydrated) return;
    const r = getCtrl(activeKeyRef.current).doEvolve();
    if (!r.evolved) return;
    setPet(r.pet);
    const key = ++seq;
    setEvolveFx({ key, stage: r.pet.evolutionStage });
    setTimeout(() => setEvolveFx((cur) => (cur && cur.key === key ? null : cur)), 2800);
    persist();
  }, [getCtrl, hydrated, persist]);

  const reaction = useCallback(() => {
    pokeActivity();
    setTransient('reaction', 900);
  }, [pokeActivity, setTransient]);

  // 저장 초기화 (모든 펫 성장 리셋) — 테스트/디버그용
  const resetAll = useCallback(async () => {
    await clearAll();
    controllers.current.clear();
    savedRef.current = {};
    const c = getCtrl(activeKeyRef.current);
    setPet(c.pet);
    setSession({ toNext: c._toNext() });
    setOverlayState('idle');
    setMood('normal');
  }, [getCtrl]);

  useEffect(() => {
    let alive = true;
    loadAll().then((snapshots) => {
      if (!alive) return;
      savedRef.current = snapshots;
      controllers.current.clear();
      const controller = getCtrl(activeKeyRef.current);
      setPet(controller.pet);
      setSession({ toNext: controller._toNext() });
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [getCtrl]);

  // 활성 펫 변경 → 그 펫 컨트롤러 상태로 화면 미러링 (레벨/경험치가 펫마다 따로)
  useEffect(() => {
    activeKeyRef.current = activePetKey;
    const c = getCtrl(activePetKey);
    setPet(c.pet);
    setSession({ toNext: c._toNext() });
    setOverlayState('idle');
    setMood('normal');
    lastXpAt.current = Date.now();
  }, [activePetKey, getCtrl]);

  // 오래 아무 경험치도 안 들어오면(대화/hook 없음) 심심해함(bored)
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastXpAt.current > 30000) setMood((m) => (m === 'happy' ? m : 'bored'));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // EXP 바를 "누적 토큰(5,000 미만 잔여분)까지" 연속 반영 → 매 사용마다 바가 조금씩 참
  const _req = requiredXp(pet.level);
  const _frac =
    pet.level >= 50 ? 0 : (TOKENS_PER_XP - (session.toNext ?? TOKENS_PER_XP)) / TOKENS_PER_XP;
  const _levelProgress =
    pet.level >= 50 ? 1 : Math.min(1, Math.max(0, (pet.xpIntoLevel + _frac) / _req));

  return {
    pet,
    overlayState,
    toasts,
    session,
    levelUpFx,
    evolveFx,
    xpFx,
    attackFx,
    mood,
    next: _req,
    levelProgress: _levelProgress,
    ingestTokens,
    addBattleXp,
    doEvolve,
    reaction,
    pokeActivity,
    resetAll,
  };
}
