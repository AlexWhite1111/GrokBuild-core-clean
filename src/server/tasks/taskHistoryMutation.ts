import { randomUUID } from "node:crypto";
import type { ForkSessionResponse, OfficialAcpClient, RewindExecuteResponse } from "../acp/OfficialAcpClient.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

export async function rewindTaskHistory(
  client: OfficialAcpClient,
  projection: TaskProjection,
  targetPromptIndex: number,
): Promise<RewindExecuteResponse> {
  const sessionId = projection.snapshot.sessionId;
  if (!sessionId) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Rewind requires a live Grok session.");
  const points = await client.rewindPoints(sessionId);
  if (!points.some((point) => point.prompt_index === targetPromptIndex)) {
    throw new AppProblem(409, "REWIND_POINT_STALE", "The selected message is no longer a native Rewind point.");
  }
  const result = await client.rewind(sessionId, targetPromptIndex, "all");
  if (result.target_prompt_index !== targetPromptIndex || result.mode !== "all") {
    throw new AppProblem(502, "PROTOCOL_ERROR", "Grok returned a Rewind receipt that does not match the requested point and mode.");
  }
  if (!result.success) {
    throw new AppProblem(409, "REWIND_REJECTED", result.error || "Grok did not apply the selected Rewind point.");
  }
  return result;
}

export async function forkTaskHistory(
  client: OfficialAcpClient,
  projection: TaskProjection,
  projectPath: string,
  fallbackModelId: string | null | undefined,
): Promise<ForkSessionResponse> {
  const sourceSessionId = projection.snapshot.sessionId;
  const newModelId = projection.snapshot.modelId || fallbackModelId;
  if (!sourceSessionId || !newModelId) {
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Fork requires a live session with a confirmed model.");
  }
  const newSessionId = randomUUID();
  const response = await client.forkSession({
    sourceSessionId,
    sourceCwd: projectPath,
    newCwd: projectPath,
    newSessionId,
    newModelId,
    sourceWorkspaceDir: projectPath,
  });
  if (
    response.newSessionId !== newSessionId
    || response.parentSessionId !== sourceSessionId
    || response.newCwd !== projectPath
    || response.newModelId !== newModelId
  ) {
    throw new AppProblem(502, "PROTOCOL_ERROR", "Grok returned a Fork receipt for a different session.");
  }
  return response;
}
