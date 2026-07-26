import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PathReferenceSummary, TaskMediaAttachment, TaskMessageBlock } from "../../shared/contracts.js";
import { extractRichTextMediaReferences } from "../../shared/richTextMedia.js";
import { AppProblem } from "../security/problemResponse.js";
import { resolveLocalPathCandidate } from "../security/localPathCandidate.js";
import { resolveLocalFileReference } from "../security/resolveLocalFileReference.js";
import { MediaArtifactCache, type CacheReconcileResult } from "./MediaArtifactCache.js";
import { fetchRemoteImage, type RemoteImagePayload } from "./RemoteImageFetcher.js";

interface MediaType {
  kind: TaskMediaAttachment["kind"];
  mimeType: string;
  extension: string;
}

interface MediaEntry extends TaskMediaAttachment {
  taskId: string;
  sourcePath?: string;
  canonicalPath?: string;
  bytes?: Buffer;
  expiresAt: number;
}

interface LeaseEntry {
  mediaId: string;
  taskId: string;
  expiresAt: number;
}

export interface MediaPayload {
  name: string;
  mimeType: string;
  sizeBytes: number;
  canonicalPath?: string;
  bytes?: Buffer;
}

export interface MediaArtifactStoreOptions {
  entryTtlMs?: number;
  leaseIdleTtlMs?: number;
  cacheDirectory?: string;
  cacheOrphanGraceMs?: number;
  maintenanceIntervalMs?: number | false;
  now?: () => number;
}

export interface SessionMediaScope {
  grokHome: string;
  sessionId: string | null | undefined;
}

const MEDIA_BY_EXTENSION = new Map<string, MediaType>([
  [".png", { kind: "image", mimeType: "image/png", extension: ".png" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg", extension: ".jpg" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg", extension: ".jpg" }],
  [".gif", { kind: "image", mimeType: "image/gif", extension: ".gif" }],
  [".webp", { kind: "image", mimeType: "image/webp", extension: ".webp" }],
  [".avif", { kind: "image", mimeType: "image/avif", extension: ".avif" }],
  [".mp3", { kind: "audio", mimeType: "audio/mpeg", extension: ".mp3" }],
  [".m4a", { kind: "audio", mimeType: "audio/mp4", extension: ".m4a" }],
  [".aac", { kind: "audio", mimeType: "audio/aac", extension: ".aac" }],
  [".wav", { kind: "audio", mimeType: "audio/wav", extension: ".wav" }],
  [".flac", { kind: "audio", mimeType: "audio/flac", extension: ".flac" }],
  [".ogg", { kind: "audio", mimeType: "audio/ogg", extension: ".ogg" }],
  [".opus", { kind: "audio", mimeType: "audio/ogg", extension: ".opus" }],
  [".mp4", { kind: "video", mimeType: "video/mp4", extension: ".mp4" }],
  [".m4v", { kind: "video", mimeType: "video/mp4", extension: ".m4v" }],
  [".mov", { kind: "video", mimeType: "video/quicktime", extension: ".mov" }],
  [".webm", { kind: "video", mimeType: "video/webm", extension: ".webm" }],
  [".ogv", { kind: "video", mimeType: "video/ogg", extension: ".ogv" }],
]);
const MEDIA_BY_MIME = new Map([...MEDIA_BY_EXTENSION.values()].map((value) => [value.mimeType, value]));
const MAX_INLINE_BYTES = 32 * 1024 * 1024;
const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;

/** Owns local media authority; renderer projections receive metadata only. */
export class MediaArtifactStore {
  readonly #entries = new Map<string, MediaEntry>();
  readonly #sourceIndex = new Map<string, string>();
  readonly #leases = new Map<string, LeaseEntry>();
  readonly #remotePending = new Map<string, Promise<MediaEntry>>();
  readonly #cache: MediaArtifactCache;
  #memoryBytes = 0;
  readonly #entryTtlMs: number;
  readonly #leaseIdleTtlMs: number;
  readonly #cacheOrphanGraceMs: number;
  readonly #now: () => number;
  readonly #maintenance: NodeJS.Timeout | null;
  #persistedReferences = new Map<string, ReadonlySet<string>>();
  #unresolvedPersistedTasks = new Set<string>();

