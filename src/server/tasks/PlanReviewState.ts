import { createHash } from "node:crypto";
import type {
  PlanReviewDraftIdentity,
  PlanReviewDraftSnapshot,
  PlanReviewPendingGate,
} from "../../shared/contracts.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";

export function planContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function planGateIdentity(gate: PlanReviewPendingGate): PlanReviewDraftIdentity {
  const payload = gate.payload && typeof gate.payload === "object" && !Array.isArray(gate.payload)
    ? gate.payload as Record<string, unknown>
    : {};
  const content = typeof payload.content === "string" ? payload.content : "";
  const advertised = typeof payload.baseHash === "string" ? payload.baseHash : "";
  return {
    gateId: gate.gateId,
    baseHash: /^[a-f0-9]{64}$/.test(advertised) ? advertised : planContentHash(content),
  };
}

export class PlanReviewState {
  constructor(private readonly state: JsonStateStore) {}

  read(taskId: string, identity: PlanReviewDraftIdentity): PlanReviewDraftSnapshot {
    return this.state.get<PlanReviewDraftSnapshot>(key(taskId, identity))
      ?? { draft: null, updatedAt: null };
  }

  save(taskId: string, identity: PlanReviewDraftIdentity, draft: string | null): PlanReviewDraftSnapshot {
    const storageKey = key(taskId, identity);
    if (draft === null) {
      this.state.delete(storageKey);
      return { draft: null, updatedAt: null };
    }
    const value = { draft, updatedAt: new Date().toISOString() };
    this.state.set(storageKey, value);
    return value;
  }

  clearTask(taskId: string): void {
    for (const [storageKey] of this.state.entries(`planDraft.${taskId}.`)) this.state.delete(storageKey);
  }
}

function key(taskId: string, identity: PlanReviewDraftIdentity): string {
  return `planDraft.${taskId}.${identity.gateId}.${identity.baseHash}`;
}
