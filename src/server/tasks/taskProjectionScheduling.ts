import type { TaskProjectionChange } from "./TaskRuntimeProjection.js";

export type PendingTaskProjectionChange = TaskProjectionChange | "snapshot";

export function mergeTaskProjectionChange(
  pending: PendingTaskProjectionChange | null,
  incoming?: TaskProjectionChange,
): PendingTaskProjectionChange {
  if (!incoming || pending === "snapshot") return "snapshot";
  if (pending === null) return incoming;
  return pending === "delta" || incoming === "delta" ? "delta" : "text";
}

interface TaskProjectionFrameSchedulerOptions {
  intervalMs(): number;
  publish(change: PendingTaskProjectionChange): void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

type ScheduledMode = "burst" | "cadence" | "urgent";

/**
 * Coalesces display projections only. The TaskActor continues to apply every
 * official Session event synchronously and in order.
 */
export class TaskProjectionFrameScheduler {
  readonly #intervalMs: () => number;
  readonly #publish: (change: PendingTaskProjectionChange) => void;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => () => void;
  #cancelTimer: (() => void) | null = null;
  #scheduledAt: number | null = null;
  #scheduledMode: ScheduledMode | null = null;
  #pending: PendingTaskProjectionChange | null = null;
  #lastPublishedAt: number | null = null;
  #disposed = false;

  constructor(options: TaskProjectionFrameSchedulerOptions) {
    this.#intervalMs = options.intervalMs;
    this.#publish = options.publish;
    this.#now = options.now || (() => performance.now());
    this.#schedule = options.schedule || scheduleNodeTimer;
  }

  enqueue(change?: TaskProjectionChange): void {
    if (this.#disposed) return;
    this.#pending = mergeTaskProjectionChange(this.#pending, change);
    if (this.#pending !== "text") {
      this.#arm("urgent", 0);
      return;
    }
    const now = this.#now();
    const interval = normalizedInterval(this.#intervalMs());
    if (
      this.#lastPublishedAt !== null
      && now - this.#lastPublishedAt < interval
    ) {
      this.#arm("cadence", this.#lastPublishedAt + interval - now);
      return;
    }
    this.#arm("burst", initialBurstDelayMs(interval));
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = null;
    this.#clearTimer();
  }

  #arm(mode: ScheduledMode, delayMs: number): void {
    const now = this.#now();
    const dueAt = now + Math.max(0, delayMs);
    if (
      this.#cancelTimer
      && this.#scheduledMode === mode
      && (
        mode === "burst"
        || mode === "urgent"
        || this.#scheduledAt === dueAt
      )
    ) return;
    if (
      this.#cancelTimer
      && this.#scheduledMode === "urgent"
      && mode !== "urgent"
    ) return;
    this.#clearTimer();
    this.#scheduledMode = mode;
    this.#scheduledAt = dueAt;
    this.#cancelTimer = this.#schedule(() => {
      this.#cancelTimer = null;
      this.#scheduledAt = null;
      this.#scheduledMode = null;
      this.#flush();
    }, Math.max(0, dueAt - now));
  }

  #flush(): void {
    const pending = this.#pending;
    if (this.#disposed || pending === null) return;
    this.#pending = null;
    this.#lastPublishedAt = this.#now();
    this.#publish(pending);
  }

  #clearTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
    this.#scheduledAt = null;
    this.#scheduledMode = null;
  }
}

function initialBurstDelayMs(intervalMs: number): number {
  return Math.min(50, Math.max(8, Math.round(intervalMs / 5)));
}

function normalizedInterval(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 50;
}

function scheduleNodeTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}
