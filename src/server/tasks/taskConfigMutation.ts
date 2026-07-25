import type { TaskSnapshot } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { applyTaskConfigOptions } from "./taskConfigOptions.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";

export async function setTaskConfigOption(
  client: OfficialAcpClient,
  projection: TaskProjection,
  configId: string,
  value: string | boolean,
  turnId: string | null,
): Promise<TaskSnapshot> {
  const option = projection.snapshot.configOptions.find((entry) => entry.id === configId);
  if (!option) throw new Error(`Session config option is unavailable: ${configId}`);
  const invalid = option.type === "boolean"
    ? typeof value !== "boolean"
    : typeof value !== "string" || !option.options.some((entry) => entry.value === value);
  if (invalid) throw new Error(`Invalid value for session config option: ${configId}`);
  const sessionId = projection.snapshot.sessionId;
  if (!sessionId) throw new Error("Task session is not ready.");
  const response = await client.setConfigOption(sessionId, configId, value);
  applyTaskConfigOptions(projection.snapshot, response.configOptions);
  projection.record("acp", "session/set_config_option", turnId, { configId, value });
  projection.touch();
  return projection.detail().snapshot;
}
