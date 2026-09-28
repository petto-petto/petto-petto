/**
 * meta feature 를 앱에 끼울 때 필요한 상태.
 *
 * 도메인 규칙, 수집기, 저장소, 다른 도메인 대역을 한 덩어리로 묶는다. 앱은 이것을 만들고
 * 핸들러를 등록하기만 하면 된다.
 *
 * **이 파일에 Electron이 없다.** 창도 IPC도 모른다. 그래서 창을 띄우지 않고 테스트할 수
 * 있고, 앱이 Electron이 아니게 되어도 그대로 쓸 수 있다.
 */

import {
  PROVIDERS,
  localDateOf,
  systemClock,
  type Clock,
  type LocalDate,
  type Provider,
} from '@pet/core';
import { type DomainEvent } from '../events/index.ts';
import {
  AchievementCatalog,
  FixtureCollector,
  evaluate,
  loadState,
  recordEvent,
  runAggregationFor,
  saveState,
  seedDemoUsage,
  sourceOf,
  type AggregationRun,
  type Category,
  type EvaluationOutcome,
  type MetaState,
  type MetaStore,
  type SponsorLinks,
  type UsageCollector,
} from '../index.ts';
import { createMetaState, type CurrencyPort } from '../index.ts';
import { RecordingEventBus, StubGacha } from '../testing/fakes.ts';
import type { CollectionPort, GrowthRules, PetClient } from '../ports/index.ts';

/** 데모 사용량 생성 시드. 고정해 두면 데모 화면이 실행마다 같다. */
const DEMO_SEED = 20_260_824;

export class MetaAppState {
  /** meta 도메인 상태. 메모리에서 돌고, 변경 뒤에 로컬 파일로 저장된다. */
  meta: MetaState;
  /** 저장된 상태 없이 시작했는가. 데모 데이터를 한 번만 심기 위해 쓴다. */
  readonly isFreshInstall: boolean;
  readonly catalog = AchievementCatalog.embedded();
  /**
   * 수집기 경계. 앱이 넣어준다 — 제품은 고정 버전 `ccusage` 어댑터, 데모와 테스트는 픽스처.
   *
   * 예전에는 여기서 `FixtureCollector`를 직접 만들어서 실제 사용량이 화면에 닿을 길이
   * 없었다. 재화·펫과 같은 이유로 밖에서 받는다.
   */
  readonly collector: UsageCollector;
  /**
   * 재화 구현. 앱이 넣어준다.
   *
   * 예전에는 여기서 `new InMemoryCurrency()`를 직접 만들었다. 인메모리라 앱을 끌 때마다
   * 잔액이 0으로 돌아갔고, 멱등 키는 이 패키지의 스냅샷에 남아 다시 지급되지도 않았다 —
   * 코인이 영구히 사라졌다. 저장 수명이 다른 두 곳에 나뉘어 있던 탓이다.
   */
  readonly currency: CurrencyPort;
  /**
   * 보유 펫 조회. **대역이 아니라 앱이 주입한 실제 구현이다.**
   *
   * 예전에는 여기서 `new InMemoryCollection()`을 직접 만들었다. 테스트 대역이 프로덕션
   * 화면에 그대로 실려서, 보유 펫 수와 도감 진행도가 상수로 고정돼 있었다. 소유자가
   * 아닌 것을 소유하지 않도록 밖에서 받는다.
   *
   * 지금은 트로피 배치와 room 의 `pet:overlay` 채널만 이걸 쓴다. 펫 데이터는 `pets` 다.
   */
  readonly collection: CollectionPort;
  /**
   * 공통 펫 데이터. 펫 담당이 공표한 `PetClient` 를 그대로 받는다.
   *
   * 프로필 · 보유 수 · 도감 · 최고 레벨 · 펫 업적 판정이 전부 여기서 읽는다. 예전에는 room 의
   * JSON 명부와 성장 스텁에서 나눠 읽었고, 둘이 같은 펫의 레벨을 다르게 들고 있었다.
   */
  readonly pets: PetClient;
  /** 레벨 곡선. 성장 도메인 것이라 앱이 넣어준다. */
  readonly growthRules: GrowthRules;
  /**
   * 뽑기 조회. 아직 gacha 도메인이 실제 횟수를 주지 않아 대역이다 — 요약의 `뽑은 횟수`가
   * 항상 12 로 보인다. gacha 연결 때 앱이 주입하도록 바꾼다.
   */
  readonly gacha = new StubGacha(12, 4);
  readonly bus = new RecordingEventBus();
  readonly clock: Clock = systemClock;
  /**
   * 기획서 6.4: 주소는 배포 설정으로 주입한다. 프로토타입은 비워 두어 `준비 중`
   * 비활성 상태를 그대로 보여준다(SET-008).
   */
  readonly sponsors: SponsorLinks = {};
  /**
   * 기획서 4.2: 업적 카테고리 필터는 현재 실행 중에만 기억한다.
   * 그래서 `MetaState`(저장 대상)가 아니라 여기 둔다.
   */
  achievementFilter: Category | undefined = undefined;
  /** 진행 중인 집계. `idle()`이 기다린다. */
  readonly #running = new Set<Promise<unknown>>();
  /** 현재 패널이 보여주는 화면. */
  panelScreen = 'info';

  readonly store: MetaStore;
  readonly dataLocation: string;
  readonly version: string;

