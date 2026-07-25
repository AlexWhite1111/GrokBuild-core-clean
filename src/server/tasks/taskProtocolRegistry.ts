import type { PermissionModeAvailability, TaskPermissionMode, TaskSnapshot } from "../../shared/contracts.js";
import { asRecord, string } from "./taskEventSanitizers.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";

export function permissionModes(
  current: TaskPermissionMode,
  capabilities: RuntimePermissionCapabilities,
): PermissionModeAvailability[] {
  const alwaysHotSwitch = capabilities.alwaysApprove.available;
  const baseMode = current === "acceptEdits" || current === "dontAsk" ? current : "ask";
  return [
    { mode: "ask", available: true, effective: current === "ask", hotSwitch: baseMode === "ask" && alwaysHotSwitch, source: "fallback" },
    { mode: "auto", available: capabilities.auto.available, effective: current === "auto", hotSwitch: false, source: "acp", reason: capabilities.auto.reason },
    { mode: "alwaysApprove", available: capabilities.alwaysApprove.available, effective: current === "alwaysApprove", hotSwitch: alwaysHotSwitch, source: capabilities.alwaysApprove.lockedBy ? "policy" : "xai", reason: capabilities.alwaysApprove.reason, lockedBy: capabilities.alwaysApprove.lockedBy },
    { mode: "acceptEdits", available: capabilities.acceptEdits.available, effective: current === "acceptEdits", hotSwitch: baseMode === "acceptEdits" && alwaysHotSwitch, source: "config", reason: capabilities.acceptEdits.reason },
    { mode: "dontAsk", available: capabilities.dontAsk.available, effective: current === "dontAsk", hotSwitch: baseMode === "dontAsk" && alwaysHotSwitch, source: "config", reason: capabilities.dontAsk.reason },
  ];
}

function commandList(value: unknown): TaskSnapshot["commands"]["available"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((entry) => {
    const command = asRecord(entry);
    const name = string(command.name);
    if (!name || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(name)) return [];
    return [{
      name,
      description: (string(command.description) || name).slice(0, 500),
      inputHint: string(asRecord(command.input).hint)?.slice(0, 300) || null,
    }];
  });
}

export function applyAvailableCommands(snapshot: TaskSnapshot, value: unknown): void {
  snapshot.commands.available = commandList(value);
}
