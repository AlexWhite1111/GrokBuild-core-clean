export type SessionLifecycleKind =
  | "contextCompact"
  | "memoryFlush"
  | "retry"
  | "recovery"
  | "connection"
  | "modelChange";

export type SessionLifecycleState = "running" | "completed" | "failed" | "cancelled" | "unknown";

export interface SessionLifecycleSignal {
  kind: SessionLifecycleKind;
  state: SessionLifecycleState;
  type: string;
}

/**
 * Provider event classification shared by persistence and presentation.
 * Feature lifecycles such as Goal, SubAgent, scheduler, permission and tools
 * deliberately stay out of this list because they have dedicated projections.
 */
export function sessionLifecycleSignal(method: string, payload: unknown): SessionLifecycleSignal | null {
  const value = record(payload);
  const type = method.startsWith("session/update:")
    ? method.slice("session/update:".length)
    : method === "x.ai/session_notification"
      ? text(value.type) || ""
      : method;
  const status = state(text(value.status));

  if (type === "memory_flush_started") return signal(type, "memoryFlush", "running");
  if (type === "memory_flush_completed") {
    return signal(type, "memoryFlush", failedOutcome(value, status) ? "failed" : "completed");
  }

  if (type === "auto_compact_started" || type === "context_compaction_started" || type === "compaction_checkpoint") {
    return signal(type, "contextCompact", "running");
  }
  if (type === "auto_compact_completed" || type === "context_compaction_completed") {
    return signal(type, "contextCompact", "completed");
  }
  if (type === "auto_compact_failed" || type === "context_compaction_failed") {
    return signal(type, "contextCompact", "failed");
  }
  if (type === "auto_compact_cancelled" || type === "context_compaction_cancelled") {
    return signal(type, "contextCompact", "cancelled");
  }
  if (type === "context_compaction") return signal(type, "contextCompact", status);

  if (type === "model_retry_started" || type === "retrying") return signal(type, "retry", "running");
  if (type === "model_retry_completed") return signal(type, "retry", "completed");
  if (type === "model_retry_failed" || type === "retry_exhausted" || type === "exhausted") return signal(type, "retry", "failed");
  if (type === "retry_state") return signal(type, "retry", status === "unknown" ? "running" : status);

  if (type === "auto_recovery_started") return signal(type, "recovery", "running");
  if (type === "auto_recovery_completed") return signal(type, "recovery", "completed");
  if (type === "auto_recovery_exhausted" || type === "auto_recovery_failed") return signal(type, "recovery", "failed");

  if (type === "task/connection:interrupted" || type === "connection_interrupted" || type === "connection_lost") {
    return signal(type, "connection", "running");
  }
  if (type === "task/connection:restored" || type === "connection_restored") {
    return signal(type, "connection", "completed");
  }

  if (type === "model_changed" || type === "model_auto_switched") return signal(type, "modelChange", "completed");
  return null;
}

export function isSessionLifecycleEvent(method: string, payload: unknown): boolean {
  return sessionLifecycleSignal(method, payload) !== null;
}

function signal(type: string, kind: SessionLifecycleKind, value: SessionLifecycleState): SessionLifecycleSignal {
  return { type, kind, state: value };
}

function state(value?: string): SessionLifecycleState {
  const normalized = value?.toLowerCase();
  if (normalized === "completed" || normalized === "complete" || normalized === "success" || normalized === "done" || normalized === "restored") return "completed";
  if (normalized === "failed" || normalized === "error" || normalized === "exhausted") return "failed";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "stopped") return "cancelled";
  if (normalized === "pending" || normalized === "running" || normalized === "in_progress" || normalized === "started" || normalized === "retrying") return "running";
  return "unknown";
}

function failedOutcome(value: Record<string, unknown>, status: SessionLifecycleState): boolean {
  if (status === "failed") return true;
  if (text(value.error) || text(value.exception)) return true;
  const detail = [text(value.result), text(value.message), text(value.reason)].filter(Boolean).join(" ");
  return /\b(?:failed|failure|error|timed?\s*out|unavailable)\b/i.test(detail);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
