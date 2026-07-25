import type { TaskListItem, TaskSnapshot } from "../../shared/contracts.js";
import { projectTaskExecution } from "../../shared/taskExecutionStatus.js";

export function listItemFromSnapshot(snapshot: TaskSnapshot, pinned = false, archived = false, hasUserTurn = false): TaskListItem {
  const execution = projectTaskExecution(snapshot);
  const agentState = execution.state;
  const naturalStatus = agentState === "gate" ? "等待处理"
    : agentState === "running" ? "执行中"
      : agentState === "detached" ? "后台状态未确认"
        : agentState === "failed" ? "失败"
          : agentState === "idle" ? "已就绪" : null;
  return {
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    sessionId: snapshot.sessionId,
    hasUserTurn,
    title: snapshot.title,
    status: `${snapshot.connection}:${snapshot.turn}`,
    active: execution.busy,
    canStop: execution.allowedActions.stop,
    needsAttention: execution.needsAttention,
    pinned,
    archived,
    agentState,
    naturalStatus,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}
