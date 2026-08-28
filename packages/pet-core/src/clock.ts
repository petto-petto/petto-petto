/**
 * 시간 추상화.
 *
 * 도메인 로직이 `new Date()`를 직접 부르면 그 로직은 테스트할 수 없다. Java에서
 * `LocalDateTime.now()` 대신 `java.time.Clock`을 주입받아 테스트에서 `Clock.fixed(...)`를
 * 넣는 것과 완전히 같은 이야기다.
 *
 * 기획서 8.6의 "같은 로컬 분에 세 소스가 증가해도 활동 시간은 1분" 같은 규칙은 시각을
 * **고정**할 수 있어야 검증된다.
 */
export interface Clock {
  now(): Date;
}

/** 실제 앱이 쓰는 구현. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** 테스트가 쓰는 구현. 시각을 고정하거나 앞으로 밀 수 있다. */
export class FixedClock implements Clock {
  #at: Date;

  constructor(iso: string) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      throw new TypeError(`테스트 시각을 읽을 수 없음: ${iso}`);
    }
    this.#at = at;
  }

  now(): Date {
    return new Date(this.#at);
  }

  /** 초 단위로 시각을 앞으로 민다. */
  advanceSeconds(seconds: number): void {
    this.#at = new Date(this.#at.getTime() + seconds * 1000);
  }

  set(iso: string): void {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      throw new TypeError(`테스트 시각을 읽을 수 없음: ${iso}`);
    }
    this.#at = at;
  }
}
