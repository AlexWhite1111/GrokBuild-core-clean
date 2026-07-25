import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MemoryFilePreview,
  MemoryFileSummary,
  MemoryInventory,
  MemoryMutationPreview,
  MemoryScope,
  MemorySearchSnapshot,
} from "../../shared/contracts.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

type Input = Record<string, unknown>;
type ClearScope = "global" | "workspace" | "all";

const MAX_FILES = 500;
const MAX_PREVIEW_BYTES = 256_000;
const MAX_SEARCH_BYTES = 10_000_000;

export class MemoryService {
  private readonly memoryRoot: string;
  private readonly configFile: string;

  constructor(
    private readonly binary: string,
    private readonly workspace: WorkspaceSource,
    private readonly grokHome: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly processes?: OwnedProcessRegistry,
  ) {
    this.memoryRoot = path.join(grokHome, "memory");
    this.configFile = path.join(grokHome, "config.toml");
  }

  async inventory(): Promise<MemoryInventory> {
    const config = await this.readConfig();
    const configuredEnabled = parseMemoryEnabled(config);
    const environmentOverride = parseEnvironmentOverride(this.environment.GROK_MEMORY);
    const scan = await this.scan();
    return {
      scannedAt: new Date().toISOString(),
      status: {
        configuredEnabled,
        environmentOverride,
        effectiveAtNextAgentStart: environmentOverride === "enabled" || (environmentOverride == null && configuredEnabled === true),
        source: environmentOverride ? "environment" : configuredEnabled == null ? "default" : "user-config",
        existingSessionsMayDiffer: true,
        memoryRootExists: scan.rootExists,
      },
      files: scan.files,
      totalBytes: scan.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      truncated: scan.truncated,
      capabilities: {
        localPreview: true,
        localTextSearch: true,
        deleteSessionFile: true,
        officialClearCli: true,
        hybridSearch: false,
        hybridSearchReason: "Grok exposes memory_search only as an agent tool, not as a client-callable CLI or ACP method; GUI results are explicitly local text matches.",
      },
    };
  }

