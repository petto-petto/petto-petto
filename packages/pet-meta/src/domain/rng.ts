/**
 * 아주 작은 결정론적 난수 생성기.
 *
 * `Math.random()`을 쓰지 않는다. 조련사 이름 생성과 데모 픽스처 두 곳 모두 **시드를 고정해
 * 테스트해야** 하는데 그 함수는 고정할 수 없다. 하네스도 이 사용을 금지한다.
 * 암호학적 용도로는 절대 쓰지 않는다.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    // 0이면 생성기가 영원히 0을 뱉으므로 대체값을 넣는다.
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  /** xorshift32. 32비트 부호 없는 정수를 돌려준다. */
  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.#state = x;
    return x;
  }

  /** `0..bound` 범위의 값. `bound`가 0 이하면 0을 돌려준다. */
  below(bound: number): number {
    if (bound <= 0) return 0;
    return this.next() % bound;
  }
}
