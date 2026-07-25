import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TaskMediaAttachment } from "../../shared/contracts.js";

export interface CachedMedia {
  taskId: string;
  kind: TaskMediaAttachment["kind"];
  mimeType: string;
  name: string;
  sizeBytes: number;
  canonicalPath: string;
}

interface CacheMetadataBase {
  taskId: string;
  kind: TaskMediaAttachment["kind"];
  mimeType: string;
  name: string;
  sizeBytes: number;
  sha256: string;
}

interface CacheMetadataV1 extends CacheMetadataBase { version: 1 }
interface CacheMetadataV2 extends CacheMetadataBase {
  version: 2;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
}
type CacheMetadata = CacheMetadataV1 | CacheMetadataV2;

export interface CacheReconcileResult {
  removedArtifacts: number;
  removedTemporaryFiles: number;
  retainedArtifacts: number;
}

/** Private disk persistence for ACP inline bytes. Paths never leave the server. */
export class MediaArtifactCache {
  readonly #directory: string | null;

  constructor(directory?: string) {
    this.#directory = directory ? path.resolve(directory) : null;
    if (this.#directory) fs.mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
  }

  get enabled(): boolean { return this.#directory !== null; }

  write(
    mediaId: string,
    metadata: Omit<CacheMetadataBase, "sha256">,
    bytes: Buffer,
    now: number,
    expiresAt: number,
  ): string | null {
    if (!this.#directory) return null;
    const mediaFile = this.#path(mediaId, ".media");
    const metadataFile = this.#path(mediaId, ".json");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = this.#readMetadata(mediaId);
    const createdAt = existing?.version === 2 ? existing.createdAt : now;
    atomicWrite(mediaFile, bytes);
    atomicWrite(metadataFile, Buffer.from(JSON.stringify({
      version: 2,
      ...metadata,
      sha256,
      createdAt,
      accessedAt: now,
      expiresAt,
    } satisfies CacheMetadataV2)));
    return this.#canonicalMediaPath(mediaId);
  }

  load(taskId: string, mediaId: string, now: number, renewedExpiresAt: number, _legacyTtlMs: number): CachedMedia | null {
    if (!this.#directory || !isUuid(mediaId)) return null;
    try {
      const metadata = this.#readMetadata(mediaId);
      if (!metadata || metadata.taskId !== taskId) return null;
      const mediaFile = this.#canonicalMediaPath(mediaId);
      const stat = fs.statSync(mediaFile);
      if (!validMetadata(metadata) || metadata.sizeBytes !== stat.size || !stat.isFile()
        || createHash("sha256").update(fs.readFileSync(mediaFile)).digest("hex") !== metadata.sha256) {
        this.remove(mediaId);
        return null;
      }
      this.#writeRenewedMetadata(mediaId, metadata, now, renewedExpiresAt, stat.mtimeMs);
      return {
        taskId,
        kind: metadata.kind,
        mimeType: metadata.mimeType,
        name: path.basename(metadata.name),
        sizeBytes: stat.size,
        canonicalPath: mediaFile,
      };
    } catch {
      return null;
    }
  }

  touch(taskId: string, mediaId: string, now: number, expiresAt: number): void {
    if (!this.#directory || !isUuid(mediaId)) return;
    const metadata = this.#readMetadata(mediaId);
    if (!metadata || metadata.taskId !== taskId || !validMetadata(metadata)) return;
    let mtime = now;
    try { mtime = fs.statSync(this.#path(mediaId, ".media")).mtimeMs; }
    catch { return; }
    this.#writeRenewedMetadata(mediaId, metadata, now, expiresAt, mtime);
  }

  remove(mediaId: string): void {
    if (!this.#directory || !isUuid(mediaId)) return;
    fs.rmSync(this.#path(mediaId, ".media"), { force: true });
    fs.rmSync(this.#path(mediaId, ".json"), { force: true });
  }

  removeTask(taskId: string): number {
    if (!this.#directory) return 0;
    let removed = 0;
    for (const mediaId of this.#artifactIds()) {
      if (this.#readMetadata(mediaId)?.taskId !== taskId) continue;
      this.remove(mediaId);
      removed += 1;
    }
    return removed;
  }

  reconcile(
    references: ReadonlyMap<string, ReadonlySet<string>>,
    protectedMediaIds: ReadonlySet<string>,
    now: number,
    legacyTtlMs: number,
    orphanGraceMs: number,
  ): CacheReconcileResult {
    const result: CacheReconcileResult = { removedArtifacts: 0, removedTemporaryFiles: 0, retainedArtifacts: 0 };
    if (!this.#directory) return result;
    for (const name of fs.readdirSync(this.#directory)) {
      if (!name.endsWith(".tmp")) continue;
      const candidate = path.join(this.#directory, name);
      try {
        if (fs.statSync(candidate).mtimeMs + orphanGraceMs > now) continue;
        fs.rmSync(candidate, { force: true });
        result.removedTemporaryFiles += 1;
      } catch { /* A concurrent cleanup already removed it. */ }
    }
    for (const mediaId of this.#artifactIds()) {
      const metadata = this.#readMetadata(mediaId);
      const artifactMtime = this.#artifactMtime(mediaId);
      const ageBase = metadata?.version === 2 ? Math.max(metadata.createdAt, metadata.accessedAt) : artifactMtime;
      const complete = Boolean(metadata) && this.#hasPair(mediaId) && Boolean(metadata && validMetadata(metadata));
      const referenced = Boolean(metadata && references.get(metadata.taskId)?.has(mediaId));
      const protectedInMemory = protectedMediaIds.has(mediaId);
      const expired = complete && !referenced && !protectedInMemory
        && metadataExpiry(metadata!, artifactMtime, legacyTtlMs) <= now;
      const oldEnough = ageBase + orphanGraceMs <= now;
      if (expired || ((!complete || (!referenced && !protectedInMemory)) && oldEnough)) {
        this.remove(mediaId);
        result.removedArtifacts += 1;
      } else {
        result.retainedArtifacts += 1;
      }
    }
    return result;
  }

  #writeRenewedMetadata(mediaId: string, metadata: CacheMetadata, now: number, expiresAt: number, fallbackCreatedAt: number): void {
    const renewed: CacheMetadataV2 = {
      version: 2,
      taskId: metadata.taskId,
      kind: metadata.kind,
      mimeType: metadata.mimeType,
      name: metadata.name,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
      createdAt: metadata.version === 2 ? metadata.createdAt : fallbackCreatedAt,
      accessedAt: now,
      expiresAt,
    };
    atomicWrite(this.#path(mediaId, ".json"), Buffer.from(JSON.stringify(renewed)));
  }

  #readMetadata(mediaId: string): CacheMetadata | null {
    if (!this.#directory || !isUuid(mediaId)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(this.#path(mediaId, ".json"), "utf8")) as unknown;
      return isRecord(value) && (value.version === 1 || value.version === 2) ? value as unknown as CacheMetadata : null;
    } catch { return null; }
  }

  #artifactIds(): Set<string> {
    if (!this.#directory) return new Set();
    const ids = new Set<string>();
    for (const name of fs.readdirSync(this.#directory)) {
      const match = /^([0-9a-f-]{36})\.(?:json|media)$/i.exec(name);
      if (match && isUuid(match[1])) ids.add(match[1]);
    }
    return ids;
  }

  #artifactMtime(mediaId: string): number {
    let latest = 0;
    for (const extension of [".media", ".json"] as const) {
      try { latest = Math.max(latest, fs.statSync(this.#path(mediaId, extension)).mtimeMs); }
      catch { /* Missing halves are handled as incomplete artifacts. */ }
    }
    return latest;
  }

  #hasPair(mediaId: string): boolean {
    return fs.existsSync(this.#path(mediaId, ".media")) && fs.existsSync(this.#path(mediaId, ".json"));
  }

  #canonicalMediaPath(mediaId: string): string {
    const candidate = fs.realpathSync.native(this.#path(mediaId, ".media"));
    const directory = this.#directory ? fs.realpathSync.native(this.#directory) : "";
    if (path.dirname(candidate) !== directory) throw new Error("Media cache entry escaped its private directory.");
    return candidate;
  }

  #path(mediaId: string, extension: ".media" | ".json"): string {
    if (!this.#directory || !isUuid(mediaId)) throw new Error("Invalid media cache key.");
    return path.join(this.#directory, `${mediaId}${extension}`);
  }
}

function atomicWrite(destination: string, bytes: Buffer): void {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  try { fs.renameSync(temporary, destination); }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
}

function validMetadata(value: CacheMetadata): boolean {
  return typeof value.taskId === "string" && value.taskId.length > 0
    && validKind(value.kind) && typeof value.mimeType === "string" && typeof value.name === "string"
    && validMime(value.kind, value.mimeType) && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256)
    && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0
    && (value.version === 1 || [value.createdAt, value.accessedAt, value.expiresAt].every((entry) => Number.isFinite(entry) && entry >= 0));
}

function metadataExpiry(metadata: CacheMetadata, legacyMtime: number, legacyTtlMs: number): number {
  return metadata.version === 2 ? metadata.expiresAt : legacyMtime + legacyTtlMs;
}

function validKind(value: unknown): value is TaskMediaAttachment["kind"] {
  return value === "image" || value === "audio" || value === "video";
}

function validMime(kind: TaskMediaAttachment["kind"], mimeType: string): boolean {
  return kind === "image" ? ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mimeType)
    : kind === "audio" ? ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/flac", "audio/ogg"].includes(mimeType)
      : ["video/mp4", "video/quicktime", "video/webm", "video/ogg"].includes(mimeType);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
