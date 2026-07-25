import type { TaskCreate, TaskSnapshot } from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskActor } from "./TaskActor.js";
import { hasPendingNativeQueue } from "./taskQueueState.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";

export function ensurePoolCapacity(
  actors: Map<string, TaskActor>,
  maxAgents: number,
  isPinned: (taskId: string) => boolean,
  retired: (taskId: string) => void,
): void {
  if (actors.size < maxAgents) return;
  const idle = [...actors.entries()]
    .filter(([taskId, actor]) => isRetirableTaskActor(actor) && !isPinned(taskId))
    .sort(([, left], [, right]) => left.lastTouched - right.lastTouched);
  for (const [taskId, actor] of idle) {
    actor.stop();
    actors.delete(taskId);
    retired(taskId);
    if (actors.size < maxAgents) return;
  }
  throw new AppProblem(409, "TASK_BUSY", `The ${maxAgents}-agent concurrency limit is reached by active tasks or Goals. Finish a turn, clear queued prompts, pause a Goal, or resolve a Gate first.`);
}

export function isRetirableTaskActor(actor: Pick<TaskActor, "hasActiveGoal" | "isIdle" | "snapshot">): boolean {
  const snapshot = actor.snapshot;
  return actor.isIdle
    && snapshot.activities.running === 0
    && !hasPendingNativeQueue(snapshot)
    && !actor.hasActiveGoal;
}

export function assertPermissionAvailable(mode: TaskCreate["permission"], capabilities: RuntimePermissionCapabilities): void {
  if (mode === "ask") return;
  const capability = capabilities[mode as keyof RuntimePermissionCapabilities];
  if (capability?.available) return;
  const lockedBy = capability && "lockedBy" in capability ? capability.lockedBy : undefined;
  throw new AppProblem(
    lockedBy ? 423 : 409,
    lockedBy ? "POLICY_LOCKED" : "CAPABILITY_UNAVAILABLE",
    capability?.reason || `Permission mode is unavailable: ${mode}`,
  );
}

export function projectSourceControlLocked(
  actors: Map<string, TaskActor>,
  storedSnapshots: readonly TaskSnapshot[],
  projectId: string,
): boolean {
  for (const actor of actors.values()) {
    const snapshot = actor.snapshot;
    if (snapshot.projectId === projectId && (!actor.isIdle || snapshot.activities.running > 0 || hasPendingNativeQueue(snapshot) || actor.hasGoal)) return true;
  }
  return storedSnapshots.some((snapshot) =>
    snapshot.projectId === projectId
    && !actors.has(snapshot.taskId)
    && (snapshot.goal.status === "active" || snapshot.goal.status === "paused"));
}
