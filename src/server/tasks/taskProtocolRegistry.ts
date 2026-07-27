import type { PermissionModeAvailability, TaskPermissionMode } from "../../shared/contracts.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";
export { applyAvailableCommands } from "./taskAvailableCommands.js";

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
