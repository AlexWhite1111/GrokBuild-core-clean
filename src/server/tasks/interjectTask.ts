import type { TaskSnapshot } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

export async function interjectTask(options: {
  client: OfficialAcpClient;
  projection: TaskProjection;
  activeTurnId?: string;
  requestId: string;
  text: string;
}): Promise<TaskSnapshot> {
  const { client, projection, activeTurnId, requestId, text } = options;
  const sessionId = projection.snapshot.sessionId;
  if (!sessionId || !activeTurnId) throw new AppProblem(409, "TASK_BUSY", "Interrupt & Send requires a running turn.");
  await client.interject(sessionId, text);
  projection.addLocalUserMessage(text, activeTurnId, requestId, [], {
    version: 1,
    nodes: [{ type: "text", text }],
  }, true);
  projection.setUserMessageDelivery(requestId, "accepted");
  projection.record("xai", "x.ai/interject:accepted", activeTurnId, { requestId });
  projection.touch();
  return projection.detail().snapshot;
}
