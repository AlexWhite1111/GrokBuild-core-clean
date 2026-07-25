import type { TaskSnapshot } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { XAI_METHODS } from "../acp/XaiMethodRegistry.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

export async function stopTaskWork(client: OfficialAcpClient, projection: TaskProjection, requestId: string, workItemId: string): Promise<TaskSnapshot> {
  const item = projection.detail().context.activeWork.find((entry) => entry.id === workItemId);
  if (!item) throw new AppProblem(404, "NOT_FOUND", "This running work item is no longer available.");
  const nativeId = item.kind === "agent" ? item.childSessionId : item.activityId || item.id;
  if (!nativeId) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "This work item has no confirmed native runtime ID.");
  if (item.kind === "agent") {
    await client.cancel(nativeId);
  } else {
    const sessionId = projection.snapshot.sessionId;
    if (!sessionId) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "This task has no active Grok session.");
    if (item.kind === "loop") await client.requestXai(XAI_METHODS.schedulerDelete, { sessionId, taskId: nativeId });
    else await client.requestXai(XAI_METHODS.taskKill, { sessionId, taskId: nativeId });
  }
  projection.record("supervisor", "task/work:stop_requested", null, { requestId, workItemId: item.id, nativeId, kind: item.kind });
  projection.touch();
  return projection.detail().snapshot;
}
