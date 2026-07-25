import type { ComposerReplayDocument, PathReferenceSummary } from "../../shared/contracts.js";

export interface PromptEchoIdentity {
  requestId: string;
  turnId: string;
  localMessage: boolean;
  displayText?: string;
  paths?: PathReferenceSummary[];
  composerDocument?: ComposerReplayDocument;
}

type PendingPromptEcho = Omit<PromptEchoIdentity, "requestId"> & { transportText?: string };

export class PromptEchoQueue {
  readonly #entries = new Map<string, PendingPromptEcho>();
  readonly #nativeEntryIds = new Map<string, string>();
  readonly #retiredTurnIds = new Set<string>();

  add(requestId: string, turnId: string, options: { localMessage?: boolean; displayText?: string; paths?: PathReferenceSummary[]; composerDocument?: ComposerReplayDocument } = {}): void {
    this.#entries.set(requestId, {
      turnId,
      localMessage: options.localMessage ?? true,
      displayText: options.displayText,
      paths: options.paths,
      composerDocument: options.composerDocument,
    });
  }

  claim(explicitIdentity?: string): PromptEchoIdentity | undefined {
    const requestId = explicitIdentity
      ? this.#entries.has(explicitIdentity)
        ? explicitIdentity
        : this.#nativeEntryIds.get(explicitIdentity)
      : this.#entries.keys().next().value;
    if (!requestId) return undefined;
    const entry = this.#entries.get(requestId);
    if (!entry) return undefined;
    this.remove(requestId);
    const { transportText: _transportText, ...identity } = entry;
    return { requestId, ...identity };
  }

  trackTransport(requestId: string, transportText: string): void {
    const entry = this.#entries.get(requestId);
    if (entry) entry.transportText = transportText;
  }

  acceptedByNativeQueue(value: unknown): string[] {
    const record = asRecord(value);
    const entries = (Array.isArray(record.entries) ? record.entries : [])
      .map((value, index) => ({ value, index, position: number(asRecord(value).position) ?? index }))
      .sort((left, right) => left.position - right.position)
      .map(({ value }) => value);
    const assigned = new Set(this.#nativeEntryIds.values());
    const accepted = new Set<string>();
    const nativeOrder: string[] = [];
    for (const value of entries) {
      const item = asRecord(value);
      const nativeId = text(item.id) || text(item.serverId);
      const explicitRequestId = text(item.requestId) || text(item.clientRequestId);
      const transportText = queueText(item.text);
      const requestId = explicitRequestId && this.#entries.has(explicitRequestId)
        ? explicitRequestId
        : nativeId && this.#nativeEntryIds.get(nativeId)
          ? this.#nativeEntryIds.get(nativeId)!
          : transportText
            ? [...this.#entries].find(([candidate, entry]) => entry.transportText === transportText && !assigned.has(candidate))?.[0]
            : undefined;
      if (!requestId) continue;
      accepted.add(requestId);
      assigned.add(requestId);
      if (nativeId) this.#nativeEntryIds.set(nativeId, requestId);
      nativeOrder.push(requestId);
      this.#synchronizeNativeText(requestId, transportText);
    }
    const runningPromptId = text(record.runningPromptId);
    const runningRequestId = runningPromptId ? this.#nativeEntryIds.get(runningPromptId) : undefined;
    if (runningRequestId) accepted.add(runningRequestId);
    this.#reorderRequests(runningRequestId ? [runningRequestId, ...nativeOrder] : nativeOrder);
    return [...accepted];
  }

  editNative(nativeId: string, newText: string): void {
    const requestId = this.#nativeEntryIds.get(nativeId);
    if (!requestId) return;
    const entry = this.#entries.get(requestId);
    if (!entry) return;
    entry.displayText = newText;
    entry.transportText = newText;
    entry.paths = [];
    entry.composerDocument = undefined;
  }

  reorderNative(orderedIds: string[]): void {
    this.#reorderRequests(orderedIds.flatMap((nativeId) => {
      const requestId = this.#nativeEntryIds.get(nativeId);
      return requestId ? [requestId] : [];
    }));
  }

  promoteNative(nativeId: string): void {
    const requestId = this.#nativeEntryIds.get(nativeId);
    if (requestId) this.#reorderRequests([requestId]);
  }

  removeNative(nativeId: string): void {
    const requestId = this.#nativeEntryIds.get(nativeId);
    if (!requestId) return;
    this.#retire(requestId);
    this.remove(requestId);
  }

  clearNative(runningPromptId?: string): void {
    const runningRequestId = runningPromptId ? this.#nativeEntryIds.get(runningPromptId) : undefined;
    for (const requestId of [...this.#entries.keys()]) {
      if (requestId !== runningRequestId) {
        this.#retire(requestId);
        this.remove(requestId);
      }
    }
  }

  pendingTurnIds(): string[] {
    return [...this.#entries.values()].map((entry) => entry.turnId);
  }

  retiredTurnIds(): string[] {
    return [...this.#retiredTurnIds];
  }

  settleTurn(turnId: string): void {
    this.#retiredTurnIds.delete(turnId);
  }

  acceptedByPromptCompletion(value: unknown): string[] {
    const record = asRecord(value);
    const update = asRecord(record.update);
    const nativeId = text(record.promptId)
      || text(record.prompt_id)
      || text(update.promptId)
      || text(update.prompt_id);
    if (!nativeId) return [];
    const requestId = this.#entries.has(nativeId)
      ? nativeId
      : this.#nativeEntryIds.get(nativeId);
    return requestId ? [requestId] : [];
  }

  remove(requestId: string): void {
    this.#entries.delete(requestId);
    for (const [nativeId, candidate] of this.#nativeEntryIds) {
      if (candidate === requestId) this.#nativeEntryIds.delete(nativeId);
    }
  }

  #retire(requestId: string): void {
    const turnId = this.#entries.get(requestId)?.turnId;
    if (turnId) this.#retiredTurnIds.add(turnId);
  }

  #synchronizeNativeText(requestId: string, nativeText?: string): void {
    if (!nativeText) return;
    const entry = this.#entries.get(requestId);
    if (!entry) return;
    if (entry.transportText !== undefined && entry.transportText !== nativeText) {
      entry.displayText = nativeText;
      entry.paths = [];
      entry.composerDocument = undefined;
    }
    entry.transportText = nativeText;
  }

  #reorderRequests(requestIds: string[]): void {
    const prioritized = [...new Set(requestIds)].flatMap((requestId) => {
      const entry = this.#entries.get(requestId);
      return entry ? [[requestId, entry] as const] : [];
    });
    if (!prioritized.length) return;
    const prioritizedIds = new Set(prioritized.map(([requestId]) => requestId));
    const remaining = [...this.#entries].filter(([requestId]) => !prioritizedIds.has(requestId));
    this.#entries.clear();
    for (const [requestId, entry] of [...prioritized, ...remaining]) this.#entries.set(requestId, entry);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function queueText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value.slice(0, 200_000) : undefined;
}
