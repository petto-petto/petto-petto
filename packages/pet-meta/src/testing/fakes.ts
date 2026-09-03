import { PortError, type DomainEvent, type EventBus } from '../index.ts';
/**
 * 다른 도메인과 저장소의 임시 구현.
 *
 * `collection`, `gacha`, `battle`, `overlay-growth`는 팀의 다른 사람이 만든다. 그 구현이
 * 아직 없으므로 `meta`가 요구하는 포트를 인메모리로 채워 규칙만 검증한다.
 *
 * **`meta`가 상대에게 기대하는 모양을 여기서 드러낸다.** 실제 도메인이 완성되면 이것을
 * 버리고 진짜 어댑터를 쓴다. 그때까지는 테스트와 앱이 같은 한 벌을 공유해서, 규칙을
 * 검증하는 대역과 화면에 보이는 대역이 어긋나지 않게 한다.
 *
 * ## 실패 주입
 *
 * 여러 대역이 `failNext`류의 스위치를 갖는다. 기획서 11.1이 정한 오류 동작 —
 * "재화 보상 실패는 같은 키로 재시도", "다른 도메인 조회 실패는 해당 블록만 오류" —
 * 은 **실패를 만들 수 있어야** 검증된다.
 */

import { petId, type Coin } from '@pet/core';
import type {
  BattlePort,
  CollectionPort,
  CurrencyPort,
  CurrencyTotals,
  DexProgress,
  GachaPort,
  GrantOutcome,
  GrowthPort,
  LedgerEntry,
  MetaSnapshot,
  PetExperience,
  MetaStore,
  PetSummary,
  TrophyPlacement,
} from '@pet/meta';

/** 재화 도메인 대역. */
export class InMemoryCurrency implements CurrencyPort {
  /** 이미 지급한 멱등 키. 기획서 9.5: 같은 키를 중복 지급하지 않는다. */
  #grantedKeys = new Map<string, Coin>();
  #ledger: LedgerEntry[] = [];
  #balance = 0;
  #earned = 0;
  #spent = 0;
  #failNextGrant = false;
  #failQueries = false;
  /** 토큰 → 코인 환산 비율. 재화 도메인의 정책이므로 여기(대역)에 있다. */
  #tokensPerCoin = 10_000;
  #now: Date | undefined;

  /** 원장 항목의 시각을 고정한다. `오늘 획득 코인` 계산을 결정론적으로 만든다. */
  setNow(now: Date): void {
    this.#now = now;
  }

  /** 다음 지급 한 번을 실패시킨다. */
  failNextGrant(): void {
    this.#failNextGrant = true;
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  get grantedKeyCount(): number {
    return this.#grantedKeys.size;
  }

  grantedAmount(rewardKey: string): Coin | undefined {
    return this.#grantedKeys.get(rewardKey);
  }

  /** 소비를 기록한다. 실적 화면의 `소비` 타일 확인용이다. */
  spend(amount: number, reason: string): void {
    this.#balance -= amount;
    this.#spent += amount;
    this.#ledger.push({
      entryId: `spend-${this.#ledger.length}`,
      reason,
      occurredAt: (this.#now ?? new Date()).toISOString(),
      delta: -amount,
    });
  }

