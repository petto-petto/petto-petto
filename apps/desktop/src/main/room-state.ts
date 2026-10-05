/**
 * 펫룸 상태. Electron 을 모른다.
 *
 * IPC 등록(`room.ts`)과 나눠 둔 이유: 이 클래스는 명부·활성 펫·성장 투영을 엮는 곳이라 실제
 * SQLite 위에서 검증해야 하는데, `electron` 을 import 하는 모듈은 Electron 밖의 테스트에서
 * 읽을 수 없다(`test/room-state.test.cjs` 참조).
 *
 * ## 진실의 원천은 이 프로세스다
 *
 * 활성 펫은 여러 창(오버레이 · 펫룸 · 패널)이 동시에 보여 준다. 창마다 자기 상태를 들면
 * 어느 것이 맞는지 알 수 없어진다. 그래서 **저장소를 단일 진실 소스로 두고**, 바뀔 때마다
 * 열려 있는 모든 창에 push 이벤트를 보낸다.
 *
 * **활성 펫을 바꾼 창 자신도 예외가 아니다.** 렌더러는 `room:setActivePet`을 호출만 하고,
 * 화면 갱신은 오직 `room:activePetChanged` 구독 콜백에서 한다. 발신 창이 낙관적으로 먼저
 * 그리면 그 창의 로컬 상태와 push 로 받은 상태가 경쟁해 진실의 원천이 둘로 쪼개진다.
 */

import type { WebContents } from 'electron';

import type { PetClient } from '@pet/client';
import type { Clock } from '@pet/core';
import {
  activeCandidate,
  backgroundAt,
  backgroundOf,
  collectionFromRecords,
  growthSeeds,
  isSameBackground,
  roomPetViews,
  withPetGrowth,
  type BackgroundChoice,
  type BackgroundPhase,
  type PetGrowth,
  type PetGrowthSeed,
  type RoomCollection,
  type RoomPetView,
  type Season,
} from '@pet/room';

import type { RoomCollectionPort } from './collection.ts';

/** 펫룸이 앱 껍데기에 요구하는 것. 창을 다루는 일은 room 이 할 수 없다. */
export interface RoomHost {
  /** 펫룸 창을 열거나, 이미 열려 있으면 앞으로 가져온다. */
  showRoom(): void;
  /** 펫룸 창을 닫고 그 자리에 다른 화면을 띄운다. 새 창을 하나 더 여는 것이 아니다. */
  navigate(destination: RoomDestination, sender: WebContents): void;
  /** 열려 있는 **모든** 창에 같은 이벤트를 보낸다. 발신 창도 포함이다. */
  broadcast(channel: string, payload: unknown): void;
}

/** 펫룸에서 건너갈 수 있는 화면. */
export type RoomDestination = 'gacha' | 'combine';

/** 렌더러가 받는 장면 정보. 배경 파일은 렌더러가 이 값으로 조립해 읽는다. */
export interface RoomScene {
  background: BackgroundChoice;
  /** 개발용 미리보기로 배경을 고정해 둔 상태인지. 오버레이의 Growth Debug 가 쓴다. */
  previewing: boolean;
  /** 보유 펫이 없으면 빈 배열이다. */
  pets: RoomPetView[];
}

/**
 * 펫룸 상태.
 *
 * 보유 펫의 정본은 `PetClient`(공통 SQLite)다. 여기서는 그 목록을 명부 모양으로 들고 있다가,
 * 뽑기·합성이 개체를 바꾸면 `reload`로 다시 읽는다. `RoomCollectionPort`는 이 명부를
 * **읽기만** 하므로, 갱신할 때마다 여기서 밀어 넣는다.
 */
export class RoomState {
  #collection: RoomCollection = { pets: [], activePetId: null };
  /** 마지막으로 알린 배경. 계절이나 시간대가 실제로 넘어갔을 때만 브로드캐스트하려고 기억한다. */
  #background: BackgroundChoice;
  /** 개발용 미리보기. 있는 동안에는 시각이 넘어가도 배경을 바꾸지 않는다. */
  #preview: BackgroundChoice | null = null;

  readonly clock: Clock;
  readonly port: RoomCollectionPort;
  readonly pets: PetClient;
  /**
   * 성장 저장소의 현재 값. 레벨·진화 단계의 정본은 그쪽이고 `owned_pets`의 같은 칸은 갱신되지
   * 않으므로, 명부를 다시 읽을 때마다 이 값을 투영해야 한다. 빠뜨리면 활성 펫을 바꾸는 순간
   * 모든 펫이 Lv.1·1단계로 돌아간다.
   */
  readonly growth: () => ReadonlyMap<string, PetGrowth>;

  constructor(
    clock: Clock,
    port: RoomCollectionPort,
    pets: PetClient,
    growth: () => ReadonlyMap<string, PetGrowth>,
  ) {
    this.clock = clock;
    this.port = port;
    this.pets = pets;
    this.growth = growth;
    this.#background = backgroundAt(clock.now());
    // 시작할 때 못 읽어도 앱은 뜬다. 빈 펫룸으로 열리고 다음 `reload`에서 다시 읽는다.
    try {
      this.#load();
    } catch (error) {
      console.log(`[ROOM] 보유 펫을 읽지 못해 빈 펫룸으로 시작합니다 — ${String(error)}`);
    }
  }

