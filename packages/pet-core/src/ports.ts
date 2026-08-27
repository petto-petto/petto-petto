/**
 * 모든 도메인이 공유하는 최소 계약.
 *
 * ## 여기 있는 것과 없는 것
 *
 * `CurrencyPort`, `CollectionPort` 같은 것은 **여기 없다.** 그것들은 `meta`가 필요해서
 * 만든 인터페이스이므로 `@pet/meta`가 소유한다. 공용 커널에 두면 다섯 도메인의 요구가
 * 한 파일에 쌓여 결국 "공용 쓰레기통"이 되고, 한 도메인이 자기 사정으로 인터페이스를
 * 고칠 때마다 무관한 도메인이 전부 영향을 받는다.
 *
 * 여기 남은 둘은 성격이 다르다.
 *
 * - `EventBus` — 실어 나르는 것(`DomainEvent`)이 이미 공용 계약이라 한 쌍이다.
 * - `PortError` — 포트를 누가 정의하든 실패는 같은 모양으로 다뤄야 화면이 일관되게 처리한다.
 */

import type { DomainEvent } from './events.ts';

/**
 * 포트 호출 실패.
 *
 * 기획서 11.1은 "다른 도메인 조회 실패는 해당 블록만 오류"라고 정한다. 화면이 블록별로
 * 잡아내려면 실패가 구분 가능한 타입이어야 한다.
 */
export class PortError extends Error {
  override readonly name = 'PortError';

  constructor(message: string) {
    super(message);
  }
}

/** 이벤트 발행 경로. 프로토타입은 인프로세스 구현을 쓰지만 계약은 그대로다. */
export interface EventBus {
  publish(event: DomainEvent): void;
}