  constructor(options: MediaArtifactStoreOptions = {}) {
    this.#entryTtlMs = options.entryTtlMs ?? 24 * 60 * 60_000;
    this.#leaseIdleTtlMs = options.leaseIdleTtlMs ?? 20 * 60_000;
    this.#cacheOrphanGraceMs = options.cacheOrphanGraceMs ?? 5 * 60_000;
    this.#now = options.now || Date.now;
    this.#cache = new MediaArtifactCache(options.cacheDirectory);
    const interval = options.maintenanceIntervalMs === false ? 0 : options.maintenanceIntervalMs ?? 60_000;
    this.#maintenance = this.#cache.enabled && interval > 0 ? setInterval(() => this.prune(), interval) : null;
    this.#maintenance?.unref();
  }

  /** Reconciles private cache files against the durable media IDs referenced by task events. */
  reconcilePersisted(
    references: ReadonlyMap<string, ReadonlySet<string>>,
    unresolvedTaskIds: ReadonlySet<string> = new Set(),
  ): CacheReconcileResult {
    this.#persistedReferences = new Map([...references].map(([taskId, mediaIds]) => [taskId, new Set(mediaIds)]));
    this.#unresolvedPersistedTasks = new Set(unresolvedTaskIds);
    return this.#reconcileCache();
  }

  resolvePersistedTask(taskId: string, mediaIds: ReadonlySet<string>): CacheReconcileResult {
    this.#persistedReferences.set(taskId, new Set(mediaIds));
    this.#unresolvedPersistedTasks.delete(taskId);
    return this.#reconcileCache();
  }

