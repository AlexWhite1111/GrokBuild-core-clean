import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComposerInputDocument, ComposerReplayDocument, PathReferenceKind, PathReferenceSummary } from "../../shared/contracts.js";
import { resolveLocalPathCandidate } from "./localPathCandidate.js";
import { AppProblem } from "./problemResponse.js";
import { resolveLocalFileReference } from "./resolveLocalFileReference.js";

interface PathEntry extends PathReferenceSummary {
  sourcePath: string;
  absolutePath: string;
  canonicalProjectPath: string;
  transportSerializedPath: string;
  expiresAt: number;
}

/**
 * Keeps filesystem authority in the backend. Registration performs metadata
 * checks only; file contents are never read, copied, encoded or previewed.
 */
export class PathReferenceStore {
  readonly #entries = new Map<string, PathEntry>();

  constructor(private readonly ttlMs = 24 * 60 * 60_000) {}

  registerPath(candidate: string, projectPath: string): PathReferenceSummary {
    let sourcePath: string;
    let absolutePath: string;
    let canonicalProject: string;
    try {
      const resolved = resolveLocalFileReference(resolveLocalPathCandidate(candidate, projectPath));
      sourcePath = resolved.sourcePath;
      absolutePath = resolved.resolvedPath;
      canonicalProject = fs.realpathSync.native(projectPath);
    } catch {
      throw new AppProblem(400, "PATH_REJECTED", "Selected path does not exist.");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new AppProblem(400, "PATH_REJECTED", "Selected path must be a file or directory.");
    }
    const projectSourcePath = path.resolve(projectPath);
    const relative = path.relative(projectSourcePath, sourcePath);
    const withinProject = isWithin(relative);
    const displayPath = withinProject ? (relative || ".") : sourcePath;
    const transportPath = projectDisplayPath(canonicalProject, absolutePath);
    const refId = randomUUID();
    const entry: PathEntry = {
      refId,
      name: path.basename(sourcePath) || sourcePath,
      displayPath,
      serializedPath: serializePath(displayPath),
      sizeBytes: stat.isFile() ? stat.size : 0,
      kind: classify(absolutePath, stat.isDirectory()),
      withinProject,
      valid: true,
      isDirectory: stat.isDirectory(),
      sourcePath,
      absolutePath,
      canonicalProjectPath: canonicalProject,
      transportSerializedPath: serializePath(transportPath),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.#entries.set(refId, entry);
    this.#prune();
    return publicEntry(entry);
  }

  restoreSaved(saved: PathReferenceSummary, projectPath: string): PathReferenceSummary {
    const candidate = saved.withinProject
      ? path.resolve(projectPath, saved.displayPath)
      : saved.displayPath;
    if (saved.withinProject) {
      const relative = path.relative(path.resolve(projectPath), candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new AppProblem(400, "PATH_REJECTED", "Saved project context escaped its project.");
      }
    } else if (!path.isAbsolute(candidate)) {
      throw new AppProblem(400, "PATH_REJECTED", "Saved external context is not absolute.");
    }
    const restored = this.registerPath(candidate, projectPath);
    if (restored.withinProject !== saved.withinProject) {
      throw new AppProblem(400, "PATH_REJECTED", "Saved context changed its project boundary.");
    }
    return restored;
  }

  rebind(refId: string, projectPath: string): PathReferenceSummary {
    return this.registerPath(this.#get(refId).sourcePath, projectPath);
  }

  resolve(references: Array<{ refId: string }>): { promptSuffix: string; paths: PathReferenceSummary[] } {
    const entries = references.map(({ refId }) => this.#get(refId));
    return {
      promptSuffix: entries.length ? `\n\n${entries.map((entry) => entry.transportSerializedPath).join(" ")}` : "",
      paths: entries.map(publicEntry),
    };
  }

  resolveDocument(document: ComposerInputDocument): { transportPrompt: string; displayPrompt: string; paths: PathReferenceSummary[]; composerDocument: ComposerReplayDocument } {
    const entries = new Map<string, PathEntry>();
    const replayNodes: ComposerReplayDocument["nodes"] = [];
    const transportNodes: Array<{ type: "text" | "path"; text: string }> = [];
    const displayNodes: Array<{ type: "text" | "path"; text: string }> = [];
    for (const node of document.nodes) {
      if (node.type === "text") {
        replayNodes.push({ type: "text", text: node.text });
        transportNodes.push({ type: "text", text: node.text });
        displayNodes.push({ type: "text", text: node.text });
        continue;
      }
      const entry = this.#get(node.refId);
      entries.set(node.refId, entry);
      replayNodes.push({ type: "path", path: publicEntry(entry) });
      transportNodes.push({ type: "path", text: entry.transportSerializedPath });
      displayNodes.push({ type: "path", text: entry.serializedPath });
    }
    const transportPrompt = renderTransportNodes(transportNodes);
    const displayPrompt = renderTransportNodes(displayNodes);
    if (!displayPrompt.trim()) throw new AppProblem(400, "VALIDATION_FAILED", "Composer document is empty.");
    if (Math.max(transportPrompt.length, displayPrompt.length) > 200_000) throw new AppProblem(400, "VALIDATION_FAILED", "Composer document is too long after resolving paths.");
    return {
      transportPrompt,
      displayPrompt,
      paths: [...entries.values()].map(publicEntry),
      composerDocument: { version: 1, nodes: replayNodes },
    };
  }

  absolutePath(refId: string): string {
    return this.#get(refId).absolutePath;
  }

  close(): void {
    this.#entries.clear();
  }

  #get(refId: string): PathEntry {
    if (!/^[0-9a-f-]{36}$/i.test(refId)) throw new AppProblem(400, "PATH_REJECTED", "Invalid path reference.");
    this.#prune();
    const entry = this.#entries.get(refId);
    if (!entry) throw new AppProblem(404, "NOT_FOUND", "Path reference expired or is unknown.");
    try {
      const current = resolveLocalFileReference(entry.sourcePath).resolvedPath;
      const stat = fs.statSync(current);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error("path changed");
      entry.absolutePath = current;
      entry.sizeBytes = stat.isFile() ? stat.size : 0;
      entry.kind = classify(current, stat.isDirectory());
      entry.isDirectory = stat.isDirectory();
      entry.transportSerializedPath = serializePath(projectDisplayPath(entry.canonicalProjectPath, current));
      entry.valid = true;
    } catch {
      entry.valid = false;
      throw new AppProblem(409, "PATH_REJECTED", `Path no longer exists: ${entry.displayPath}`);
    }
    entry.expiresAt = Date.now() + this.ttlMs;
    return entry;
  }

  #prune(): void {
    const now = Date.now();
    for (const [refId, entry] of this.#entries) if (entry.expiresAt <= now) this.#entries.delete(refId);
  }
}

function isWithin(relative: string): boolean {
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectDisplayPath(projectPath: string, candidate: string): string {
  const relative = path.relative(projectPath, candidate);
  return isWithin(relative) ? (relative || ".") : candidate;
}

function serializePath(candidate: string): string {
  return `\`${candidate.replaceAll("`", "\\`")}\``;
}

function renderTransportNodes(nodes: Array<{ type: "text" | "path"; text: string }>): string {
  let output = "";
  let previous: "text" | "path" | null = null;
  for (const node of nodes) {
    if (node.type === "path") {
      if (output && !/\s$/.test(output)) output += " ";
      output += node.text;
      previous = "path";
      continue;
    }
    if (previous === "path" && /^[\p{L}\p{N}_]/u.test(node.text)) output += " ";
    output += node.text;
    previous = "text";
  }
  if (previous === "path") output += " ";
  return output;
}

const groups: Array<[PathReferenceKind, Set<string>]> = [
  ["code", new Set([".bash", ".c", ".cc", ".clj", ".coffee", ".cpp", ".cs", ".css", ".dart", ".ex", ".exs", ".fs", ".go", ".graphql", ".h", ".html", ".java", ".js", ".jsx", ".json", ".kt", ".kts", ".less", ".lua", ".m", ".md", ".mm", ".php", ".proto", ".py", ".r", ".rb", ".rs", ".scala", ".scss", ".sh", ".sql", ".svelte", ".swift", ".toml", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml", ".zsh"])],
  ["image", new Set([".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".svg", ".webp"])],
  ["document", new Set([".doc", ".docx", ".epub", ".key", ".odp", ".odt", ".pages", ".pdf", ".ppt", ".pptx", ".rtf", ".txt"])],
  ["sheet", new Set([".csv", ".numbers", ".ods", ".tsv", ".xls", ".xlsx"])],
  ["archive", new Set([".7z", ".bz2", ".dmg", ".gz", ".rar", ".tar", ".tgz", ".xz", ".zip"])],
  ["media", new Set([".aac", ".avi", ".flac", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4", ".ogg", ".opus", ".wav", ".webm"])],
];

function classify(file: string, directory: boolean): PathReferenceKind {
  if (directory) return "folder";
  const extension = path.extname(file).toLowerCase();
  return groups.find(([, extensions]) => extensions.has(extension))?.[0] || "generic";
}

function publicEntry(entry: PathEntry): PathReferenceSummary {
  const { refId, name, displayPath, serializedPath, sizeBytes, kind, withinProject, valid, isDirectory } = entry;
  return { refId, name, displayPath, serializedPath, sizeBytes, kind, withinProject, valid, isDirectory };
}