  /**
   * 저장된 상태가 있으면 그것으로, 없으면 새 설치로 시작한다.
   *
   * 읽기에 실패해도 앱은 뜬다. 저장 파일 하나 때문에 사용자가 앱을 아예 못 쓰는 것보다,
   * 새로 시작하고 그 사실을 알리는 편이 낫다.
   */
  constructor(
    store: MetaStore,
    dataLocation: string,
    version: string,
    collection: CollectionPort,
    currency: CurrencyPort,
    pets: PetClient,
    growthRules: GrowthRules,
    collector: UsageCollector,
  ) {
    this.store = store;
    this.dataLocation = dataLocation;
    this.version = version;
    this.collection = collection;
    this.currency = currency;
    this.pets = pets;
    this.growthRules = growthRules;
    this.collector = collector;

    let restored: MetaState | undefined;
    try {
      restored = loadState(store);
    } catch (error) {
      console.log(`[STORE] 저장된 상태를 읽지 못해 새로 시작합니다 — ${String(error)}`);
    }

    this.isFreshInstall = restored === undefined;
    this.meta = restored ?? createMetaState();
  }

  today(): LocalDate {
    return localDateOf(this.clock.now());
  }

  /**
   * 데모용 사용 기록을 심는다. **첫 집계로 기준점을 잡은 뒤에** 불러야 한다.
   *
   * 새 설치일 때만 심는다. 저장된 상태로 다시 켠 경우에 또 심으면 실행할 때마다
   * 12주치가 새로 쌓여 사용량이 계속 부풀어 오른다.
   */
  seedDemoUsage(): boolean {
    if (!this.isFreshInstall) return false;
    // 실제 수집기에 가짜 기록을 심을 수는 없다. 데모 모드(픽스처)에서만 동작한다.
    if (!(this.collector instanceof FixtureCollector)) return false;
    seedDemoUsage(this.collector, this.today(), DEMO_SEED);
    return true;
  }

  /**
   * 진행 중인 집계가 모두 끝나면 풀린다.
   *
   * 집계는 수집기를 기다리는 동안 멈춰 있다가 이어서 재화를 지급하고 상태를 저장한다. 앱이 그
   * 사이에 저장소를 닫으면 닫힌 저장소에 쓰게 된다. 종료하는 쪽이 이것을 기다린 뒤 닫는다.
   */
  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled([...this.#running]);
  }

  /** 켜진 소스. 기획서 8.4: 꺼진 소스는 수집기를 실행하지도 않는다. */
  #enabled(providers: readonly Provider[]): Provider[] {
    return providers.filter((provider) => sourceOf(this.meta, provider).enabled);
  }

  /**
   * 한 번의 집계와 판정. 앱 시작·1분 주기·`갱신` 버튼이 모두 이 함수를 지난다.
   *
   * 수집기를 먼저 새로 읽고(`refresh`), 그 뒤의 집계는 동기로 끝난다. 집계 도중에는
   * `await`가 없으므로 두 요청이 겹쳐도 기준점을 번갈아 고치지 않는다.
   */
  async aggregate(): Promise<{ run: AggregationRun; outcome: EvaluationOutcome }> {
    return this.#collectAndRun(PROVIDERS);
  }

  /** 카드별 수동 재스캔. 소스를 켜고 끌 때도 그 소스 하나만 이 경로로 다시 본다. */
  async rescan(provider: Provider): Promise<{ run: AggregationRun; outcome: EvaluationOutcome }> {
    return this.#collectAndRun([provider]);
  }

  /**
   * 켜진 소스를 새로 읽고 집계한다.
   *
   * 집계 대상은 **이번에 새로 읽은 소스와 꺼진 소스**다. 기다리는 사이에 켜진 소스는 새로 읽지
   * 않았으므로 뺀다 — 켠 쪽의 요청이 곧 자기 소스를 새로 읽어 기준점을 잡는다. 꺼진 소스는
   * 실행하지 않고 `수집 중지` 상태만 남긴다(8.4).
   */
  #collectAndRun(
    providers: readonly Provider[],
  ): Promise<{ run: AggregationRun; outcome: EvaluationOutcome }> {
    const task = this.#collectAndRunNow(providers);
    this.#running.add(task);
    void task.finally(() => this.#running.delete(task)).catch(() => {});
    return task;
  }

  async #collectAndRunNow(
    providers: readonly Provider[],
  ): Promise<{ run: AggregationRun; outcome: EvaluationOutcome }> {
    const targets = this.#enabled(providers);
    await this.collector.refresh(targets);
    const ready = providers.filter(
      (provider) => targets.includes(provider) || !sourceOf(this.meta, provider).enabled,
    );
    const run = runAggregationFor(this.meta, this.collector, this.currency, this.clock, ready);
    for (const event of run.events) this.bus.publish(event);
    const outcome = evaluate(
      this.meta,
      this.catalog,
      this.currency,
      this.collection,
      this.pets,
      this.growthRules,
      this.clock,
    );
    return { run, outcome };
  }

  /** 이벤트 하나를 받아 업적을 판정한다. 데모의 시연 버튼이 쓴다. */
  ingestEvent(event: DomainEvent): EvaluationOutcome {
    this.bus.publish(event);
    recordEvent(this.meta, event);
    return evaluate(
      this.meta,
      this.catalog,
      this.currency,
      this.collection,
      this.pets,
      this.growthRules,
      this.clock,
    );
  }

  /**
   * 현재 상태를 로컬에 저장한다.
   *
   * 실패해도 앱을 멈추지 않는다. 메모리 상태는 멀쩡하고 다음 저장에서 다시 시도된다.
   */
  persist(): string | undefined {
    try {
      saveState(this.store, this.meta);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[STORE] 저장 실패 — ${message}`);
      return message;
    }
  }
}