  #reconcileCache(): CacheReconcileResult {
    return this.#cache.reconcile(
      this.#persistedReferences,
      this.#unresolvedPersistedTasks,
      new Set(this.#entries.keys()),
      this.#now(),
      this.#entryTtlMs,
      this.#cacheOrphanGraceMs,
    );
  }

  /** Removes every in-memory capability, lease, and private cache entry owned by one task. */
  removeTask(taskId: string): void {
    for (const [mediaId, entry] of this.#entries) if (entry.taskId === taskId) this.#drop(mediaId);
    for (const [ticket, lease] of this.#leases) if (lease.taskId === taskId) this.#leases.delete(ticket);
    this.#cache.removeTask(taskId);
    this.#persistedReferences.delete(taskId);
    this.#unresolvedPersistedTasks.delete(taskId);
  }

  prune(): void {
    this.#prune();
    this.#cache.reconcile(
      this.#persistedReferences,
      this.#unresolvedPersistedTasks,
      new Set(this.#entries.keys()),
      this.#now(),
      this.#entryTtlMs,
      this.#cacheOrphanGraceMs,
    );
  }

  registerAcpContent(taskId: string, projectPath: string, value: unknown): TaskMediaAttachment[] {
    try {
      const content = asRecord(value);
      const type = text(content.type)?.toLowerCase();
      if (type === "image" || type === "audio" || type === "video") {
        const mimeType = text(content.mimeType);
        const data = text(content.data);
        if (data && mimeType) return [this.#registerInline(taskId, data, mimeType, text(content.uri))];
        return this.#fromUri(taskId, projectPath, text(content.uri), "acp", mimeType);
      }
      if (type === "resource_link") {
        return this.#fromUri(taskId, projectPath, text(content.uri), "acp", text(content.mimeType));
      }
      if (type === "resource") {
        const resource = asRecord(content.resource);
        const mimeType = text(resource.mimeType);
        const blob = text(resource.blob);
        if (blob && mimeType) return [this.#registerInline(taskId, blob, mimeType, text(resource.uri))];
        return this.#fromUri(taskId, projectPath, text(resource.uri), "acp", mimeType);
      }
    } catch {
      // A malformed or unsupported media block must not break the surrounding turn.
    }
    return [];
  }

  registerAcpToolContent(taskId: string, projectPath: string, value: unknown): TaskMediaAttachment[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const item = asRecord(entry);
      return item.type === "content" ? this.registerAcpContent(taskId, projectPath, item.content) : [];
    });
  }

  discoverInText(taskId: string, projectPath: string, value: string, session?: SessionMediaScope): TaskMediaAttachment[] {
    const result: TaskMediaAttachment[] = [];
    for (const candidate of extractRichTextMediaReferences(value)) {
      const cleaned = cleanCandidate(candidate.reference);
      if (!cleaned) continue;
      const sources = [
        resolveLocalPathCandidate(cleaned, projectPath),
        resolveSessionMediaCandidate(cleaned, projectPath, session),
      ];
      for (const source of sources) {
        if (!source) continue;
        try {
          const entry = this.#registerFile(taskId, source, "local");
          if (!entry) continue;
          result.push({ ...entry, placementId: stablePlacementId(taskId, entry.mediaId, candidate.anchor.start, candidate.anchor.end), syntax: candidate.syntax, anchor: candidate.anchor });
          break;
        } catch {
          // Text can contain examples and stale paths; try the next valid resolution base.
        }
      }
    }
    return result;
  }

  async registerRemoteImage(
    taskId: string,
    value: string,
    anchor: NonNullable<TaskMediaAttachment["anchor"]>,
    preferredName?: string,
  ): Promise<TaskMediaAttachment> {
    const url = new URL(value);
    url.hash = "";
    const sourceKey = `${taskId}\0remote\0${url.href}`;
    const existing = this.#existing(sourceKey) || this.#loadCached(taskId, stableMediaId(sourceKey), "remote");
    if (existing) {
      this.#sourceIndex.set(sourceKey, existing.mediaId);
      return remotePlacement(existing, taskId, anchor);
    }
    let pending = this.#remotePending.get(sourceKey);
    if (!pending) {
      pending = fetchRemoteImage(url.href).then((payload) => this.#registerRemoteBytes(taskId, sourceKey, payload, preferredName));
      this.#remotePending.set(sourceKey, pending);
    }
    try {
      return remotePlacement(await pending, taskId, anchor);
    } finally {
      if (this.#remotePending.get(sourceKey) === pending) this.#remotePending.delete(sourceKey);
    }
  }

  /** Composer paths are already authenticated opaque references; never rediscover them from serialized text. */
  registerPathReferences(taskId: string, projectPath: string, paths: PathReferenceSummary[]): TaskMediaAttachment[] {
    return paths.flatMap((reference) => {
      if (reference.isDirectory || (reference.kind !== "image" && reference.kind !== "media")) return [];
      try {
        const candidate = resolveLocalPathCandidate(reference.displayPath, projectPath);
        const entry = this.#registerFile(taskId, candidate, "local");
        const pathRefId = reference.refId || reference.displayPath;
        return entry ? [{ ...entry, placementId: stablePlacementId(taskId, entry.mediaId, pathRefId), syntax: "structured", pathRefId }] : [];
      } catch {
        return [];
      }
    });
  }

  hydrateMessages(taskId: string, projectPath: string, messages: TaskMessageBlock[], session?: SessionMediaScope): void {
    for (const message of messages) {
      if (message.role === "thought" || !message.text) continue;
      const retained = message.media?.filter((item) => !item.anchor && !item.pathRefId);
      message.media = mergeMedia(retained, [
        ...this.registerPathReferences(taskId, projectPath, message.paths || []),
        ...this.discoverInText(taskId, projectPath, message.text, session),
      ]);
    }
  }

  lease(taskId: string, mediaId: string): { ticket: string; expiresAt: string } {
    this.#prune();
    const entry = this.#entries.get(mediaId) || this.#loadCached(taskId, mediaId);
    if (!entry || entry.taskId !== taskId) throw new AppProblem(404, "NOT_FOUND", "Media artifact is unavailable.");
    this.#validateEntry(entry);
    const ticket = randomBytes(32).toString("base64url");
    const now = this.#now();
    const expiresAt = now + this.#leaseIdleTtlMs;
    this.#renew(entry, now);
    this.#leases.set(ticket, { mediaId, taskId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  resolveLease(ticket: string): MediaPayload {
    this.#prune();
    const lease = this.#leases.get(ticket);
    if (!lease) throw new AppProblem(404, "NOT_FOUND", "Media lease expired or is unknown.");
    const entry = this.#entries.get(lease.mediaId);
    if (!entry || entry.taskId !== lease.taskId) throw new AppProblem(404, "NOT_FOUND", "Media artifact is unavailable.");
    this.#validateEntry(entry);
    const now = this.#now();
    lease.expiresAt = now + this.#leaseIdleTtlMs;
    this.#renew(entry, now);
    return { name: entry.name, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes, canonicalPath: entry.canonicalPath, bytes: entry.bytes };
  }

  absolutePath(taskId: string, mediaId: string): string {
    this.#prune();
    const entry = this.#entries.get(mediaId) || this.#loadCached(taskId, mediaId);
    if (!entry || entry.taskId !== taskId) throw new AppProblem(404, "NOT_FOUND", "Media artifact is unavailable.");
    this.#validateEntry(entry);
    this.#renew(entry, this.#now());
    if (entry.source === "remote") throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Remote media has no revealable local source.");
    if (!entry.canonicalPath) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "This media artifact has no local file to reveal.");
    return entry.canonicalPath;
  }

  /** Returns the user-selected alias path so a leased media chip preserves its original identity. */
  referencePath(taskId: string, mediaId: string): string {
    this.#prune();
    const entry = this.#entries.get(mediaId) || this.#loadCached(taskId, mediaId);
    if (!entry || entry.taskId !== taskId) throw new AppProblem(404, "NOT_FOUND", "Media artifact is unavailable.");
    this.#validateEntry(entry);
    this.#renew(entry, this.#now());
    if (entry.source === "remote") throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Remote media has no local source.");
    const reference = entry.sourcePath || entry.canonicalPath;
    if (!reference) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "This media artifact has no local file reference.");
    return reference;
  }

  close(): void {
    if (this.#maintenance) clearInterval(this.#maintenance);
    this.#entries.clear();
    this.#sourceIndex.clear();
    this.#leases.clear();
    this.#remotePending.clear();
    this.#persistedReferences.clear();
    this.#unresolvedPersistedTasks.clear();
    this.#memoryBytes = 0;
  }

  #fromUri(taskId: string, projectPath: string, uri: string | undefined, source: TaskMediaAttachment["source"], mimeHint?: string): TaskMediaAttachment[] {
    if (!uri) return [];
    const candidate = resolveLocalPathCandidate(uri, projectPath);
    const entry = this.#registerFile(taskId, candidate, source, mimeHint);
    return entry ? [entry] : [];
  }

  #registerFile(taskId: string, candidate: string, source: TaskMediaAttachment["source"], mimeHint?: string): TaskMediaAttachment | null {
    const resolved = resolveLocalFileReference(path.resolve(candidate));
    const { sourcePath, resolvedPath: canonicalPath } = resolved;
    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) return null;
    const mediaType = MEDIA_BY_EXTENSION.get(path.extname(canonicalPath).toLowerCase())
      || (mimeHint ? MEDIA_BY_MIME.get(mimeHint.toLowerCase()) : undefined);
    if (!mediaType) return null;
    const sourceKey = `${taskId}\0file\0${sourcePath}`;
    const existing = this.#existing(sourceKey);
    if (existing) return publicEntry(existing);
    const entry: MediaEntry = {
      mediaId: stableMediaId(sourceKey), placementId: stableMediaId(sourceKey), taskId, kind: mediaType.kind, mimeType: mediaType.mimeType,
      name: path.basename(sourcePath) || path.basename(canonicalPath), sizeBytes: stat.size, source, sourcePath, canonicalPath,
      expiresAt: this.#now() + this.#entryTtlMs,
    };
    this.#entries.set(entry.mediaId, entry);
    this.#sourceIndex.set(sourceKey, entry.mediaId);
    this.#prune();
    return publicEntry(entry);
  }

  #registerInline(taskId: string, encoded: string, mimeType: string, uri?: string): TaskMediaAttachment {
    this.#prune();
    const projected = inlineMediaIdentity(taskId, encoded, mimeType, uri);
    const { attachment, bytes, sourceKey } = projected;
    const existing = this.#existing(sourceKey);
    if (existing) return publicEntry(existing);
    const now = this.#now();
    const expiresAt = now + this.#entryTtlMs;
    const canonicalPath = this.#cache.write(attachment.mediaId, {
      taskId,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
    }, bytes, now, expiresAt);
    if (!canonicalPath && this.#memoryBytes + bytes.length > MAX_MEMORY_BYTES) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Inline media memory limit reached.");
    }
    const entry: MediaEntry = {
      ...attachment,
      taskId,
      ...(canonicalPath ? { canonicalPath } : { bytes }), expiresAt,
    };
    this.#entries.set(entry.mediaId, entry);
    this.#sourceIndex.set(sourceKey, entry.mediaId);
    if (!canonicalPath) this.#memoryBytes += bytes.length;
    this.#prune();
    return publicEntry(entry);
  }

  #registerRemoteBytes(taskId: string, sourceKey: string, payload: RemoteImagePayload, preferredName?: string): MediaEntry {
    this.#prune();
    const existing = this.#existing(sourceKey);
    if (existing) return existing;
    const mediaType = MEDIA_BY_MIME.get(payload.mimeType);
    if (!mediaType || mediaType.kind !== "image" || !payload.bytes.length || payload.bytes.length > MAX_INLINE_BYTES) {
      throw new AppProblem(400, "VALIDATION_FAILED", "Remote image payload was unsupported or too large.");
    }
    const mediaId = stableMediaId(sourceKey);
    const now = this.#now();
    const expiresAt = now + this.#entryTtlMs;
    const name = cleanRemoteName(preferredName) || payload.name;
    const canonicalPath = this.#cache.write(mediaId, {
      taskId, kind: "image", mimeType: payload.mimeType, name, sizeBytes: payload.bytes.length,
    }, payload.bytes, now, expiresAt);
    if (!canonicalPath && this.#memoryBytes + payload.bytes.length > MAX_MEMORY_BYTES) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Remote image memory limit reached.");
    }
    const entry: MediaEntry = {
      mediaId, placementId: mediaId, taskId, kind: "image", mimeType: payload.mimeType,
      name, sizeBytes: payload.bytes.length, source: "remote",
      ...(canonicalPath ? { canonicalPath } : { bytes: payload.bytes }), expiresAt,
    };
    this.#entries.set(mediaId, entry);
    this.#sourceIndex.set(sourceKey, mediaId);
    if (!canonicalPath) this.#memoryBytes += payload.bytes.length;
    this.#prune();
    return entry;
  }

  #existing(sourceKey: string): MediaEntry | null {
    const mediaId = this.#sourceIndex.get(sourceKey);
    const entry = mediaId ? this.#entries.get(mediaId) : undefined;
    if (!entry) return null;
    this.#renew(entry, this.#now());
    return entry;
  }

  #loadCached(taskId: string, mediaId: string, source: TaskMediaAttachment["source"] = "acp"): MediaEntry | null {
    const now = this.#now();
    const expiresAt = now + this.#entryTtlMs;
    const cached = this.#cache.load(taskId, mediaId, now, expiresAt, this.#entryTtlMs);
    if (!cached) return null;
    const entry: MediaEntry = { mediaId, placementId: mediaId, taskId, kind: cached.kind, mimeType: cached.mimeType, name: cached.name, sizeBytes: cached.sizeBytes, source, canonicalPath: cached.canonicalPath, expiresAt };
    this.#entries.set(mediaId, entry);
    this.#sourceIndex.set(`${taskId}\0cache\0${mediaId}`, mediaId);
    return entry;
  }

  #validateEntry(entry: MediaEntry): void {
    if (entry.bytes) return;
    if (!entry.canonicalPath) throw new AppProblem(404, "NOT_FOUND", "Media artifact has no readable source.");
    try {
      const current = entry.sourcePath
        ? resolveLocalFileReference(entry.sourcePath).resolvedPath
        : fs.realpathSync.native(entry.canonicalPath);
      const stat = fs.statSync(current);
      if (!stat.isFile() || stat.size !== entry.sizeBytes) throw new Error("media changed");
      entry.canonicalPath = current;
    } catch {
      this.#drop(entry.mediaId);
      throw new AppProblem(409, "PATH_REJECTED", "Local media changed after it was discovered.");
    }
  }

  #prune(): void {
    const now = this.#now();
    for (const [ticket, lease] of this.#leases) if (lease.expiresAt <= now) this.#leases.delete(ticket);
    // Disk-backed entries are tiny capabilities over durable task artifacts.
    // Keep them until removeTask or cache reconciliation proves them orphaned.
    for (const [mediaId, entry] of this.#entries) if (entry.bytes && entry.expiresAt <= now) this.#drop(mediaId);
  }

  #drop(mediaId: string): void {
    const entry = this.#entries.get(mediaId);
    if (!entry) return;
    this.#entries.delete(mediaId);
    if (entry.bytes) this.#memoryBytes -= entry.bytes.length;
    for (const [key, value] of this.#sourceIndex) if (value === mediaId) this.#sourceIndex.delete(key);
    for (const [ticket, lease] of this.#leases) if (lease.mediaId === mediaId) this.#leases.delete(ticket);
    this.#cache.remove(mediaId);
  }

  #renew(entry: MediaEntry, now: number): void {
    entry.expiresAt = now + this.#entryTtlMs;
    this.#cache.touch(entry.taskId, entry.mediaId, now, entry.expiresAt);
  }
}

