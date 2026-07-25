import type { TaskEventEnvelope } from "./contracts.js";

type TaskNotificationKind = "completed" | "interrupted" | "waiting";

export interface TaskNotificationIntent {
  notificationId: string;
  kind: TaskNotificationKind;
}

/** Project only new, structured runtime evidence into desktop notification intents. */
export function taskNotificationsFromEvents(
  events: readonly TaskEventEnvelope[],
): TaskNotificationIntent[] {
  const projected = new Map<string, TaskNotificationIntent>();
  for (const event of events) {
    const notification = notificationFromEvent(event);
    if (!notification) continue;
    const current = projected.get(notification.notificationId);
    if (!current || priority(notification.kind) > priority(current.kind)) {
      projected.set(notification.notificationId, notification);
    }
  }
  return [...projected.values()];
}

function notificationFromEvent(
  event: TaskEventEnvelope,
): TaskNotificationIntent | null {
  const payload = record(event.payload);
  const gate = /^gate\/(question|permission|planReview)$/.exec(event.method);
  if (gate) {
    const gateId = text(payload.gateId);
    return gateId ? {
      notificationId: `task:${event.taskId}:gate:${gateId}`,
      kind: "waiting",
    } : null;
  }

  let outcome: "completed" | "interrupted" | null = null;
  if (event.method === "session/prompt:completed") {
    outcome = interruptedStopReason(text(payload.stopReason)) ? "interrupted" : "completed";
  } else if (
    event.method === "session/prompt:failed"
    || event.method === "session/prompt:interrupted"
    || event.method === "task/connection:interrupted"
  ) {
    outcome = "interrupted";
  }
  if (!outcome) return null;

  const turnId = event.turnId || text(payload.promptId) || event.eventId;
  return {
    notificationId: `task:${event.taskId}:turn:${turnId}:settled`,
    kind: outcome,
  };
}

function interruptedStopReason(value: string | undefined): boolean {
  return Boolean(value && /cancel|interrupt|abort|fail|error|disconnect|stop/i.test(value));
}

function priority(kind: TaskNotificationKind): number {
  return kind === "interrupted" ? 2 : 1;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
