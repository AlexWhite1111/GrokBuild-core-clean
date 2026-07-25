import type { TaskListItem, TaskSnapshot } from "./contracts.js";

type TaskExecutionState = TaskListItem["agentState"];
export type CurrentTurnOutcome = "running" | "failed" | "unknown";

export interface TaskExecutionProjection {
  state: TaskExecutionState;
  foregroundBusy: boolean;
  backgroundBusy: boolean;
  busy: boolean;
  needsAttention: boolean;
  currentTurnOutcome: CurrentTurnOutcome;
  allowedActions: {
    send: boolean;
    stop: boolean;
    queue: boolean;
    interject: boolean;
  };
}

export function projectTaskExecution(snapshot: Pick<
  TaskSnapshot,
  "connection" | "turn" | "gates" | "activities" | "error"
>): TaskExecutionProjection {
  const foregroundBusy = snapshot.turn !== "idle";
  const backgroundBusy = snapshot.activities.running > 0;
  const busy = foregroundBusy || backgroundBusy;
  const state: TaskExecutionState = snapshot.error || snapshot.connection === "failed"
    ? "failed"
    : snapshot.gates.length > 0
      ? "gate"
      : busy
        ? "running"
        : snapshot.activities.unconfirmed > 0
          || snapshot.connection === "loading"
          || snapshot.connection === "recovering"
          ? "detached"
          : snapshot.connection === "unloaded"
            ? "unloaded"
            : "idle";

  return {
    state,
    foregroundBusy,
    backgroundBusy,
    busy,
    needsAttention: state === "gate" || state === "failed",
    currentTurnOutcome: state === "running" || state === "gate"
      ? "running"
      : state === "failed"
        ? "failed"
        : "unknown",
    allowedActions: {
      send: !foregroundBusy,
      stop: foregroundBusy,
      queue: foregroundBusy,
      interject: foregroundBusy,
    },
  };
}
