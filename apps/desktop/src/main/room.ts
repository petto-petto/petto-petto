/**
 * 펫룸 feature 를 Electron 에 끼운다.
 *
 * `mount.ts`가 meta 에 하는 일을 room 에 한다 — `@pet/room`은 Electron 을 모르고, 여기서
 * 그 요구를 IPC 와 창으로 채워 준다. 규칙은 한 줄도 여기 없다.
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

import { ipcMain } from 'electron';

import type { Clock } from '@pet/core';
import {
  backgroundAt,
  fromSnapshot,
  roomPetViews,
  toSnapshot,
  withActivePet,
  type BackgroundChoice,
  type RoomCollection,
  type RoomPetView,
  type RoomStore,
} from '@pet/room';

import type { RoomCollectionPort } from './collection.ts';

/** 펫룸이 앱 껍데기에 요구하는 것. 창을 다루는 일은 room 이 할 수 없다. */
export interface RoomHost {
  /** 펫룸 창을 열거나, 이미 열려 있으면 앞으로 가져온다. */
  showRoom(): void;
  /** 열려 있는 **모든** 창에 같은 이벤트를 보낸다. 발신 창도 포함이다. */
  broadcast(channel: string, payload: unknown): void;
}

/** 렌더러가 받는 장면 정보. 배경 파일은 렌더러가 이 값으로 조립해 읽는다. */
export interface RoomScene {
  background: BackgroundChoice;
  pets: RoomPetView[];
}

/**
 * 저장된 명부를 읽는다. 없거나 손상됐으면 시드로 시작한다.
 *
 * `RoomState` 생성자가 아니라 밖에 두는 이유: 명부는 `RoomCollectionPort`(meta 쪽)와
 * `RoomState`(펫룸 쪽)가 **같은 값**으로 시작해야 하는데, 둘 다 각자 읽으면 파일을 두 번
 * 읽게 되고 그 사이에 값이 달라질 여지가 생긴다. 한 번 읽어 둘에게 나눠 준다.
 */
export function loadRoomCollection(store: RoomStore): RoomCollection {
  try {
    return fromSnapshot(store.load());
  } catch (error) {
    // 저장 파일 하나 때문에 펫룸이 아예 안 열리는 것보다 시드로 시작하는 편이 낫다.
    console.log(`[ROOM] 저장된 펫룸 상태를 읽지 못해 시드로 시작합니다 — ${String(error)}`);
    return fromSnapshot(undefined);
  }
}

/**
 * 펫룸 상태.
 *
 * 명부를 소유하고, 바뀔 때마다 저장하고 브로드캐스트한다. `RoomCollectionPort`는 이 명부를
 * **읽기만** 하므로, 갱신할 때마다 여기서 밀어 넣는다.
 */
export class RoomState {
  #collection: RoomCollection;
  /** 마지막으로 알린 배경. 낮↔밤이 실제로 넘어갔을 때만 브로드캐스트하기 위해 기억한다. */
  #background: BackgroundChoice;

  readonly store: RoomStore;
  readonly clock: Clock;
  readonly port: RoomCollectionPort;

  constructor(
    store: RoomStore,
    clock: Clock,
    port: RoomCollectionPort,
    collection: RoomCollection,
  ) {
    this.store = store;
    this.clock = clock;
    this.port = port;
    this.#collection = collection;
    this.#background = backgroundAt(clock.now());
  }

  scene(): RoomScene {
    return { background: this.#background, pets: roomPetViews(this.#collection) };
  }

  /** 활성 펫이 바뀌었을 때 렌더러들이 받는 값. */
  activeView(): RoomPetView {
    const active = roomPetViews(this.#collection).find((view) => view.isActive);
    // `RoomCollection`은 활성 펫이 항상 하나임을 구조적으로 보장한다.
    if (!active) throw new Error('활성 펫이 없습니다');
    return active;
  }

  /**
   * 활성 펫을 바꾸고 모든 창에 알린다.
   *
   * 이미 활성인 펫을 다시 지정해도 브로드캐스트한다 — 렌더러가 자기 상태를 낙관적으로
   * 갱신하지 않으므로, 알리지 않으면 발신 창의 화면이 영영 안 바뀐다.
   */
  setActivePet(ownedPetId: string, host: RoomHost): RoomPetView {
    this.#collection = withActivePet(this.#collection, ownedPetId);
    this.port.update(this.#collection);
    this.persist();

    const active = this.activeView();
    console.log(`[ROOM] 활성 펫 → ${active.name} (${active.ownedPetId})`);
    host.broadcast('room:activePetChanged', active);
    return active;
  }

  /**
   * 시각이 넘어갔으면 배경을 바꾸고 알린다.
   *
   * 앱의 1분 주기 타이머에 얹힌다. 창을 다시 열지 않아도 18시에 밤이 된다.
   */
  refreshBackground(host: RoomHost): void {
    const next = backgroundAt(this.clock.now());
    if (next.id === this.#background.id) return;
    this.#background = next;
    host.broadcast('room:backgroundChanged', next);
  }

  /** 저장 실패는 앱을 멈추지 않는다. 메모리 상태는 멀쩡하고 다음 저장에서 다시 시도된다. */
  persist(): void {
    try {
      this.store.save(toSnapshot(this.#collection));
    } catch (error) {
      console.log(`[ROOM] 펫룸 상태를 저장하지 못했습니다 — ${String(error)}`);
    }
  }
}

function ownedPetIdFrom(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`펫 식별자가 올바르지 않습니다: ${String(value)}`);
}

/** room 의 채널을 IPC 에 등록한다. 채널 이름은 room 이 소유한다. */
export function mountRoom(state: RoomState, host: RoomHost): void {
  ipcMain.handle('room:scene', () => state.scene());
  ipcMain.handle('room:open', () => {
    host.showRoom();
  });
  ipcMain.handle('room:setActivePet', (_event, ownedPetId: unknown) =>
    state.setActivePet(ownedPetIdFrom(ownedPetId), host),
  );
}
