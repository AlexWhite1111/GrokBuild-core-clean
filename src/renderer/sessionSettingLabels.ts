import type {
  SandboxProfile,
  TaskPermissionMode,
} from "../shared/contracts.js";

export function permissionLabel(value: TaskPermissionMode): string {
  return {
    ask: "Ask",
    auto: "Auto",
    alwaysApprove: "YOLO",
    acceptEdits: "Accept Edits",
    dontAsk: "Don’t Ask",
  }[value];
}

export function sandboxLabel(value: SandboxProfile): string {
  return {
    off: "Off",
    workspace: "Workspace",
    readOnly: "Read Only",
    strict: "Strict",
    custom: "Custom",
  }[value];
}