export function mergeMedia(current: TaskMediaAttachment[] | undefined, next: TaskMediaAttachment[]): TaskMediaAttachment[] | undefined {
  const merged = [...(current || [])];
  for (const item of next) {
    const index = merged.findIndex((entry) => entry.placementId === item.placementId);
    if (index < 0) merged.push(item);
    else merged[index] = item;
  }
  return merged.length ? merged : undefined;
}

/** Reconstructs the stable public identity of inline ACP bytes without creating
 * a second cache or persistence path. */
export function projectInlineAcpContent(taskId: string, value: unknown): TaskMediaAttachment[] {
  try {
    const content = asRecord(value);
    const type = text(content.type)?.toLowerCase();
    if (type === "image" || type === "audio" || type === "video") {
      const data = text(content.data);
      const mimeType = text(content.mimeType);
      return data && mimeType
        ? [inlineMediaIdentity(taskId, data, mimeType, text(content.uri)).attachment]
        : [];
    }
    if (type === "resource") {
      const resource = asRecord(content.resource);
      const data = text(resource.blob);
      const mimeType = text(resource.mimeType);
      return data && mimeType
        ? [inlineMediaIdentity(taskId, data, mimeType, text(resource.uri)).attachment]
        : [];
    }
  } catch {
    // Invalid or unsupported historical media remains absent from the projection.
  }
  return [];
}

