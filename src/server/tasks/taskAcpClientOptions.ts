import type { ReasoningEffort, SandboxProfile, TaskPermissionMode } from "../../shared/contracts.js";
import type { AcpClientOptions } from "../acp/OfficialAcpClient.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

interface TaskAcpLaunchInput {
  grokBin: string;
  projectPath: string;
  grokHome: string;
  permission: TaskPermissionMode;
  sandbox: SandboxProfile;
  modelId?: string | null;
  effort?: ReasoningEffort | null;
  taskId: string;
  processes?: OwnedProcessRegistry;
}

/** Translate GUI policy names at the application boundary; the ACP adapter only sees Grok CLI vocabulary. */
export function taskAcpClientOptions(input: TaskAcpLaunchInput): AcpClientOptions {
  return {
    binary: input.grokBin,
    cwd: input.projectPath,
    grokHome: input.grokHome,
    // Ask and Always Approve both start from the documented default policy.
    // Always Approve is enabled only after session creation through the
    // structured x.ai control and an exact session-roster readback.
    permissionMode: input.permission === "acceptEdits" || input.permission === "dontAsk"
      ? null
      : "default",
    sandboxMode: sandboxMode(input.sandbox),
    modelId: input.modelId,
    effort: input.effort,
    processes: input.processes,
    processOwner: { kind: "task", id: input.taskId },
  };
}

function sandboxMode(value: SandboxProfile): AcpClientOptions["sandboxMode"] {
  if (value === "off") return null;
  if (value === "readOnly") return "read-only";
  return value;
}
