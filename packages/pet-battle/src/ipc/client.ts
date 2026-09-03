import type { BattleCommand, BattleGateway, BattleResult } from '../contracts.ts';

export interface JsonLineTransport {
  send(line: string): void;
  onLine(listener: (line: string) => void): () => void;
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
  resolve(result: BattleResult): void;
  reject(error: Error): void;
}

export class RustBattleClient implements BattleGateway {
  readonly #transport: JsonLineTransport;
  readonly #requestId: () => string;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #unsubscribe: () => void;

  constructor(transport: JsonLineTransport, requestId: () => string = () => crypto.randomUUID()) {
    this.#transport = transport;
    this.#requestId = requestId;
    this.#unsubscribe = transport.onLine((line) => this.#receive(line));
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    const requestId = this.#requestId();
    const request: WireRequest = { requestId, command };
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#transport.send(JSON.stringify(request));
    });
  }

  dispose(): void {
    this.#unsubscribe();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error('battle sidecar client disposed'));
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
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
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
