import type { z } from "zod";
import { QueueMutationSchema } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { XAI_METHODS } from "../acp/XaiMethodRegistry.js";
import { AppProblem } from "../security/problemResponse.js";
import type { PromptEchoQueue } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import type { ActiveTaskTurn } from "./taskTurnSettlement.js";

export function alignQueuedActiveTurns(
  activeTurns: Map<string, ActiveTaskTurn>,
  promptEchoes: PromptEchoQueue,
): void {
  const queuedTurnIds = promptEchoes.pendingTurnIds();
  const queued = new Set(queuedTurnIds);
  const retired = new Set(promptEchoes.retiredTurnIds());
  const leading = [...activeTurns].filter(([turnId]) => !queued.has(turnId) && !retired.has(turnId));
  const trailing = [...activeTurns].filter(([turnId]) => retired.has(turnId));
  const ordered = queuedTurnIds.flatMap((turnId) => {
    const completion = activeTurns.get(turnId);
    return completion ? [[turnId, completion] as const] : [];
  });
  activeTurns.clear();
  for (const [turnId, completion] of [...leading, ...ordered, ...trailing]) activeTurns.set(turnId, completion);
}

export async function mutateNativeQueue(
  client: OfficialAcpClient,
  projection: TaskProjection,
  promptEchoes: PromptEchoQueue,
  input: z.infer<typeof QueueMutationSchema>,
  turnId: string | null,
): Promise<void> {
  const sessionId = projection.snapshot.sessionId;
  if (!sessionId) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Task session is not ready.");
  const method = {
    remove: XAI_METHODS.queueRemove,
    reorder: XAI_METHODS.queueReorder,
    edit: XAI_METHODS.queueEdit,
    interject: XAI_METHODS.queueInterject,
    clear: XAI_METHODS.queueClear,
  }[input.action];
  const params = notificationParams(projection.snapshot.queue, sessionId, input);
  await client.notifyXai(method, params);
  applyPromptEchoMutation(promptEchoes, projection.snapshot.queue.runningEntryId, input, params);
  applyOptimisticQueueMutation(projection.snapshot, input);
  projection.record("xai", method, turnId, {
    requestId: input.requestId,
    entryId: input.entryId,
    expectedVersion: input.expectedVersion,
  });
  projection.touch();
}

function applyOptimisticQueueMutation(snapshot: TaskProjection["snapshot"], input: z.infer<typeof QueueMutationSchema>): void {
  const entries = snapshot.queue.entries;
  if (input.action === "clear") {
    snapshot.activities.waiting = Math.max(0, snapshot.activities.waiting - entries.length);
    snapshot.queue.entries = [];
    return;
  }
  const index = entries.findIndex((entry) => entry.entryId === input.entryId);
  if (index < 0) return;
  if (input.action === "remove") {
    entries.splice(index, 1);
    snapshot.activities.waiting = Math.max(0, snapshot.activities.waiting - 1);
    return;
  }
  if (input.action === "edit" && input.text) {
    entries[index] = {
      ...entries[index],
      textPreview: input.text,
      version: input.expectedVersion != null ? input.expectedVersion + 1 : entries[index].version,
    };
    return;
  }
  if (input.action === "reorder" && input.position != null) {
    const ordered = entries.slice().sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    const from = ordered.findIndex((entry) => entry.entryId === input.entryId);
    const [entry] = ordered.splice(from, 1);
    ordered.splice(Math.min(input.position, ordered.length), 0, entry);
    ordered.forEach((item, position) => { item.position = position; });
    snapshot.queue.entries = ordered;
  }
}

function notificationParams(
  queue: TaskProjection["snapshot"]["queue"],
  sessionId: string,
  input: z.infer<typeof QueueMutationSchema>,
): Record<string, unknown> {
  if (input.action === "clear") return { sessionId };
  if (!input.entryId) throw new AppProblem(400, "VALIDATION_FAILED", "This Queue action requires a native entry ID.", input.requestId);
  const target = queue.entries.find((entry) => entry.entryId === input.entryId);
  if (!target) throw new AppProblem(404, "NOT_FOUND", "Queued prompt is no longer available.", input.requestId);
  if (input.expectedVersion != null && target.version != null && input.expectedVersion !== target.version) {
    throw new AppProblem(409, "IDEMPOTENCY_CONFLICT", "The Queue row changed before this action. Refresh and try again.", input.requestId);
  }
  const base = { sessionId, id: input.entryId, ...(input.expectedVersion != null ? { expectedVersion: input.expectedVersion } : {}) };
  if (input.action === "edit") {
    if (!input.text) throw new AppProblem(400, "VALIDATION_FAILED", "Queue edit requires non-empty text.", input.requestId);
    return { ...base, newText: input.text };
  }
  if (input.action === "reorder") {
    if (input.position == null) throw new AppProblem(400, "VALIDATION_FAILED", "Queue reorder requires a target position.", input.requestId);
    const ordered = queue.entries
      .filter((entry): entry is typeof entry & { entryId: string } => Boolean(entry.entryId))
      .slice()
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    const from = ordered.findIndex((entry) => entry.entryId === input.entryId);
    if (from < 0) throw new AppProblem(404, "NOT_FOUND", "Queued prompt is no longer available.", input.requestId);
    const [entry] = ordered.splice(from, 1);
    ordered.splice(Math.min(input.position, ordered.length), 0, entry);
    return { sessionId, orderedIds: ordered.map((item) => item.entryId), ...(input.expectedVersion != null ? { expectedVersion: input.expectedVersion } : {}) };
  }
  return base;
}

function applyPromptEchoMutation(
  promptEchoes: PromptEchoQueue,
  runningPromptId: string | null,
  input: z.infer<typeof QueueMutationSchema>,
  params: Record<string, unknown>,
): void {
  if (input.action === "clear") {
    promptEchoes.clearNative(runningPromptId || undefined);
    return;
  }
  if (!input.entryId) return;
  if (input.action === "edit" && input.text) promptEchoes.editNative(input.entryId, input.text);
  if (input.action === "reorder") {
    const orderedIds = Array.isArray(params.orderedIds)
      ? params.orderedIds.filter((id): id is string => typeof id === "string")
      : [];
    promptEchoes.reorderNative(orderedIds);
  }
  if (input.action === "interject") promptEchoes.promoteNative(input.entryId);
  if (input.action === "remove") promptEchoes.removeNative(input.entryId);
}
