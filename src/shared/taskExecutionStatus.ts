import type { TaskListItem, TaskSnapshot } from "./contracts.js";

type TaskExecutionState = TaskListItem["agentState"];
export type CurrentTurnOutcome = "running" | "failed" | "unknown";
export type TaskListRuntimeProjection = Pick<
  TaskListItem,
  "sessionId" | "title" | "status" | "active" | "canStop" | "needsAttention" | "agentState" | "naturalStatus" | "updatedAt"
>;

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

/** Dynamic task-list fields projected from the same authoritative Task snapshot. */
export function projectTaskListRuntime(snapshot: TaskSnapshot): TaskListRuntimeProjection {
  const execution = projectTaskExecution(snapshot);
  const agentState = execution.state;
  const naturalStatus = agentState === "gate" ? "等待处理"
    : agentState === "running" ? "执行中"
      : agentState === "detached" ? "后台状态未确认"
        : agentState === "failed" ? "失败"
          : agentState === "idle" ? "已就绪" : null;
  return {
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    status: `${snapshot.connection}:${snapshot.turn}`,
    active: execution.busy,
    canStop: execution.allowedActions.stop,
    needsAttention: execution.needsAttention,
    agentState,
    naturalStatus,
    updatedAt: snapshot.updatedAt,
  };
}