  async previewFile(id: unknown): Promise<MemoryFilePreview> {
    const file = await this.resolveFileId(id);
    const handle = await fs.open(file.absolutePath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(file.summary.sizeBytes, MAX_PREVIEW_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return {
        ...file.summary,
        content: buffer.subarray(0, bytesRead).toString("utf8"),
        contentTruncated: file.summary.sizeBytes > MAX_PREVIEW_BYTES,
      };
    } finally {
      await handle.close();
    }
  }

  async search(queryInput: unknown): Promise<MemorySearchSnapshot> {
    const query = requiredText(queryInput, "query", 100).toLocaleLowerCase();
    const scan = await this.scan();
    let bytesRead = 0;
    let truncated = scan.truncated;
    const results: MemorySearchSnapshot["results"] = [];
    for (const file of scan.files) {
      if (bytesRead >= MAX_SEARCH_BYTES) { truncated = true; break; }
      const resolved = await this.resolveFileId(file.id);
      const length = Math.min(file.sizeBytes, MAX_PREVIEW_BYTES, MAX_SEARCH_BYTES - bytesRead);
      const handle = await fs.open(resolved.absolutePath, "r");
      let content = "";
      try {
        const buffer = Buffer.alloc(length);
        const read = await handle.read(buffer, 0, length, 0);
        bytesRead += read.bytesRead;
        content = buffer.subarray(0, read.bytesRead).toString("utf8");
      } finally { await handle.close(); }
      const lower = content.toLocaleLowerCase();
      const indexes: number[] = [];
      for (let at = lower.indexOf(query); at >= 0 && indexes.length < 100; at = lower.indexOf(query, at + Math.max(query.length, 1))) indexes.push(at);
      if (!indexes.length) continue;
      const start = Math.max(0, indexes[0] - 140);
      const end = Math.min(content.length, indexes[0] + query.length + 220);
      results.push({ file, excerpt: content.slice(start, end).replace(/\s+/g, " ").trim(), matchCount: indexes.length });
      if (results.length >= 50) { truncated = true; break; }
    }
    results.sort((a, b) => b.matchCount - a.matchCount || b.file.modifiedAt.localeCompare(a.file.modifiedAt));
    return {
      query: String(queryInput),
      mode: "local-text",
      results,
      truncated,
      note: "Local literal text search only. Scores and semantic recall are not fabricated because Grok's hybrid memory_search tool has no client transport.",
    };
  }

  async previewMutation(input: Input): Promise<MemoryMutationPreview> {
    const action = mutationAction(input.action);
    if (action === "set-enabled") {
      if (typeof input.enabled !== "boolean") throw new Error("enabled must be boolean");
      const before = parseMemoryEnabled(await this.readConfig());
      return {
        token: `memory:enabled:${input.enabled}`,
        action,
        scope: "config",
        target: "~/.grok/config.toml [memory].enabled",
        changes: [{ field: "memory.enabled", before: before == null ? "unset (default false)" : String(before), after: String(input.enabled) }],
        warnings: ["This persistent setting applies when the Grok ACP agent starts; existing sessions may keep their session-scoped state."],
      };
    }
    if (action === "delete-session") {
      const file = await this.resolveFileId(input.id);
      if (file.summary.scope !== "session") throw new Error("Only session memory files can be deleted individually");
      return {
        token: `delete-memory:${file.summary.id}`,
        action,
        scope: "session",
        target: file.summary.displayPath,
        changes: [{ field: "file", before: `${file.summary.sizeBytes} bytes`, after: "deleted" }],
        warnings: ["Grok's file watcher removes stale index chunks on the next memory search."],
      };
    }
    const scope = clearScope(input.scope);
    const inventory = await this.inventory();
    const visible = scope === "global" ? inventory.files.filter((file) => file.scope === "global") : scope === "all" ? inventory.files : [];
    return {
      token: `clear-memory:${scope}`,
      action,
      scope,
      target: scope === "workspace" ? "current workspace identity resolved by Grok CLI" : scope === "global" ? "global MEMORY.md" : "global and current workspace memory",
      changes: [{ field: "visibleFiles", before: scope === "workspace" ? "resolved by official CLI" : `${visible.length} files / ${visible.reduce((sum, file) => sum + file.sizeBytes, 0)} bytes`, after: "cleared" }],
      warnings: [
        "The apply step calls official `grok memory clear --yes`; it does not delete through a shell wildcard.",
        ...(scope === "workspace" ? ["Grok derives the current workspace directory from repository origin or path; that private hash mapping is not reimplemented by the GUI."] : []),
      ],
    };
  }

  async applyMutation(input: Input, confirmation: unknown): Promise<{ ok: true; action: string; scope: string; output?: string }> {
    const preview = await this.previewMutation(input);
    if (confirmation !== preview.token) throw new Error(`Confirmation must exactly equal ${preview.token}`);
    if (preview.action === "set-enabled") {
      const enabled = input.enabled as boolean;
      await atomicWrite(this.configFile, patchMemoryEnabled(await this.readConfig(), enabled));
      return { ok: true, action: preview.action, scope: preview.scope };
    }
    if (preview.action === "delete-session") {
      const file = await this.resolveFileId(input.id);
      if (file.summary.scope !== "session") throw new Error("Only session memory files can be deleted individually");
      await fs.rm(file.absolutePath);
      return { ok: true, action: preview.action, scope: preview.scope };
    }
    const scope = clearScope(input.scope);
    if (scope === "all" && input.confirmAll !== "CLEAR ALL") {
      throw new Error("Clearing all memory requires the second confirmation phrase CLEAR ALL");
    }
    const result = await new GrokRunner(this.binary, this.processes).run(["memory", "clear", `--${scope}`, "--yes"], {
      cwd: currentWorkspace(this.workspace),
      timeoutMs: 30_000,
      maxOutputBytes: 100_000,
      env: { GROK_HOME: this.grokHome },
    });
    if (result.code !== 0) throw new Error(safeOutput(result.stderr || result.stdout, this.grokHome) || `grok memory clear exited ${result.code}`);
    return { ok: true, action: preview.action, scope, output: safeOutput(result.stdout || result.stderr, this.grokHome) };
  }

  private async scan(): Promise<{ files: MemoryFileSummary[]; truncated: boolean; rootExists: boolean }> {
    const files: MemoryFileSummary[] = [];
    let truncated = false;
    let rootEntries: Dirent[];
    try { rootEntries = await fs.readdir(this.memoryRoot, { withFileTypes: true }); }
    catch (error) { if (isNodeError(error) && error.code === "ENOENT") return { files, truncated, rootExists: false }; throw error; }
    const walk = async (directory: string, parts: string[], entries: Dirent[], depth: number): Promise<void> => {
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= MAX_FILES) { truncated = true; return; }
        if (entry.isSymbolicLink()) continue;
        const nextParts = [...parts, entry.name];
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth >= 4) { truncated = true; continue; }
          await walk(absolute, nextParts, await fs.readdir(absolute, { withFileTypes: true }), depth + 1);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
        const stat = await fs.lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        files.push(toSummary(nextParts, stat));
      }
    };
    await walk(this.memoryRoot, [], rootEntries, 0);
    files.sort((a, b) => scopeOrder(a.scope) - scopeOrder(b.scope) || b.modifiedAt.localeCompare(a.modifiedAt));
    return { files, truncated, rootExists: true };
  }

  private async resolveFileId(idInput: unknown): Promise<{ absolutePath: string; summary: MemoryFileSummary }> {
    const id = requiredText(idInput, "id", 1_000);
    let relative: string;
    try { relative = Buffer.from(id, "base64url").toString("utf8"); } catch { throw new Error("Invalid memory file id"); }
    if (!relative || relative.includes("\0") || path.isAbsolute(relative)) throw new Error("Invalid memory file id");
    const normalized = relative.replace(/\\/g, "/");
    if (normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid memory file id");
    const absolutePath = path.resolve(this.memoryRoot, ...normalized.split("/"));
    const relativeCheck = path.relative(this.memoryRoot, absolutePath);
    if (!relativeCheck || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) throw new Error("Memory path escaped the root");
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || path.extname(absolutePath).toLowerCase() !== ".md") throw new Error("Memory target is not a regular Markdown file");
    const rootReal = await fs.realpath(this.memoryRoot);
    const fileReal = await fs.realpath(absolutePath);
    const realCheck = path.relative(rootReal, fileReal);
    if (!realCheck || realCheck.startsWith("..") || path.isAbsolute(realCheck)) throw new Error("Memory target escaped through a link");
    const parts = normalized.split("/");
    return { absolutePath: fileReal, summary: toSummary(parts, stat) };
  }

  private async readConfig(): Promise<string> {
    try {
      const stat = await fs.lstat(this.configFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error("Grok config is not a regular file within the 2 MB limit");
      return await fs.readFile(this.configFile, "utf8");
    } catch (error) { if (isNodeError(error) && error.code === "ENOENT") return ""; throw error; }
  }
}

