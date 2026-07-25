import type { TextClipAuthoritySnapshot } from "../shared/contracts.js";
import type { TextClipReconciliationResult, TextClipStore } from "./TextClipStore.js";

export interface TextClipReconcilerOptions {
  loadAuthority: () => Promise<TextClipAuthoritySnapshot>;
  intervalMs: number;
  orphanGraceMs: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

/** Keeps the shell-owned temp store aligned with durable backend references. */
export class TextClipReconciler {
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<TextClipReconciliationResult> | null = null;

  constructor(
    private readonly store: TextClipStore,
    private readonly options: TextClipReconcilerOptions,
  ) {}

  async start(): Promise<TextClipReconciliationResult> {
    if (!this.#timer) {
      this.#timer = setInterval(() => {
        void this.reconcileNow().catch((error) => this.options.onError?.(error));
      }, this.options.intervalMs);
      this.#timer.unref();
    }
    return this.reconcileNow();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  reconcileNow(): Promise<TextClipReconciliationResult> {
    if (this.#running) return this.#running;
    const operation = this.options.loadAuthority().then((authority) =>
      this.store.reconcileAuthority(
        authority,
        this.options.orphanGraceMs,
        this.options.now?.() ?? Date.now(),
      ));
    this.#running = operation;
    void operation.finally(() => {
      if (this.#running === operation) this.#running = null;
    }).catch(() => undefined);
    return operation;
  }
}
