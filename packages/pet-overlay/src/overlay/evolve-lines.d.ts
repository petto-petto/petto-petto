/** 펫이 진화시켜 달라고 말을 걸 때 쓰는 대사. 구현은 `evolve-lines.js`. */
export declare const EVOLVE_LINES: readonly string[];

/** 방금 본 대사(`previous`)를 빼고 하나를 고른다. `random` 은 테스트가 고정할 수 있게 받는다. */
export declare function pickEvolveLine(previous: string | null, random?: () => number): string;
