import type { WorkspaceProjection } from "../../shared/contracts.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";

export interface SupervisorSettings {
  softLimit: number;
  hardLimit: number;
  maxAgents: number;
  idleRetirementMinutes: number;
}

export function readSupervisorSettings(raw: string | undefined, max?: number, idleMs?: number): SupervisorSettings {
  try {
    const value = JSON.parse(raw || "null") as Record<string, unknown> | null;
    const candidate = { softLimit: Number(value?.softLimit), hardLimit: Number(value?.hardLimit), maxAgents: Number(value?.maxAgents), idleRetirementMinutes: Number(value?.idleRetirementMinutes) };
    if (valid(candidate)) return candidate;
  } catch { /* use defaults */ }
  const maxAgents = Math.max(3, Math.min(16, Math.round(max ?? 8)));
  return { softLimit: Math.min(4, maxAgents - 2), hardLimit: Math.min(6, maxAgents - 1), maxAgents, idleRetirementMinutes: Math.max(1, Math.min(60, Math.round((idleMs ?? 5 * 60_000) / 60_000))) };
}

export function permissionCapabilityList(value: RuntimePermissionCapabilities): WorkspaceProjection["supervisor"]["permissionModes"] {
  return [
    { mode: "ask", available: true },
    { mode: "auto", ...value.auto },
    { mode: "alwaysApprove", ...value.alwaysApprove },
    { mode: "acceptEdits", ...value.acceptEdits },
    { mode: "dontAsk", ...value.dontAsk },
  ];
}

function valid(value: SupervisorSettings): boolean {
  return Number.isInteger(value.softLimit) && Number.isInteger(value.hardLimit) && Number.isInteger(value.maxAgents) && Number.isInteger(value.idleRetirementMinutes)
    && value.softLimit > 0 && value.softLimit < value.hardLimit && value.hardLimit < value.maxAgents && value.maxAgents <= 16
    && value.idleRetirementMinutes >= 1 && value.idleRetirementMinutes <= 60;
}
