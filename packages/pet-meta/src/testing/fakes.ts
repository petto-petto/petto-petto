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
import type { OwnedPet, PetClient, PetGrowth, PetSpecies, Rarity } from '@pet/client';
import type {
  BattlePort,
  CollectionPort,
  CurrencyPort,
  CurrencyTotals,
  GachaPort,
  GrantOutcome,
  GrowthRules,
  LedgerEntry,
  MetaSnapshot,
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
  /** 룸의 남은 빈자리 수. 0이면 트로피가 보관함으로 간다. */
  #roomSlots = 1;
  #trophies: { achievementId: string; placement: TrophyPlacement }[] = [];
  #failTrophy = false;
  #failQueries = false;

  setOverlayPet(pet: PetSummary): void {
    this.#overlayPet = pet;
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

/**
 * 성장 규칙 대역. `@pet/main-overlay` 의 `growth.ts` 와 같은 값이다.
 *
 * 테스트가 실제 곡선을 쓰게 한다. 앱의 `apps/desktop/src/main/growth-rules.ts` 도 같은 값을
 * 들고 있다 — 원본을 import 할 수 없어서 생긴 복사본이고, 성장 패키지가 TS 진입점을 내보내면
 * 둘 다 지운다.
 */
export const STUB_GROWTH_RULES: GrowthRules = {
  maxLevel: 50,
  requiredXp: (level) => 10 + Math.floor(level / 2),
};

/** 마이그레이션 `pet / 1` 이 등록하는 여섯 종. 대역이 실제 시드와 어긋나지 않게 같은 값을 쓴다. */
const SEEDED_SPECIES: readonly PetSpecies[] = [
  { speciesId: '001', name: '도토리다람쥐', rarity: 'EPIC', sprite: 'acorn_squirrel' },
  { speciesId: '002', name: '미드나잇얼룩말', rarity: 'RARE', sprite: 'midnight_zebra' },
  { speciesId: '003', name: '두더지', rarity: 'COMMON', sprite: 'mole_digger' },
  { speciesId: '004', name: '새싹나무', rarity: 'COMMON', sprite: 'sprout_treant' },
  { speciesId: '005', name: '볼주머니햄', rarity: 'RARE', sprite: 'cheek_hamster' },
  { speciesId: '006', name: '별빛마법사', rarity: 'EPIC', sprite: 'star_wizard' },
];

/**
 * 공통 `PetClient` 의 인메모리 대역.
 *
 * 인계 문서의 계약을 따른다 — 목록이 비면 `[]`, 집계가 없으면 `0`, 활성 선택이 없으면
 * `null`, 없는 개체와 저장소 오류는 예외.
 */
export class InMemoryPetClient implements PetClient {
  #pets: OwnedPet[] = [];
  #sequence = 0;
  #failQueries = false;

  /** 테스트용: 한 마리를 바로 만든다. 성장 값을 덮어쓸 수 있다. */
  give(speciesId: string, growth: Partial<PetGrowth> = {}): OwnedPet {
    const [created] = this.createOwnedPets([speciesId]);
    if (created === undefined) throw new Error('생성 실패');
    const updated: OwnedPet = { ...created, ...growth };
    this.#replace(updated);
    return updated;
  }

  /** 테스트용: 합성 재료로 쓰여 사라진 것처럼 지운다. */
  remove(ownedPetId: string): void {
    this.#pets = this.#pets.filter((pet) => pet.ownedPetId !== ownedPetId);
  }

  setQueryFailure(failing: boolean): void {
    this.#failQueries = failing;
  }

  #guard(): void {
    if (this.#failQueries) throw new PortError('펫 정보를 불러오지 못했어요');
  }

  #species(speciesId: string): PetSpecies {
    const species = SEEDED_SPECIES.find((candidate) => candidate.speciesId === speciesId);
    if (species === undefined) throw new PortError(`없는 펫 종류: ${speciesId}`);
    return species;
  }

  #replace(pet: OwnedPet): void {
    this.#pets = this.#pets.map((candidate) =>
      candidate.ownedPetId === pet.ownedPetId ? pet : candidate,
    );
  }

  listSpecies(rarity?: Rarity): PetSpecies[] {
    this.#guard();
    return SEEDED_SPECIES.filter((species) => rarity === undefined || species.rarity === rarity);
  }

  countSpecies(rarity?: Rarity): number {
    return this.listSpecies(rarity).length;
  }

  listOwnedPets(speciesId?: string): OwnedPet[] {
    this.#guard();
    return this.#pets.filter((pet) => speciesId === undefined || pet.speciesId === speciesId);
  }

  getOwnedPet(ownedPetId: string): OwnedPet {
    this.#guard();
    const pet = this.#pets.find((candidate) => candidate.ownedPetId === ownedPetId);
    if (pet === undefined) throw new PortError(`없는 펫: ${ownedPetId}`);
    return pet;
  }

  countOwnedPets(): number {
    return this.listOwnedPets().length;
  }

  countOwnedSpecies(): number {
    return new Set(this.listOwnedPets().map((pet) => pet.speciesId)).size;
  }

  getHighestLevel(): number {
    return this.listOwnedPets().reduce((best, pet) => Math.max(best, pet.level), 0);
  }

  getActivePet(): OwnedPet | null {
    this.#guard();
    return this.#pets.find((pet) => pet.isActive) ?? null;
  }

  createOwnedPets(speciesIds: readonly string[]): OwnedPet[] {
    this.#guard();
    const created = speciesIds.map((speciesId) => {
      this.#sequence += 1;
      return {
        ...this.#species(speciesId),
        ownedPetId: `owned-${this.#sequence}`,
        nickname: null,
        level: 1,
        totalXp: 0,
        xpIntoLevel: 0,
        evolutionStage: 0 as const,
        isActive: false,
      };
    });
    this.#pets = [...this.#pets, ...created];
    return created;
  }

  updateNickname(ownedPetId: string, nickname: string | null): OwnedPet {
    const trimmed = nickname?.trim() ?? '';
    const updated = { ...this.getOwnedPet(ownedPetId), nickname: trimmed === '' ? null : trimmed };
    this.#replace(updated);
    return updated;
  }

  updateGrowth(ownedPetId: string, growth: PetGrowth): OwnedPet {
    const updated = { ...this.getOwnedPet(ownedPetId), ...growth };
    this.#replace(updated);
    return updated;
  }

  setActivePet(ownedPetId: string): OwnedPet {
    const target = this.getOwnedPet(ownedPetId);
    this.#pets = this.#pets.map((pet) => ({
      ...pet,
      isActive: pet.ownedPetId === target.ownedPetId,
    }));
    return this.getOwnedPet(ownedPetId);
  }

  replaceOwnedPets(materialOwnedPetIds: readonly string[], resultSpeciesId: string): OwnedPet {
    for (const id of materialOwnedPetIds) {
      if (this.getOwnedPet(id).isActive) throw new PortError('활성 펫은 재료로 쓸 수 없어요');
    }
    for (const id of materialOwnedPetIds) this.remove(id);
    const [result] = this.createOwnedPets([resultSpeciesId]);
    if (result === undefined) throw new Error('생성 실패');
    return result;
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
