import type { PromptEchoQueue } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import { asRecord, errorMessage, nonEmptyString } from "./taskValue.js";

export interface TaskTurnSettlementContext {
  projection: TaskProjection;
  promptEchoes: PromptEchoQueue;
  activeTurns: Map<string, ActiveTaskTurn>;
  syncActiveTurn(): void;
  notifyIdle(): void;
  turnDone(): void;
  refreshContextWindow(): void;
  touch(): void;
  change(): void;
  connectionInterrupted(): boolean;
}

export interface ActiveTaskTurn {
  completion: Promise<unknown>;
  requestId: string;
  commandName?: string;
}

export function completeTaskTurn(context: TaskTurnSettlementContext, turnId: string, response: unknown): boolean {
  const active = context.activeTurns.get(turnId);
  if (!active) return false;
  const { requestId, commandName } = active;
  context.promptEchoes.remove(requestId);
  context.promptEchoes.settleTurn(turnId);
  context.projection.setUserMessageDelivery(requestId, "accepted");
  context.activeTurns.delete(turnId);
  context.syncActiveTurn();
  context.notifyIdle();
  for (const message of context.projection.messages) if (message.turnId === turnId) message.streaming = false;
  if (commandName) context.projection.finishCommand(turnId, requestId, commandName);
  context.projection.record("acp", "session/prompt:completed", turnId, {
    requestId,
    stopReason: nonEmptyString(asRecord(response).stopReason) || "end_turn",
  });
  context.projection.finishQueueEntry(requestId, "removed");
  if (!context.activeTurns.size) context.turnDone();
  context.refreshContextWindow();
  context.projection.touch();
  context.touch();
  context.change();
  return true;
}

export function rejectTaskTurn(context: TaskTurnSettlementContext, turnId: string, error: unknown): boolean {
  const active = context.activeTurns.get(turnId);
  if (!active) return false;
  const { requestId, commandName } = active;
  context.promptEchoes.remove(requestId);
  context.promptEchoes.settleTurn(turnId);
  context.activeTurns.delete(turnId);
  context.syncActiveTurn();
  context.notifyIdle();
  const message = errorMessage(error);
  if (commandName) context.projection.finishCommand(turnId, requestId, commandName, message);
  if (context.connectionInterrupted()) {
    context.projection.setUserMessageDelivery(requestId, "unknown");
    context.projection.record("supervisor", "session/prompt:interrupted", turnId, { requestId, code: "ACP_DISCONNECTED" });
    context.projection.touch();
    context.touch();
    context.change();
    return true;
  }
  context.projection.setUserMessageDelivery(requestId, "failed");
  context.projection.record("acp", "session/prompt:failed", turnId, {
    requestId,
    code: commandName ? "COMMAND_FAILED" : "PROMPT_FAILED",
    message,
  });
  context.projection.finishQueueEntry(requestId, "failed");
  if (!commandName) context.projection.snapshot.error = { code: "PROMPT_FAILED", message };
  if (!context.activeTurns.size) context.turnDone();
  context.projection.touch();
  context.change();
  return true;
}