function toSummary(parts: string[], stat: { size: number; mtime: Date }): MemoryFileSummary {
  const relativePath = parts.join("/");
  const scope: MemoryScope = parts.length === 1 && parts[0].toLowerCase() === "memory.md" ? "global" : parts.some((part) => part.toLowerCase() === "sessions") ? "session" : "workspace";
  const ageDays = Math.max(0, Math.floor((Date.now() - stat.mtime.getTime()) / 86_400_000));
  return {
    id: Buffer.from(relativePath, "utf8").toString("base64url"),
    scope,
    workspaceKey: scope === "global" ? null : parts[0] ?? null,
    relativePath,
    displayPath: `~/.grok/memory/${relativePath}`,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    ageDays,
    staleness: scope !== "session" ? "curated" : ageDays < 14 ? "fresh" : ageDays < 60 ? "aging" : "stale",
  };
}

function parseMemoryEnabled(content: string): boolean | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inMemory = false;
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (section) { inMemory = section[1].trim() === "memory"; continue; }
    if (!inMemory) continue;
    const enabled = line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/i);
    if (enabled) return enabled[1].toLowerCase() === "true";
  }
  return null;
}

function patchMemoryEnabled(content: string, enabled: boolean): string {
  const lines = content ? content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const section = lines[index].match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (!section) continue;
    if (start >= 0) { end = index; break; }
    if (section[1].trim() === "memory") start = index;
  }
  if (start < 0) {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[memory]\nenabled = ${enabled}\n`;
  }
  const key = lines.slice(start + 1, end).findIndex((line) => /^\s*enabled\s*=/.test(line));
  if (key >= 0) lines[start + 1 + key] = `enabled = ${enabled}`;
  else lines.splice(end, 0, `enabled = ${enabled}`);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function parseEnvironmentOverride(value: string | undefined): "enabled" | "disabled" | null {
  if (value == null || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return "enabled";
  if (normalized === "0" || normalized === "false") return "disabled";
  return null;
}
function mutationAction(value: unknown): "set-enabled" | "delete-session" | "clear" { if (value === "set-enabled" || value === "delete-session" || value === "clear") return value; throw new Error("Unsupported memory action"); }
function clearScope(value: unknown): ClearScope { if (value === "global" || value === "workspace" || value === "all") return value; throw new Error("Memory clear scope must be global, workspace, or all"); }
function requiredText(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${label} is invalid`); return value.trim(); }
function safeOutput(value: string, grokHome: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(grokHome, "~/.grok")
    .replaceAll(grokHome.replace(/\\/g, "/"), "~/.grok")
    .trim()
    .slice(0, 2_000);
}
function scopeOrder(scope: MemoryScope): number { return scope === "global" ? 0 : scope === "workspace" ? 1 : 2; }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
