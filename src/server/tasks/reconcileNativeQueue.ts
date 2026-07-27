import type { TaskSnapshot } from "../../shared/contracts.js";
import { asRecord, number, string } from "./taskEventSanitizers.js";

export function reconcileNativeQueue(snapshot: TaskSnapshot, payload: unknown, nativeRequestIds: Map<string, string>): string[] {
  const record = asRecord(payload);
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const byRequestId = new Map(snapshot.queue.entries.map((entry) => [entry.requestId, entry]));
  const byEntryId = new Map(snapshot.queue.entries.flatMap((entry) => entry.entryId ? [[entry.entryId, entry] as const] : []));
  const unassigned = snapshot.queue.entries.filter((entry) => !entry.entryId);
  const accepted = new Set<string>();
  const native = entries.flatMap((entry, index) => {
    const item = asRecord(entry);
    const nativeId = string(item.id) || string(item.serverId) || null;
    const explicitRequestId = string(item.requestId) || string(item.clientRequestId);
    const mappedRequestId = nativeId ? nativeRequestIds.get(nativeId) : undefined;
    const existing = explicitRequestId
      ? byRequestId.get(explicitRequestId)
      : mappedRequestId
        ? byRequestId.get(mappedRequestId)
        : nativeId
          ? byEntryId.get(nativeId)
          : undefined;
    if (existing && !existing.entryId) {
      const unassignedIndex = unassigned.indexOf(existing);
      if (unassignedIndex >= 0) unassigned.splice(unassignedIndex, 1);
    }
    const correlated = existing || (
      !explicitRequestId && !mappedRequestId
        ? unassigned.shift()
        : undefined
    );
    const requestId = explicitRequestId || mappedRequestId || correlated?.requestId || nativeId;
    if (!requestId) return [];
    if (nativeId) nativeRequestIds.set(nativeId, requestId);
    if (correlated) accepted.add(correlated.requestId);
    return [{
      entryId: nativeId || correlated?.entryId || null,
      requestId,
      textPreview: queueText(item.text) || correlated?.textPreview || "Queued prompt",
      version: number(item.version),
      position: number(item.position) ?? index,
      createdAt: correlated?.createdAt || new Date().toISOString(),
    }];
  });
  const unresolved = snapshot.queue.entries.filter((entry) =>
    !entry.entryId && !native.some((item) => item.requestId === entry.requestId));
  const runningEntryId = string(record.runningPromptId) || null;
  if (runningEntryId) {
    const runningRequestId = nativeRequestIds.get(runningEntryId);
    if (runningRequestId) accepted.add(runningRequestId);
  }
  const reconciled = [...native, ...unresolved];
  snapshot.queue = {
    available: true,
    runningEntryId,
    entries: reconciled,
  };
  snapshot.activities.waiting = reconciled.length;
  const liveNativeIds = new Set(native.flatMap((entry) => entry.entryId ? [entry.entryId] : []));
  if (runningEntryId) liveNativeIds.add(runningEntryId);
  for (const nativeId of nativeRequestIds.keys()) if (!liveNativeIds.has(nativeId)) nativeRequestIds.delete(nativeId);
  return [...accepted];
}

function queueText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value.slice(0, 200_000) : undefined;
}
