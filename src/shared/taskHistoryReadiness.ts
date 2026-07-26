type HistoryMutationBlockerKind =
  | "turn"
  | "queue"
  | "gate"
  | "delivery"
  | "goal"
  | "activity";

export interface HistoryMutationReadiness {
  activeTurnCount: number;
  hasUnresolvedDelivery: boolean;
  gates: number;
  queueRunning: boolean;
  queuedPrompts: number;
  goalStatus: "unknown" | "inactive" | "active" | "paused";
  runningActivities: number;
}

export interface HistoryMutationBlocker {
  kind: HistoryMutationBlockerKind;
  detail: string;
}

/**
 * One policy for both the server authority and the renderer's early feedback.
 * The server remains authoritative; the renderer only prevents a known-invalid
 * history mutation from being offered as if it could succeed.
 */
export function historyMutationBlocker(
  state: HistoryMutationReadiness,
): HistoryMutationBlocker | null {
  if (state.activeTurnCount > 0) {
    return { kind: "turn", detail: "the current turn is still running" };
  }
  if (state.queueRunning) {
    return { kind: "queue", detail: "a queued prompt is currently running" };
  }
  if (state.queuedPrompts > 0) {
    return {
      kind: "queue",
      detail: `${state.queuedPrompts} queued prompt${state.queuedPrompts === 1 ? " is" : "s are"} still pending`,
    };
  }
  if (state.gates > 0) {
    return { kind: "gate", detail: "the current Gate is still open" };
  }
  if (state.hasUnresolvedDelivery) {
    return {
      kind: "delivery",
      detail: "the latest prompt delivery is not confirmed",
    };
  }
  if (state.goalStatus === "active") {
    return {
      kind: "goal",
      detail: "the active Goal must be paused or cleared",
    };
  }
  if (state.runningActivities > 0) {
    return {
      kind: "activity",
      detail: `${state.runningActivities} background activit${state.runningActivities === 1 ? "y is" : "ies are"} still running`,
    };
  }
  return null;
}
