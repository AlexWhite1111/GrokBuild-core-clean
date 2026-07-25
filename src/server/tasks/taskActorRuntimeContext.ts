import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { PromptEchoQueue } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import type { TaskRuntimeContext } from "./TaskRuntimeContext.js";
import type { ActiveTaskTurn } from "./taskTurnSettlement.js";

export function createTaskRuntimeContext(input: {
  client: OfficialAcpClient;
  projection: TaskProjection;
  projectPath: string;
  media?: MediaArtifactStore;
  activeTurns: Map<string, ActiveTaskTurn>;
  acceptedWaiters: Map<string, () => void>;
  promptEchoes: PromptEchoQueue;
  latestTurnId(): string | null;
  isStopped(): boolean;
  refreshContextWindow(): boolean;
  queueChanged?(): void;
  settleTurn(turnId: string, outcome: "completed" | "failed", value: unknown): void;
  touch(): void;
  change(): void;
  disconnectMachine(): void;
}): TaskRuntimeContext {
  const activeTurnId = () => input.activeTurns.keys().next().value ?? null;
  const completionReceipt = (value: unknown) => {
    const requestIds = input.promptEchoes.acceptedByPromptCompletion(value);
    const identifiers = completionIdentifiers(value);
    const active = [...input.activeTurns];
    const direct = active.find(([turnId, turn]) =>
      identifiers.has(turnId)
      || identifiers.has(turn.requestId)
      || requestIds.includes(turn.requestId));
    const promptTurn = input.projection.turnForPrompt(completionPromptId(value));
    return {
      requestIds,
      turnId: direct?.[0]
        || (promptTurn && input.activeTurns.has(promptTurn) ? promptTurn : null)
        || (active.length === 1 ? active[0][0] : null),
    };
  };
  return {
    client: input.client,
    projection: input.projection,
    projectPath: input.projectPath,
    media: input.media,
    activeTurnId,
    latestTurnId: () => activeTurnId() ?? input.latestTurnId(),
    isStopped: input.isStopped,
    claimUserEcho: (requestId) => input.promptEchoes.claim(requestId),
    promptReceiptsFromQueue: (value) => {
      const accepted = input.promptEchoes.acceptedByNativeQueue(value);
      input.queueChanged?.();
      return accepted;
    },
    completionReceipt,
    acceptPending: (requestIds) => acceptPending(input.projection, input.acceptedWaiters, requestIds),
    settleTurn: (turnId, outcome, value) => {
      if (!turnId) return;
      const requestId = input.activeTurns.get(turnId)?.requestId;
      input.settleTurn(turnId, outcome, value);
      if (requestId) input.acceptedWaiters.get(requestId)?.();
    },
    refreshContextWindow: input.refreshContextWindow,
    touch: input.touch,
    change: input.change,
    disconnect: (error) => {
      if (input.isStopped()) return;
      const turnId = activeTurnId();
      input.projection.clearGates("disconnected");
      input.projection.record("supervisor", "task/connection:interrupted", turnId, { code: "ACP_DISCONNECTED" });
      input.disconnectMachine();
      input.projection.snapshot.error = { code: "ACP_DISCONNECTED", message: error.message };
      input.projection.advanceConnectionEpoch();
      input.projection.touch();
      input.change();
    },
  };
}

function completionRecords(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  const update = asRecord(root.update);
  return [root, update, asRecord(root._meta), asRecord(update._meta)];
}

function completionIdentifiers(value: unknown): Set<string> {
  const identifiers = new Set<string>();
  for (const record of completionRecords(value)) {
    for (const key of ["turnId", "requestId", "clientRequestId", "promptId", "prompt_id"] as const) {
      const identifier = text(record[key]);
      if (identifier) identifiers.add(identifier);
    }
  }
  return identifiers;
}

function completionPromptId(value: unknown): string | undefined {
  for (const record of completionRecords(value)) {
    const promptId = text(record.promptId) || text(record.prompt_id);
    if (promptId) return promptId;
  }
  return undefined;
}

function acceptPending(projection: TaskProjection, waiters: Map<string, () => void>, requestIds?: string[]): void {
  if (requestIds?.length) {
    for (const requestId of requestIds) {
      projection.setUserMessageDelivery(requestId, "accepted");
      waiters.get(requestId)?.();
    }
    return;
  }
  const next = waiters.entries().next().value as [string, () => void] | undefined;
  if (!next) return;
  projection.setUserMessageDelivery(next[0], "accepted");
  next[1]();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
