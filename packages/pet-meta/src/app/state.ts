/**
 * meta feature 를 앱에 끼울 때 필요한 상태.
 *
 * 도메인 규칙, 수집기, 저장소, 다른 도메인 대역을 한 덩어리로 묶는다. 앱은 이것을 만들고
 * 핸들러를 등록하기만 하면 된다.
 *
 * **이 파일에 Electron이 없다.** 창도 IPC도 모른다. 그래서 창을 띄우지 않고 테스트할 수
 * 있고, 앱이 Electron이 아니게 되어도 그대로 쓸 수 있다.
 */

import { localDateOf, systemClock, type Clock, type LocalDate, type Provider } from '@pet/core';
import { type DomainEvent } from '../events/index.ts';
import {
  AchievementCatalog,
  FixtureCollector,
  evaluate,
  loadState,
  recordEvent,
  rescanSource,
  runAggregation,
  saveState,
  seedDemoUsage,
  type AggregationRun,
  type Category,
  type EvaluationOutcome,
  type MetaState,
  type MetaStore,
  type SponsorLinks,
} from '../index.ts';
import { createMetaState } from '../index.ts';
import {
  InMemoryCurrency,
  RecordingEventBus,
  StubBattle,
  StubGacha,
  StubGrowth,
} from '../testing/fakes.ts';
import type { CollectionPort } from '../ports/index.ts';

/** 데모 사용량 생성 시드. 고정해 두면 데모 화면이 실행마다 같다. */
const DEMO_SEED = 20_260_824;

export class MetaAppState {
  /** meta 도메인 상태. 메모리에서 돌고, 변경 뒤에 로컬 파일로 저장된다. */
  meta: MetaState;
  /** 저장된 상태 없이 시작했는가. 데모 데이터를 한 번만 심기 위해 쓴다. */
  readonly isFreshInstall: boolean;
  readonly catalog = AchievementCatalog.embedded();
  /** 수집기 경계. 프로토타입은 픽스처, 제품은 고정 버전 `ccusage` 어댑터. */
  readonly collector = FixtureCollector.withEmptySnapshots();
  readonly currency = new InMemoryCurrency();
  /**
   * 보유 펫 조회. **대역이 아니라 앱이 주입한 실제 구현이다.**
   *
   * 예전에는 여기서 `new InMemoryCollection()`을 직접 만들었다. 테스트 대역이 프로덕션
   * 화면에 그대로 실려서, 보유 펫 수와 도감 진행도가 상수로 고정돼 있었다. 소유자가
   * 아닌 것을 소유하지 않도록 밖에서 받는다.
   */
  readonly collection: CollectionPort;
  readonly gacha = new StubGacha(12, 4);
  readonly battle = new StubBattle(31);
  readonly growth = new StubGrowth(18);
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
  constructor(store: MetaStore, dataLocation: string, version: string, collection: CollectionPort) {
    this.store = store;
    this.dataLocation = dataLocation;
    this.version = version;
    this.collection = collection;

    let restored: MetaState | undefined;
    try {
      restored = loadState(store);
    } catch (error) {
      console.log(`[STORE] 저장된 상태를 읽지 못해 새로 시작합니다 — ${String(error)}`);
    }

    this.isFreshInstall = restored === undefined;
    this.meta = restored ?? createMetaState();
    this.currency.setNow(this.clock.now());
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
  seedDemoUsage(): void {
    if (!this.isFreshInstall) return;
    seedDemoUsage(this.collector, this.today(), DEMO_SEED);
  }

  /** 한 번의 집계와 판정. 앱 시작·1분 주기·수동 재스캔이 모두 이 함수를 지난다. */
  aggregate(): { run: AggregationRun; outcome: EvaluationOutcome } {
    const run = runAggregation(this.meta, this.collector, this.currency, this.clock);
    for (const event of run.events) this.bus.publish(event);
    const outcome = evaluate(this.meta, this.catalog, this.currency, this.collection, this.clock);
    return { run, outcome };
  }

  /** 카드별 수동 재스캔. */
  rescan(provider: Provider): { run: AggregationRun; outcome: EvaluationOutcome } {
    const run = rescanSource(this.meta, this.collector, this.currency, this.clock, provider);
    for (const event of run.events) this.bus.publish(event);
    const outcome = evaluate(this.meta, this.catalog, this.currency, this.collection, this.clock);
    return { run, outcome };
  }

  /** 이벤트 하나를 받아 업적을 판정한다. 데모의 시연 버튼이 쓴다. */
  ingestEvent(event: DomainEvent): EvaluationOutcome {
    this.bus.publish(event);
    recordEvent(this.meta, event);
    return evaluate(this.meta, this.catalog, this.currency, this.collection, this.clock);
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