  #record(key: string, amount: Coin, reason: string): void {
    this.#grantedKeys.set(key, amount);
    this.#balance += amount;
    this.#earned += amount;
    this.#ledger.push({
      entryId: `grant-${this.#ledger.length}`,
      reason,
      occurredAt: (this.#now ?? new Date()).toISOString(),
      delta: amount,
    });
  }

  grantOnce(rewardKey: string, amount: Coin, reason: string): GrantOutcome {
    if (this.#failNextGrant) {
      this.#failNextGrant = false;
      throw new PortError('재화 지급에 실패했어요');
    }
    if (this.#grantedKeys.has(rewardKey)) return { kind: 'already_granted' };
    this.#record(rewardKey, amount, reason);
    return { kind: 'granted', amount };
  }

  grantUsageTokens(dedupeKey: string, rewardTokens: number, reason: string): GrantOutcome {
    if (this.#failNextGrant) {
      this.#failNextGrant = false;
      throw new PortError('재화 지급에 실패했어요');
    }
    if (this.#grantedKeys.has(dedupeKey)) return { kind: 'already_granted' };
    // 환산은 재화 도메인의 정책이다. meta는 이 계산을 알지 못한다.
    const amount = Math.floor(rewardTokens / this.#tokensPerCoin);
    this.#record(dedupeKey, amount, reason);
    return { kind: 'granted', amount };
  }

  balance(): Coin {
    if (this.#failQueries) throw new PortError('잔액을 불러오지 못했어요');
    return this.#balance;
  }

  recentLedger(limit: number): LedgerEntry[] {
    if (this.#failQueries) throw new PortError('원장을 불러오지 못했어요');
    return [...this.#ledger].reverse().slice(0, limit);
  }

  totals(): CurrencyTotals {
    if (this.#failQueries) throw new PortError('누적 재화를 불러오지 못했어요');
    return { earned: this.#earned, spent: this.#spent, balance: this.#balance };
  }
}

/** collection 도메인 대역. */
export class InMemoryCollection implements CollectionPort {
  /**
   * 팀원이 만든 실제 에셋을 가리킨다. `sprite`는 에셋 가이드의 `slug`이고, 등급 폴더는
   * `rarity`에서, 진화 단계는 `level`에서 나온다(가이드 §3: Lv.20~29 → stage 3).
   * 레벨 21을 고른 것은 의도적이다 — EPIC stage 3만 캔버스가 48px이라 "32 하드코딩"
   * 실수가 있으면 즉시 드러난다.
   */
  #overlayPet: PetSummary = {
    petId: petId('006'),
    name: '별빛마법사',
    level: 21,
    rarity: 'EPIC',
    sprite: 'star_wizard',
  };
  #ownedPets = 3;
  #dex: DexProgress = { owned: 3, total: 24 };
  /** 룸의 남은 빈자리 수. 0이면 트로피가 보관함으로 간다. */
  #roomSlots = 1;
  #trophies: { achievementId: string; placement: TrophyPlacement }[] = [];
  #failTrophy = false;
  #failQueries = false;

  setOverlayPet(pet: PetSummary): void {
    this.#overlayPet = pet;
  }

  setDex(owned: number, total: number): void {
    this.#dex = { owned, total };
  }

  setOwnedPets(count: number): void {
    this.#ownedPets = count;
  }

  setRoomSlots(slots: number): void {
    this.#roomSlots = slots;
  }

  setTrophyFailure(failing: boolean): void {
    this.#failTrophy = failing;
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  get trophies(): readonly { achievementId: string; placement: TrophyPlacement }[] {
    return this.#trophies;
  }

  overlayPet(): PetSummary {
    if (this.#failQueries) throw new PortError('펫 정보를 불러오지 못했어요');
    return this.#overlayPet;
  }

  ownedPetCount(): number {
    if (this.#failQueries) throw new PortError('보유 펫 수를 불러오지 못했어요');
    return this.#ownedPets;
  }

  dexProgress(): DexProgress {
    if (this.#failQueries) throw new PortError('도감을 불러오지 못했어요');
    return this.#dex;
  }

  grantTrophy(achievementId: string, autoPlace: boolean): TrophyPlacement {
    if (this.#failTrophy) throw new PortError('트로피를 지급하지 못했어요');
    // 기획서 7.4: 자동 배치는 첫 빈자리에만 시도하고, 실패하면 보관함으로 간다.
    // 배치 실패가 지급 실패가 되지 않는다는 것이 요점이다.
    let placement: TrophyPlacement = 'storage';
    if (autoPlace && this.#roomSlots > 0) {
      this.#roomSlots -= 1;
      placement = 'room';
    }
    this.#trophies.push({ achievementId, placement });
    return placement;
  }
}

/** gacha 도메인 대역. */
export class StubGacha implements GachaPort {
  #failQueries = false;
  readonly #draws: number;
  readonly #fusions: number;

  constructor(draws: number, fusions: number) {
    this.#draws = draws;
    this.#fusions = fusions;
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  drawCount(): number {
    if (this.#failQueries) throw new PortError('뽑기 기록을 불러오지 못했어요');
    return this.#draws;
  }

  fusionCount(): number {
    if (this.#failQueries) throw new PortError('합성 기록을 불러오지 못했어요');
    return this.#fusions;
  }
}

/** battle 도메인 대역. */
export class StubBattle implements BattlePort {
  #failQueries = false;
  readonly #wins: number;

  constructor(wins: number) {
    this.#wins = wins;
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  totalWins(): number {
    if (this.#failQueries) throw new PortError('전투 기록을 불러오지 못했어요');
    return this.#wins;
  }
}

/** overlay-growth 도메인 대역. */
export class StubGrowth implements GrowthPort {
  #failQueries = false;
  readonly #level: number;
  #experience: PetExperience;

  constructor(level: number, experience?: PetExperience) {
    this.#level = level;
    this.#experience = experience ?? { level: 21, current: 340, required: 500 };
  }

  setExperience(experience: PetExperience): void {
    this.#experience = experience;
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  highestLevel(): number {
    if (this.#failQueries) throw new PortError('성장 기록을 불러오지 못했어요');
    return this.#level;
  }

  petExperience(): PetExperience {
    if (this.#failQueries) throw new PortError('경험치를 불러오지 못했어요');
    return this.#experience;
  }
}

/** 발행된 이벤트를 모아 두는 이벤트 버스. */
export class RecordingEventBus implements EventBus {
  #events: DomainEvent[] = [];

  get events(): readonly DomainEvent[] {
    return this.#events;
  }

  publish(event: DomainEvent): void {
    this.#events.push(event);
  }
}

/**
 * 저장소 대역. 파일 대신 메모리에 스냅샷을 들고 있는다.
 *
 * 실제 앱은 JSON 파일 구현을 쓰지만, 도메인 규칙("재실행하면 기준점이 살아 있는가")은
 * 파일 없이도 검증할 수 있어야 한다.
 */
export class InMemoryMetaStore implements MetaStore {
  #saved: MetaSnapshot | undefined;
  #failSave = false;
  #failLoad = false;
  #saveCount = 0;

  /** 이미 저장된 상태가 있는 채로 시작한다. "앱을 다시 켰다"를 흉내낸다. */
  static withSnapshot(snapshot: MetaSnapshot): InMemoryMetaStore {
    const store = new InMemoryMetaStore();
    store.#saved = snapshot;
    return store;
  }

  setSaveFailure(failing: boolean): void {
    this.#failSave = failing;
  }

  setLoadFailure(failing: boolean): void {
    this.#failLoad = failing;
  }

  get saveCount(): number {
    return this.#saveCount;
  }

  get saved(): MetaSnapshot | undefined {
    return this.#saved;
  }

  load(): MetaSnapshot | undefined {
    if (this.#failLoad) throw new PortError('저장된 상태를 읽지 못했어요');
    return this.#saved;
  }

  save(snapshot: MetaSnapshot): void {
    if (this.#failSave) throw new PortError('저장하지 못했어요');
    // 실제 파일 저장처럼 통째로 갈아 끼운다. JSON을 거쳐 참조 공유도 끊는다.
    this.#saved = JSON.parse(JSON.stringify(snapshot)) as MetaSnapshot;
    this.#saveCount += 1;
  }
}
