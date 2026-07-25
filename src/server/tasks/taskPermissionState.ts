import type {
  TaskPermissionMode,
  TaskSnapshot,
} from "../../shared/contracts.js";
import type { SessionRosterState } from "../acp/sessionRosterContracts.js";

export function basePermissionMode(
  requested: TaskPermissionMode,
): "ask" | "acceptEdits" | "dontAsk" {
  return requested === "acceptEdits" || requested === "dontAsk"
    ? requested
    : "ask";
}

export function applyVerifiedPermissionState(
  snapshot: TaskSnapshot,
  state: SessionRosterState & { yolo: boolean },
  base: ReturnType<typeof basePermissionMode>,
): TaskPermissionMode {
  const effective = state.yolo
    ? "alwaysApprove"
    : state.autoMode
      ? "auto"
      : base;
  const alwaysHotSwitch = snapshot.permission.modes.find(
    (mode) => mode.mode === "alwaysApprove",
  )?.hotSwitch === true;
  snapshot.permission.requested = effective;
  snapshot.permission.effective = effective;
  snapshot.permission.base = base;
  snapshot.permission.modes = snapshot.permission.modes.map((mode) => ({
    ...mode,
    effective: mode.mode === effective,
    hotSwitch: mode.mode === base
      ? alwaysHotSwitch || mode.hotSwitch
      : mode.hotSwitch,
  }));
  return effective;
}
