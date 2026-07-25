import { randomUUID } from "node:crypto";
import type { ComposerReplayDocument, PathReferenceSummary, TaskSnapshot } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { PromptEchoQueue } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import { preparePromptProjection } from "./preparePromptProjection.js";
import { errorMessage } from "./taskValue.js";
import { PromptDeliveryUnknownError } from "./taskDelivery.js";
import type { ActiveTaskTurn } from "./taskTurnSettlement.js";

export interface TaskCommandPresentation {
  displayPrompt: string;
  transportInput?: string;
  paths: PathReferenceSummary[];
  composerDocument?: ComposerReplayDocument;
}

export interface TaskCommandExecutionOptions {
  queueWhenBusy?: boolean;
}

interface CommandRuntime {
  client: OfficialAcpClient;
  projection: TaskProjection;
  activeTurns: Map<string, ActiveTaskTurn>;
  promptEchoes: PromptEchoQueue;
  setLatestTurnId: (turnId: string) => void;
  syncActiveTurn: () => void;
  promptStarted: () => void;
  completeTurn: (turnId: string, response: unknown) => void;
  rejectTurn: (turnId: string, error: unknown) => void;
  touch: () => void;
  change: () => void;
}

export async function executeTaskCommand(
  runtime: CommandRuntime,
  requestId: string,
  name: string,
  input = "",
  presentation?: TaskCommandPresentation,
  options: TaskCommandExecutionOptions = {},
): Promise<TaskSnapshot> {
  const sessionId = runtime.projection.snapshot.sessionId;
  if (!sessionId) throw new Error("Task session is not ready.");
  const queued = runtime.activeTurns.size > 0;
  if (queued && !options.queueWhenBusy) throw new Error("A command cannot start while another prompt is running.");
  const command = runtime.projection.snapshot.commands.available.find((entry) => entry.name === name);
  if (!command) throw new Error(`The current session did not advertise /${name}.`);
  const commandInput = presentation?.transportInput?.trim() || input.trim();
  const text = `/${name}${commandInput ? ` ${commandInput}` : ""}`;
  const turnId = presentation || queued ? preparePromptProjection({
    projection: runtime.projection,
    echoes: runtime.promptEchoes,
    requestId,
    displayPrompt: presentation?.displayPrompt || text,
    paths: presentation?.paths || [],
    composerDocument: presentation?.composerDocument,
    queued,
  }) : randomUUID();
  runtime.setLatestTurnId(turnId);
  if (!presentation && !queued) runtime.promptEchoes.add(requestId, turnId);
  runtime.projection.beginCommand(turnId, requestId, name, input, Boolean(presentation));
  if (!queued) runtime.promptStarted();
  runtime.promptEchoes.trackTransport(requestId, text);
  if (presentation) runtime.projection.markUserMessageDispatched(requestId, turnId, text);
  const completion = runtime.client.prompt(sessionId, text);
  runtime.activeTurns.set(turnId, { completion, requestId, commandName: name });
  runtime.syncActiveTurn();
  runtime.touch();
  runtime.change();
  try {
    const response = await completion;
    runtime.completeTurn(turnId, response);
    return runtime.projection.detail().snapshot;
  } catch (error) {
    const interrupted = runtime.projection.snapshot.connection === "recovering"
      || runtime.projection.snapshot.connection === "failed";
    runtime.rejectTurn(turnId, error);
    if (interrupted) throw new PromptDeliveryUnknownError(errorMessage(error));
    throw error;
  }
}
