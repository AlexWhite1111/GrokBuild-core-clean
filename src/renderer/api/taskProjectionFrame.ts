import type {
  TaskDetailProjection,
  TaskMessageBlock,
  TaskProjectionFrame,
  TaskProjectionMessagePatch,
  WorkspaceProjection,
} from "../../shared/contracts.js";
import { projectTaskListRuntime } from "../../shared/taskExecutionStatus.js";
import { shouldApplyTaskProjection } from "./taskProjectionVersion.js";

export type AppliedTaskProjectionFrame = {
  detail: TaskDetailProjection | undefined;
  synchronized: boolean;
  structural: boolean;
  accepted: boolean;
};

export function applyTaskProjectionFrame(
  current: TaskDetailProjection | undefined,
  frame: TaskProjectionFrame,
): AppliedTaskProjectionFrame {
  if (frame.kind === "snapshot") {
    const accepted = shouldApplyTaskProjection(current?.snapshot, frame.detail.snapshot);
    return {
      detail: accepted ? frame.detail : current,
      synchronized: true,
      structural: accepted,
      accepted,
    };
  }
  if (!shouldApplyTaskProjection(current?.snapshot, frame.snapshot)) {
    return { detail: current, synchronized: true, structural: false, accepted: false };
  }
  if (
    !current
    || current.snapshot.projectionEpoch !== frame.snapshot.projectionEpoch
  ) {
    return { detail: current, synchronized: false, structural: false, accepted: false };
  }
  const messages = applyMessageChanges(
    current.messages,
    frame.messageCount,
    frame.messages,
  );
  const events = applyIndexedChanges(
    current.events,
    frame.eventCount,
    frame.events,
    (event) => event.eventId,
    (entry) => entry.event,
  );
  if (!messages || !events) {
    return { detail: current, synchronized: false, structural: false, accepted: false };
  }
  const snapshot = frame.kind === "text-delta"
    ? { ...current.snapshot, ...frame.snapshot }
    : frame.snapshot;
  return {
    detail: {
      snapshot,
      messages,
      events,
      context: frame.kind === "delta"
        ? frame.context ?? current.context
        : current.context,
    },
    synchronized: true,
    structural:
      messages.length !== current.messages.length
      || events.length !== current.events.length,
    accepted: true,
  };
}

function applyMessageChanges(
  current: TaskMessageBlock[],
  targetCount: number,
  patches: TaskProjectionMessagePatch[],
): TaskMessageBlock[] | null {
  if (!Number.isSafeInteger(targetCount) || targetCount < current.length) return null;
  if (!patches.length) return targetCount === current.length ? current : null;
  const next = current.slice();
  const indexes = new Set<number>();
  for (const patch of [...patches].sort((left, right) => left.index - right.index)) {
    if (
      !Number.isSafeInteger(patch.index)
      || patch.index < 0
      || patch.index >= targetCount
      || indexes.has(patch.index)
    ) return null;
    indexes.add(patch.index);
    if (patch.kind === "append") {
      if (patch.index >= current.length) return null;
      const previous = current[patch.index];
      if (
        messageIdentity(previous) !== messageIdentity(patch.message)
        || previous.text.length !== patch.previousTextLength
      ) return null;
      next[patch.index] = {
        ...patch.message,
        text: previous.text + patch.appendText,
      };
      continue;
    }
    if (patch.index < current.length) {
      if (messageIdentity(current[patch.index]) !== messageIdentity(patch.message)) return null;
      next[patch.index] = patch.message;
      continue;
    }
    if (patch.index !== next.length) return null;
    next.push(patch.message);
  }
  return next.length === targetCount ? next : null;
}

function messageIdentity(message: Pick<TaskMessageBlock, "turnId" | "blockId">): string {
  return `${message.turnId}\u0000${message.blockId}`;
}

function applyIndexedChanges<T, P extends { index: number }>(
  current: T[],
  targetCount: number,
  patches: P[],
  identity: (value: T) => string,
  value: (patch: P) => T,
): T[] | null {
  if (!Number.isSafeInteger(targetCount) || targetCount < current.length) return null;
  if (!patches.length) return targetCount === current.length ? current : null;
  const next = current.slice();
  const indexes = new Set<number>();
  for (const patch of [...patches].sort((left, right) => left.index - right.index)) {
    const candidate = value(patch);
    if (
      !Number.isSafeInteger(patch.index)
      || patch.index < 0
      || patch.index >= targetCount
      || indexes.has(patch.index)
    ) return null;
    indexes.add(patch.index);
    if (patch.index < current.length) {
      if (identity(current[patch.index]) !== identity(candidate)) return null;
      next[patch.index] = candidate;
      continue;
    }
    if (patch.index !== next.length) return null;
    next.push(candidate);
  }
  return next.length === targetCount ? next : null;
}

/**
 * Keeps the sidebar on the exact accepted Task snapshot instead of waiting for
 * an independently timed workspace refetch. Local list-only fields are kept.
 */
export function applyTaskDetailToWorkspace(
  current: WorkspaceProjection | undefined,
  detail: TaskDetailProjection,
): WorkspaceProjection | undefined {
  if (!current) return current;
  const runtime = projectTaskListRuntime(detail.snapshot);
  const hasUserTurn = detail.messages.some((message) => message.role === "user");
  let changed = false;
  const tasks = current.tasks.map((task) => {
    if (task.taskId !== detail.snapshot.taskId) return task;
    if (
      task.sessionId === runtime.sessionId
      && task.hasUserTurn === hasUserTurn
      && task.title === runtime.title
      && task.status === runtime.status
      && task.active === runtime.active
      && task.canStop === runtime.canStop
      && task.needsAttention === runtime.needsAttention
      && task.agentState === runtime.agentState
      && task.naturalStatus === runtime.naturalStatus
    ) return task;
    changed = true;
    return { ...task, ...runtime, hasUserTurn };
  });
  return changed ? { ...current, tasks } : current;
}
