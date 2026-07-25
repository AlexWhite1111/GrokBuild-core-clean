import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TextClipAuthoritySnapshot } from "../shared/contracts.js";

const INDEX_VERSION = 1;
const MAX_REFERENCE_ALIASES = 63;

interface ClipRecord {
  clipId: string;
  fileName: string;
  ownerKey: string;
  createdAt: string;
  updatedAt: string;
  refId?: string;
  refAliases?: string[];
}

interface ClipIndex {
  version: typeof INDEX_VERSION;
  clips: ClipRecord[];
}

export interface CreatedTextClip {
  clipId: string;
  absolutePath: string;
}

export interface TextClipReconciliationResult {
  transferred: number;
  removed: number;
  retained: number;
}

/**
 * Owns pasted-text files outside Projects. The index deliberately records an
 * owner key so draft/task lifecycle code can transfer or release authority
 * without guessing from filenames or PathReferenceStore state.
 */
export class TextClipStore {
  readonly #indexPath: string;
  readonly #records = new Map<string, ClipRecord>();

  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    this.#indexPath = path.join(directory, "index.json");
    this.#load();
    this.removeMissingFiles();
  }

  create(text: string, ownerKey: string): CreatedTextClip {
    const clipId = randomUUID();
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const fileName = `pasted-text-${stamp}-${clipId.slice(0, 8)}.txt`;
    const absolutePath = path.join(this.directory, fileName);
    writePrivateAtomic(absolutePath, text);
    const now = new Date().toISOString();
    this.#records.set(clipId, { clipId, fileName, ownerKey, createdAt: now, updatedAt: now });
    this.#persist();
    return { clipId, absolutePath };
  }

  attachReference(clipId: string, refId: string): void {
    const record = this.#require(clipId);
    if (!validReferenceId(refId)) throw new Error("Text clip reference is invalid.");
    if (!record.refId) record.refId = refId;
    else if (!referenceIds(record).includes(refId)) {
      record.refAliases = [...(record.refAliases || []), refId].slice(-MAX_REFERENCE_ALIASES);
    }
    record.updatedAt = new Date().toISOString();
    this.#persist();
  }

  /** Tracks the new opaque reference created when a saved Path Chip is restored. */
  rebindReference(previousRefId: string, nextRefId: string): number {
    if (!validReferenceId(previousRefId) || !validReferenceId(nextRefId)) return 0;
    let changed = 0;
    const now = new Date().toISOString();
    for (const record of this.#records.values()) {
      if (!referenceIds(record).includes(previousRefId) || referenceIds(record).includes(nextRefId)) continue;
      record.refAliases = [...(record.refAliases || []), nextRefId].slice(-MAX_REFERENCE_ALIASES);
      record.updatedAt = now;
      changed += 1;
    }
    if (changed) this.#persist();
    return changed;
  }

  transferOwner(fromOwnerKey: string, toOwnerKey: string): number {
    let changed = 0;
    const now = new Date().toISOString();
    for (const record of this.#records.values()) {
      if (record.ownerKey !== fromOwnerKey) continue;
      record.ownerKey = toOwnerKey;
      record.updatedAt = now;
      changed += 1;
    }
    if (changed) this.#persist();
    return changed;
  }

  releaseOwner(ownerKey: string): number {
    const matching = [...this.#records.values()].filter((record) => record.ownerKey === ownerKey);
    for (const record of matching) this.#removeRecord(record);
    if (matching.length) this.#persist();
    return matching.length;
  }

  /**
   * Reconciles renderer optimizations against the backend's durable owner/ref
   * inventory, then removes absent references only after the record-age grace.
   */
  reconcileAuthority(authority: TextClipAuthoritySnapshot, olderThanMs: number, now = Date.now()): TextClipReconciliationResult {
    const ownersByReference = authorityOwnersByReference(authority);
    let transferred = 0;
    let removed = 0;
    let retained = 0;
    for (const record of [...this.#records.values()]) {
      const ownerKey = preferredOwner(record.ownerKey, referenceIds(record).flatMap((refId) => [...(ownersByReference.get(refId) || [])]));
      if (ownerKey) {
        if (ownerKey !== record.ownerKey) {
          record.ownerKey = ownerKey;
          record.updatedAt = new Date(now).toISOString();
          transferred += 1;
        }
        retained += 1;
        continue;
      }
      if (now - Date.parse(record.updatedAt) < olderThanMs) {
        retained += 1;
        continue;
      }
      this.#removeRecord(record);
      removed += 1;
    }
    removed += this.#removeUnindexedOrphans(olderThanMs, now);
    if (transferred || removed) this.#persist();
    return { transferred, removed, retained };
  }

  remove(clipId: string): boolean {
    const record = this.#records.get(clipId);
    if (!record) return false;
    this.#removeRecord(record);
    this.#persist();
    return true;
  }

  removeMissingFiles(): number {
    let removed = 0;
    for (const record of [...this.#records.values()]) {
      if (fs.existsSync(path.join(this.directory, record.fileName))) continue;
      this.#records.delete(record.clipId);
      removed += 1;
    }
    if (removed) this.#persist();
    return removed;
  }

  #require(clipId: string): ClipRecord {
    const record = this.#records.get(clipId);
    if (!record) throw new Error("Text clip is unknown.");
    return record;
  }

  #removeRecord(record: ClipRecord): void {
    this.#records.delete(record.clipId);
    try { fs.unlinkSync(path.join(this.directory, record.fileName)); }
    catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  #removeUnindexedOrphans(olderThanMs: number, now: number): number {
    const indexed = new Set([...this.#records.values()].map((record) => record.fileName));
    let removed = 0;
    for (const fileName of fs.readdirSync(this.directory)) {
      if (indexed.has(fileName) || !isManagedClipArtifact(fileName)) continue;
      const absolutePath = path.join(this.directory, fileName);
      let stat: fs.Stats;
      try { stat = fs.statSync(absolutePath); }
      catch (error) { if (isMissing(error)) continue; else throw error; }
      if (!stat.isFile() || now - stat.mtimeMs < olderThanMs) continue;
      try { fs.unlinkSync(absolutePath); }
      catch (error) { if (!isMissing(error)) throw error; }
      removed += 1;
    }
    return removed;
  }

  #load(): void {
    try {
      const value = JSON.parse(fs.readFileSync(this.#indexPath, "utf8")) as Partial<ClipIndex>;
      if (value.version !== INDEX_VERSION || !Array.isArray(value.clips)) return;
      for (const record of value.clips) {
        if (!validRecord(record)) continue;
        this.#records.set(record.clipId, record);
      }
    } catch (error) {
      if (!isMissing(error)) throw new Error("Text clip index is unreadable.", { cause: error });
    }
  }

  #persist(): void {
    const value: ClipIndex = { version: INDEX_VERSION, clips: [...this.#records.values()] };
    writePrivateAtomic(this.#indexPath, `${JSON.stringify(value, null, 2)}\n`);
  }
}

function validRecord(value: unknown): value is ClipRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ClipRecord>;
  return typeof record.clipId === "string"
    && /^[0-9a-f-]{36}$/i.test(record.clipId)
    && typeof record.fileName === "string"
    && path.basename(record.fileName) === record.fileName
    && typeof record.ownerKey === "string"
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
    && (record.refId === undefined || validReferenceId(record.refId))
    && (record.refAliases === undefined || (Array.isArray(record.refAliases) && record.refAliases.every(validReferenceId)));
}

function referenceIds(record: ClipRecord): string[] {
  return [...new Set([...(record.refId ? [record.refId] : []), ...(record.refAliases || [])])];
}

function authorityOwnersByReference(authority: TextClipAuthoritySnapshot): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const owner of authority.owners) {
    for (const refId of owner.refIds) {
      const owners = result.get(refId) || new Set<string>();
      owners.add(owner.ownerKey);
      result.set(refId, owners);
    }
  }
  return result;
}

function preferredOwner(current: string, candidates: string[]): string | null {
  const owners = [...new Set(candidates)];
  if (!owners.length) return null;
  const taskOwners = owners.filter((owner) => owner.startsWith("task:")).sort();
  if (taskOwners.length) return taskOwners.includes(current) ? current : taskOwners[0];
  return owners.includes(current) ? current : owners.sort()[0];
}

function validReferenceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isManagedClipArtifact(fileName: string): boolean {
  return /^pasted-text-[0-9TZ]+-[0-9a-f]{8}\.txt$/i.test(fileName)
    || /^pasted-text-[0-9TZ]+-[0-9a-f]{8}\.txt\.[^.]+\.[0-9a-f-]+\.tmp$/i.test(fileName)
    || /^index\.json\.[^.]+\.[0-9a-f-]+\.tmp$/i.test(fileName);
}

function writePrivateAtomic(destination: string, content: string): void {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best-effort temporary cleanup */ }
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
