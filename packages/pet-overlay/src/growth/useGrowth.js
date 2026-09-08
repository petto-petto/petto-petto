import { useCallback, useEffect, useRef, useState } from 'react';
import { GrowthController } from './controller.js';
import { createPet, requiredXp } from './engine.js';
import { TOKENS_PER_XP } from './constants.js';
import { loadAll, saveAll, clearAll } from './storage.js';

let seq = 0;

// 개체별 독립 성장: 보유 펫 **한 마리마다** GrowthController 를 따로 두고, 활성 펫의 상태만
// 노출한다. 토큰/전투 XP 는 "현재 활성 펫"에게만 적용(성장 문서 §3).
//
// 키가 종(`mole_digger`)이 아니라 개체 id(`seed-001`)인 이유: 종을 키로 쓰면 같은 종 두
// 마리의 성장이 한 기록에서 합쳐져 서로를 덮어쓴다. 누가 활성인지는 명부가 정하므로
// (`App.jsx`) 여기서는 받은 개체를 그리기만 한다.
export function useGrowth(activePet) {
  const activeId = activePet?.ownedPetId ?? null;
  const controllers = useRef(new Map());
  const petKeys = useRef(new Map()); // 개체 id → 종 key. 스프라이트와 저장에 쓴다.
  const savedRef = useRef({}); // 비동기 DB 로드 후 개체별 스냅샷을 채운다.
  const activeRef = useRef(activePet);
  // 활성 펫이 아직 안 정해진 순간에도 화면이 그려져야 한다. 저장되지 않는다 — `persist` 가
  // controllers 맵만 훑기 때문에 여기 쌓인 값은 디스크에 닿지 않는다. 훅 인스턴스마다
  // 따로 두어, 창을 다시 마운트하면 이전 상태가 남지 않는다.
  const noPetRef = useRef(null);

  const getCtrl = useCallback((pet) => {
    const id = pet?.ownedPetId ?? null;
    if (id === null) {
      noPetRef.current ??= new GrowthController(createPet('none', '—'), null);
      return noPetRef.current;
    }

    let c = controllers.current.get(id);
    if (!c) {
      const saved = savedRef.current[id];
      // 표시명은 **명부**가 정본이다. 저장된 이름을 쓰면 펫룸에서 닉네임을 바꿔도 오버레이만
      // 옛 이름을 계속 복원해, 한 창 안에서 두 이름이 보인다.
      const base = createPet(id, pet.name ?? saved?.pet?.name ?? id);
      // 저장된 성장 수치(level/xp/stage/tokenBank)는 복원하되 id/name 은 명부 기준으로 유지
      const restored = saved?.pet ? { ...base, ...saved.pet, id: base.id, name: base.name } : base;
      c = new GrowthController(
        restored,
        saved ? { tokenBank: saved.tokenBank, lastBaseXp: saved.lastBaseXp } : null,
      );
      controllers.current.set(id, c);
    }
    petKeys.current.set(id, petKeyOf(savedRef.current[id], pet));
    return c;
  }, []);

  // 변경 시 개체별 스냅샷을 저장 (작은 JSON → 동기 저장으로 충분, 유실 위험 없음)
  const persist = useCallback(() => {
    const map = {};
    for (const [id, c] of controllers.current) {
      map[id] = { petKey: petKeys.current.get(id) ?? id, ...c.snapshot() };
    }
    void saveAll(map);
  }, []);

  const [pet, setPet] = useState(() => getCtrl(activePet).pet);
  const [hydrated, setHydrated] = useState(false);
  const [overlayState, setOverlayState] = useState('idle'); // idle|reaction|gainxp
  const [toasts, setToasts] = useState([]);
  const [session, setSession] = useState(() => ({ toNext: getCtrl(activePet)._toNext() }));
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
      const res = getCtrl(activeRef.current).applyNow({ tokens, timestamp: Date.now() });
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
      handleResult(getCtrl(activeRef.current).addExternalXp(amount, 'battle'));
      persist();
    },
    [getCtrl, handleResult, hydrated, pokeActivity, persist],
  );

  const doEvolve = useCallback(() => {
    if (!hydrated) return;
    const r = getCtrl(activeRef.current).doEvolve();
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
    // main 이 명부 전원을 Lv.1 로 다시 깔았다. 그 결과를 읽어야 화면과 명부가 같은 값을
    // 말한다 — 안 읽으면 오버레이만 로컬로 Lv.1 을 그리고 명부는 옛 레벨을 유지한다.
    savedRef.current = await loadAll();
    controllers.current.clear();
    petKeys.current.clear();
    const c = getCtrl(activeRef.current);
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
      petKeys.current.clear();
      const controller = getCtrl(activeRef.current);
      setPet(controller.pet);
      setSession({ toNext: controller._toNext() });
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [getCtrl]);

  // 활성 펫 변경 → 그 개체 컨트롤러 상태로 화면 미러링 (레벨/경험치가 개체마다 따로).
  // 개체 id 로만 반응한다 — 명부 뷰 객체는 push 마다 새로 오므로 객체 동일성으로 걸면
  // 아무것도 안 바뀐 push 에도 화면이 idle 로 되감긴다.
  useEffect(() => {
    activeRef.current = activePet;
    const c = getCtrl(activePet);
    setPet(c.pet);
    setSession({ toNext: c._toNext() });
    setOverlayState('idle');
    setMood('normal');
    lastXpAt.current = Date.now();
  }, [activeId, getCtrl]);

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

/** 종도 명부가 정본이다. 저장된 값은 명부가 말해 주지 않을 때만 쓴다. */
function petKeyOf(saved, pet) {
  return pet?.petKey ?? saved?.petKey ?? pet?.ownedPetId;
}