  scene(): RoomScene {
    return {
      background: this.#preview ?? this.#background,
      previewing: this.#preview !== null,
      pets: roomPetViews(this.#collection),
    };
  }

  /** 활성 펫이 바뀌었을 때 렌더러들이 받는 값. 보유 펫이 없으면 `null`이다. */
  activeView(): RoomPetView | null {
    return roomPetViews(this.#collection).find((view) => view.isActive) ?? null;
  }

  /**
   * 활성 펫을 바꾸고 모든 창에 알린다.
   *
   * 이미 활성인 펫을 다시 지정해도 브로드캐스트한다 — 렌더러가 자기 상태를 낙관적으로
   * 갱신하지 않으므로, 알리지 않으면 발신 창의 화면이 영영 안 바뀐다.
   */
  setActivePet(ownedPetId: string, host: RoomHost): RoomPetView | null {
    this.pets.setActivePet(ownedPetId);
    this.#load();

    const active = this.activeView();
    if (active) console.log(`[ROOM] 활성 펫 → ${active.name} (${active.ownedPetId})`);
    host.broadcast('room:activePetChanged', active);
    return active;
  }

  /**
   * 뽑기·합성이 개체를 바꾼 뒤 다시 읽는다.
   *
   * 열려 있는 펫룸·오버레이가 새 명부를 읽도록 `room:rosterChanged`를 보낸다. 합성은 재료를
   * 지우므로, 알리지 않으면 열린 펫룸에 이미 없는 펫이 남아 지정할 때 실패한다. 활성 펫이 새로
   * 생겼으면(첫 뽑기) 그것도 알린다.
   */
  reload(host: RoomHost): void {
    const before = this.#collection.activePetId;
    this.#load();
    host.broadcast('room:rosterChanged', roomPetViews(this.#collection));
    if (this.#collection.activePetId !== before) {
      host.broadcast('room:activePetChanged', this.activeView());
    }
  }

  /** 성장 저장소가 개체를 받아들이는 데 필요한 정보. */
  growthSeeds(): PetGrowthSeed[] {
    return growthSeeds(this.#collection);
  }

  /**
   * 성장 저장소가 말하는 레벨·진화 단계를 명부에 반영하고, 달라졌으면 알린다.
   *
   * 레벨과 진화 단계의 정본은 성장 저장소다(`PetGrowthRepository` 참조). 여기서 하는 일은
   * 그 값을 명부에 **투영**하는 것뿐이라, 이 메서드가 값을 만들어 내지 않는다.
   *
   * 성장은 활성 펫에게만 적용되므로 알릴 값도 활성 펫 뷰 하나면 충분하다. 실제로 바뀐 게
   * 없으면 브로드캐스트하지 않는다 — 성장 저장은 자주 일어나고, 매번 전 창을 깨울 이유가
   * 없다.
   */
  applyGrowth(growth: ReadonlyMap<string, PetGrowth>, host: RoomHost): void {
    const before = this.activeView();
    this.#collection = withPetGrowth(this.#collection, growth);
    this.port.update(this.#collection);

    const after = this.activeView();
    if (!after || (after.level === before?.level && after.stage === before.stage)) return;
    host.broadcast('room:activePetChanged', after);
  }

  /**
   * 시각이 넘어갔으면 배경을 바꾸고 알린다.
   *
   * 앱의 1분 주기 타이머에 얹힌다. 창을 다시 열지 않아도 20시가 되면 밤 배경으로 넘어가고,
   * 12월 1일이 되면 겨울로 바뀐다. 미리보기로 고정해 둔 동안에는 화면을 빼앗지 않는다.
   */
  refreshBackground(host: RoomHost): void {
    const next = backgroundAt(this.clock.now());
    if (isSameBackground(next, this.#background)) return;
    this.#background = next;
    if (this.#preview) return;
    host.broadcast('room:backgroundChanged', next);
  }

  /**
   * 개발용: 계절·시간대를 골라 배경을 고정한다. `null`이면 지금 시각의 배경으로 돌아간다.
   *
   * 배경 16장을 실제 날짜가 오기를 기다리지 않고 확인하려고 둔다. 상태를 main 이 들고 있어서
   * 오버레이에서 고른 값이 열려 있는 펫룸에 바로 보이고, 펫룸을 새로 열어도 유지된다.
   */
  previewBackground(
    choice: { season: Season; phase: BackgroundPhase } | null,
    host: RoomHost,
  ): void {
    this.#preview = choice ? backgroundOf(choice.season, choice.phase) : null;
    host.broadcast('room:backgroundChanged', this.#preview ?? this.#background);
  }

  /**
   * `PetClient`에서 명부를 다시 읽는다.
   *
   * 보유 펫이 있는데 활성이 없으면 첫 마리를 세우고 저장한다. 그대로 두면 오버레이에 아무것도
   * 안 뜨고, `PetClient`와 펫룸이 "활성 없음"을 서로 다르게 다루게 된다.
   */
  #load(): void {
    let { collection, skipped } = collectionFromRecords(this.pets.listOwnedPets());
    for (const record of skipped) {
      console.log(
        `[ROOM] 펫룸이 모르는 종이라 뺍니다 — ${record.speciesId} (${record.ownedPetId})`,
      );
    }
    const candidate = activeCandidate(collection);
    if (candidate !== null) {
      this.pets.setActivePet(candidate);
      collection = { ...collection, activePetId: candidate };
    }
    this.#collection = withPetGrowth(collection, this.growth());
    this.port.update(this.#collection);
  }
}
