import type { BattleCommand, BattleGateway, BattleResult } from '../contracts.ts';

export interface JsonLineTransport {
  send(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  onError?(listener: (error: Error) => void): () => void;
}

interface WireRequest {
  requestId: string;
  command: BattleCommand;
}

interface WireResponse {
  requestId: string;
  ok: boolean;
  state: unknown;
  events: unknown[];
  error?: string | null;
}

interface PendingRequest {
  timer: ReturnType<typeof setTimeout>;
  resolve(result: BattleResult): void;
  reject(error: Error): void;
}

export class RustBattleClient implements BattleGateway {
  readonly #transport: JsonLineTransport;
  readonly #requestId: () => string;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #unsubscribe: () => void;
  readonly #unsubscribeError: (() => void) | undefined;
  readonly #timeoutMs: number;
  #failure: Error | undefined;

  constructor(
    transport: JsonLineTransport,
    requestId: () => string = () => crypto.randomUUID(),
    timeoutMs = 5000,
  ) {
    this.#transport = transport;
    this.#requestId = requestId;
    this.#timeoutMs = timeoutMs;
    this.#unsubscribe = transport.onLine((line) => this.#receive(line));
    this.#unsubscribeError = transport.onError?.((error) => this.#fail(error));
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    if (this.#failure) return Promise.reject(this.#failure);
    const requestId = this.#requestId();
    const request: WireRequest = { requestId, command };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error('battle sidecar timeout'));
      }, this.#timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      try {
        this.#transport.send(JSON.stringify(request));
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.#unsubscribe();
    this.#unsubscribeError?.();
    this.#fail(new Error('battle sidecar client disposed'));
  }

  #fail(error: Error): void {
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #receive(line: string): void {
    let response: WireResponse;
    try {
      response = JSON.parse(line) as WireResponse;
    } catch {
      return;
    }
    if (!response || typeof response !== 'object') return;
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
    clearTimeout(pending.timer);
    if (!response.ok) {
      pending.reject(new Error(response.error ?? 'battle sidecar request failed'));
      return;
    }
    pending.resolve({
      state: response.state as BattleResult['state'],
      events: response.events as BattleResult['events'],
    });
  }
}
