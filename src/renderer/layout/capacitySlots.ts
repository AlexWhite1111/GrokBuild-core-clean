import type { WorkspaceProjection } from "../../shared/contracts.js";

const CAPACITY_SLOT_COUNT = 16;

export interface CapacitySlot {
  number: number;
  active: boolean;
  enabled: boolean;
  tone: "empty" | "calm" | "warning" | "danger";
}

export function capacitySlots(supervisor: WorkspaceProjection["supervisor"]): CapacitySlot[] {
  return Array.from({ length: CAPACITY_SLOT_COUNT }, (_, index) => {
    const number = index + 1;
    const active = number <= supervisor.activeAgents;
    const tone = !active ? "empty" : number > supervisor.hardLimit ? "danger" : number > supervisor.softLimit ? "warning" : "calm";
    return { number, active, enabled: number <= supervisor.maxAgents, tone };
  });
}
