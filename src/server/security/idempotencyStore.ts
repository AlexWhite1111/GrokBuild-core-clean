import { AppProblem } from "./problemResponse.js";

interface Entry {
  fingerprint: string;
  response: unknown;
  expiresAt: number;
}

export class IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #inflight = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();

  constructor(private readonly ttlMs = 30 * 60_000, private readonly maxEntries = 5_000) {}

  get(requestId: string, fingerprint: string): unknown | undefined {
    this.#prune();
    const existing = this.#entries.get(requestId);
    if (!existing) return undefined;
    if (existing.fingerprint !== fingerprint) {
      throw new AppProblem(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The requestId was already used with a different payload.",
        requestId,
      );
    }
    return existing.response;
  }

  set(requestId: string, fingerprint: string, response: unknown): void {
    this.#prune();
    this.#entries.set(requestId, {
      fingerprint,
      response,
      expiresAt: Date.now() + this.ttlMs,
    });
    if (this.#entries.size > this.maxEntries) {
      const first = this.#entries.keys().next().value as string | undefined;
      if (first) this.#entries.delete(first);
    }
  }

  run(requestId: string, fingerprint: string, operation: () => unknown | Promise<unknown>): Promise<unknown> {
    const cached = this.get(requestId, fingerprint);
    if (cached !== undefined) return Promise.resolve(cached);
    const inflight = this.#inflight.get(requestId);
    if (inflight) {
      if (inflight.fingerprint !== fingerprint) throw conflict(requestId);
      return inflight.promise;
    }
    const promise = Promise.resolve().then(operation).then((response) => {
      this.set(requestId, fingerprint, response);
      return response;
    }).finally(() => this.#inflight.delete(requestId));
    this.#inflight.set(requestId, { fingerprint, promise });
    return promise;
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, value] of this.#entries) {
      if (value.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

function conflict(requestId: string): AppProblem {
  return new AppProblem(409, "IDEMPOTENCY_CONFLICT", "The requestId was already used with a different payload.", requestId);
}
