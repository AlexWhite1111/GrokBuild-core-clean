import {
  TextClipAuthoritySnapshotSchema,
  TextClipOwnerKeySchema,
  TextClipReferenceIdSchema,
  type TextClipAuthoritySnapshot,
} from "../../shared/contracts.js";
import type { JsonStateStore } from "./JsonStateStore.js";

/** Temp-file authority comes from Composer drafts only; transcripts stay official-session-owned. */
export class TextClipAuthorityStore {
  constructor(private readonly state: JsonStateStore) {}

  snapshot(): TextClipAuthoritySnapshot {
    const owners: Array<{ ownerKey: string; refIds: string[] }> = [];
    for (const [storageKey, document] of this.state.entries<string>("draft.")) {
      const ownerKey = storageKey.slice("draft.".length);
      if (!TextClipOwnerKeySchema.safeParse(ownerKey).success || typeof document !== "string") continue;
      const refIds = referenceIds(document);
      if (refIds.length || document.trim()) owners.push({ ownerKey, refIds });
    }
    return TextClipAuthoritySnapshotSchema.parse({
      version: 1,
      owners: owners.sort((left, right) => left.ownerKey.localeCompare(right.ownerKey)),
    });
  }
}

function referenceIds(document: string): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "refId") {
        const parsed = TextClipReferenceIdSchema.safeParse(child);
        if (parsed.success) found.add(parsed.data);
      } else {
        visit(child);
      }
    }
  };
  try { visit(JSON.parse(document)); } catch { /* plain draft text has no refs */ }
  return [...found].sort();
}
