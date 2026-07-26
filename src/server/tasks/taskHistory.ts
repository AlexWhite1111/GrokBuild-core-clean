import type { TaskListItem, TaskSnapshot } from "../../shared/contracts.js";
import { projectTaskListRuntime } from "../../shared/taskExecutionStatus.js";

export function listItemFromSnapshot(snapshot: TaskSnapshot, pinned = false, archived = false, hasUserTurn = false): TaskListItem {
  return {
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    hasUserTurn,
    pinned,
    archived,
    createdAt: snapshot.createdAt,
    ...projectTaskListRuntime(snapshot),
  };
}