function inlineMediaIdentity(
  taskId: string,
  encoded: string,
  mimeType: string,
  uri?: string,
): {
  attachment: TaskMediaAttachment;
  bytes: Buffer;
  sourceKey: string;
} {
  const mediaType = MEDIA_BY_MIME.get(mimeType.toLowerCase());
  if (!mediaType) throw new AppProblem(400, "VALIDATION_FAILED", "ACP media type is not supported for inline rendering.");
  const normalized = encoded.replace(/\s/g, "");
  if (!normalized || normalized.length > Math.ceil(MAX_INLINE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new AppProblem(400, "VALIDATION_FAILED", "ACP inline media is invalid or too large.");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length || bytes.length > MAX_INLINE_BYTES) {
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Inline media memory limit reached.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const sourceKey = `${taskId}\0inline\0${digest}`;
  const mediaId = stableMediaId(sourceKey);
  return {
    attachment: {
      mediaId,
      placementId: mediaId,
      kind: mediaType.kind,
      mimeType: mediaType.mimeType,
      name: (uri ? safeUriName(uri) : null) || `media${mediaType.extension}`,
      sizeBytes: bytes.length,
      source: "acp",
    },
    bytes,
    sourceKey,
  };
}

function cleanCandidate(value: string): string | null {
  let candidate = value.trim().replace(/^<|>$/g, "");
  const titled = /^(\S+)\s+["'][^"']*["']$/.exec(candidate);
  if (titled) candidate = titled[1];
  try { if (candidate.startsWith("file:")) candidate = fileURLToPath(new URL(candidate)); } catch { return null; }
  return candidate;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function resolveSessionMediaCandidate(
  value: string,
  projectPath: string,
  scope: SessionMediaScope | undefined,
): string | null {
  if (!scope?.sessionId || !SESSION_ID.test(scope.sessionId)) return null;
  const candidate = value.trim().replace(/^<|>$/g, "").replace(/\\([() ])/g, "$1");
  if (!candidate || candidate.startsWith("file:") || candidate === "~" || candidate.startsWith("~/") || path.isAbsolute(candidate)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) return null;
  const sessionRoot = path.resolve(
    scope.grokHome,
    "sessions",
    encodeURIComponent(path.resolve(projectPath)),
    scope.sessionId,
  );
  const resolved = path.resolve(sessionRoot, candidate);
  const relative = path.relative(sessionRoot, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : null;
}

function safeUriName(uri: string): string | null {
  try {
    const value = uri.startsWith("file:") ? fileURLToPath(new URL(uri)) : uri;
    return path.basename(value) || null;
  } catch { return null; }
}

function publicEntry(entry: MediaEntry): TaskMediaAttachment {
  const { mediaId, placementId, kind, mimeType, name, sizeBytes, source } = entry;
  return { mediaId, placementId, kind, mimeType, name, sizeBytes, source };
}

function remotePlacement(entry: MediaEntry, taskId: string, anchor: NonNullable<TaskMediaAttachment["anchor"]>): TaskMediaAttachment {
  return {
    ...publicEntry(entry),
    placementId: stablePlacementId(taskId, entry.mediaId, anchor.start, anchor.end),
    syntax: "explicit",
    anchor,
  };
}

function cleanRemoteName(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/[\0\r\n/\\]/g, "-").slice(0, 512);
  return cleaned || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function stableMediaId(sourceKey: string): string {
  const value = createHash("sha256").update(sourceKey).digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(value[16], 16) & 3) | 8).toString(16);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-${variant}${value.slice(17, 20)}-${value.slice(20)}`;
}

function stablePlacementId(taskId: string, mediaId: string, ...coordinates: Array<string | number>): string {
  return stableMediaId(`${taskId}\0placement\0${mediaId}\0${coordinates.join(":")}`);
}
