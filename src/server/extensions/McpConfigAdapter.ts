import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ExtensionInventorySnapshot,
  ExtensionMutationPreview,
  McpConfigDetail,
  McpDoctorSnapshot,
} from "../../shared/contracts.js";
import {
  atomicReplace,
  type ExtensionRuntime,
  isNodeError,
  isRecord,
  nonNegative,
  records,
  safeOptional,
  safeText,
  sourceLabel,
  sourceType,
} from "./ExtensionRuntime.js";

interface NativeMcpRecord {
  name: string;
  scope: "user" | "project";
  transport: "stdio" | "http" | "sse";
  target: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  enabled: boolean;
}

type McpMutation =
  | { action: "remove"; name: string; scope: NativeMcpRecord["scope"]; current?: NativeMcpRecord }
  | { action: "add"; name: string; scope: NativeMcpRecord["scope"]; current?: NativeMcpRecord; transport: NativeMcpRecord["transport"]; target: string; args: string[]; env: Record<string, string>; headers: Record<string, string>; enabled: boolean };

const WRITE_ONLY = "__GROK_BUILD_WRITE_ONLY__";

export class McpConfigAdapter {
  constructor(private readonly runtime: ExtensionRuntime) {}

  async inventory(inspect: Record<string, unknown>): Promise<ExtensionInventorySnapshot["mcpServers"]> {
    const value = await this.runtime.json(["mcp", "list", "--json"], 30_000, 5_000_000);
    return mcpInventory(value, inspect);
  }

  async doctor(name?: string): Promise<McpDoctorSnapshot> {
    const args = ["mcp", "doctor", "--json", ...(name ? [validateDiagnosticName(name)] : [])];
    const value = await this.runtime.json(args, 60_000, 10_000_000, true);
    if (!isRecord(value)) throw new Error("MCP doctor returned a non-object payload");
    return {
      scannedAt: new Date().toISOString(),
      healthyCount: nonNegative(value.healthy_count),
      failingCount: nonNegative(value.failing_count),
      sources: records(value.sources).slice(0, 200).map((item) => {
        const status = isRecord(item.status) ? item.status : {};
        return {
          label: sourceLabel(item.path),
          status: safeText(status.status, "unknown", 60),
          serverCount: nonNegative(status.server_count),
        };
      }),
      servers: records(value.servers).slice(0, 200).map((item) => ({
        name: safeText(item.name, "unnamed", 100),
        transport: safeText(item.transport, "unknown", 30),
        sourceType: sourceLabel(item.source),
        healthy: item.healthy === true,
        checks: records(item.checks).slice(0, 50).map((check) => ({
          label: safeText(check.label, "check", 160),
          passed: check.passed === true,
          detail: safeDoctorDetail(check.detail),
          hint: safeOptional(check.hint, 200),
        })),
      })),
    };
  }

  async detail(nameInput: unknown, scopeInput: unknown): Promise<McpConfigDetail> {
    const name = validateMcpName(nameInput);
    const scope = mcpScope(scopeInput);
    const item = (await this.nativeRecords()).find((entry) => entry.name === name && entry.scope === scope);
    if (!item) throw new Error("Native MCP server was not found in the selected scope");
    return {
      id: mcpId(item.scope, item.name),
      name: item.name,
      scope: item.scope,
      sourceType: "grok-config",
      editable: true,
      transport: item.transport,
      target: safeEditableMcpTarget(item.target),
      targetConfigured: Boolean(item.target),
      args: redactMcpArgs(item.args),
      enabled: item.enabled,
      environmentKeys: Object.keys(item.env).sort(),
      headerNames: Object.keys(item.headers).sort(),
    };
  }

  async preview(input: unknown): Promise<ExtensionMutationPreview> {
    return mcpPreview(await this.prepare(input));
  }

  async apply(input: unknown, confirmation: unknown): Promise<{ ok: true; action: string; target: string }> {
    const mutation = await this.prepare(input);
    const preview = mcpPreview(mutation);
    if (confirmation !== preview.token) throw new Error("Exact MCP server name confirmation is required");
    await assertSafeConfig(this.configFile(mutation.scope), this.configBase(mutation.scope));
    if (mutation.action === "remove") {
      const result = await this.runtime.run(["mcp", "remove", "--scope", mutation.scope, mutation.name], 60_000, 2_000_000);
      if (result.code !== 0) throw new Error("MCP remove failed");
      return { ok: true, action: mutation.action, target: mutation.name };
    }
    const args = ["mcp", "add", "--scope", mutation.scope, "--transport", mutation.transport];
    for (const [key, value] of Object.entries(mutation.env)) args.push("--env", `${key}=${value}`);
    for (const [key, value] of Object.entries(mutation.headers)) args.push("--header", `${key}: ${value}`);
    args.push(mutation.name);
    if (mutation.transport === "stdio") args.push("--", mutation.target, ...mutation.args);
    else args.push(mutation.target);
    const result = await this.runtime.run(args, 60_000, 2_000_000);
    if (result.code !== 0) throw new Error("MCP add failed");
    if (!mutation.enabled) await this.patchEnabled(mutation.scope, mutation.name, false);
    return { ok: true, action: mutation.action, target: mutation.name };
  }

  private async prepare(input: unknown): Promise<McpMutation> {
    if (!isRecord(input)) throw new Error("MCP mutation is invalid");
    const action = input.action === "remove" ? "remove" : input.action === "add" ? "add" : null;
    if (!action) throw new Error("MCP action must be add or remove");
    const name = validateMcpName(input.name);
    const scope = mcpScope(input.scope);
    const current = (await this.nativeRecords()).find((entry) => entry.name === name && entry.scope === scope);
    if (action === "remove") return { action, name, scope, current };
    const transport = mcpTransport(input.transport, current?.transport);
    const target = typeof input.target === "string" && input.target.trim() ? validateMcpTarget(input.target, transport) : current?.target;
    if (!target) throw new Error("MCP target is required for a new server");
    return {
      action, name, scope, current, transport, target,
      env: mergeSecretRecord(current?.env ?? {}, stringRecord(input.env), keyArray(input.removeEnvironmentKeys)),
      headers: mergeSecretRecord(current?.headers ?? {}, stringRecord(input.headers), keyArray(input.removeHeaderNames)),
      args: input.args === undefined ? current?.args ?? [] : mergeMcpArgs(stringArray(input.args), current?.args ?? []),
      enabled: mcpEnabled(input.enabled, current?.enabled ?? true),
    };
  }

  private async nativeRecords(): Promise<NativeMcpRecord[]> {
    return nativeMcpRecords(await this.runtime.json(["mcp", "list", "--json"], 30_000, 5_000_000));
  }

  private configFile(scope: "user" | "project"): string {
    return scope === "user" ? path.join(this.runtime.grokHome, "config.toml") : path.join(this.runtime.workspace(), ".grok", "config.toml");
  }

  private configBase(scope: "user" | "project"): string { return scope === "user" ? this.runtime.grokHome : this.runtime.workspace(); }

  private async patchEnabled(scope: "user" | "project", name: string, enabled: boolean): Promise<void> {
    const file = this.configFile(scope);
    const content = await fs.readFile(file, "utf8");
    await atomicConfigWrite(file, patchMcpEnabled(content, name, enabled), this.configBase(scope));
  }
}

function mcpPreview(mutation: McpMutation): ExtensionMutationPreview {
  if (mutation.action === "remove") return {
    token: mutation.name, domain: "mcp", action: mutation.action, target: mutation.name,
    changes: [{ field: `${mutation.scope}.configured`, before: "true", after: "false" }],
    warnings: ["Removing a server can disable plugin or project workflows."],
  };
  const { current } = mutation;
  return {
    token: mutation.name,
    domain: "mcp",
    action: mutation.action,
    target: mutation.name,
    changes: [
      { field: "scope", before: current?.scope ?? "unconfigured", after: mutation.scope },
      { field: "transport", before: current?.transport ?? "unconfigured", after: mutation.transport },
      { field: "target type", before: current ? "configured" : "none", after: mutation.transport === "stdio" ? "local command" : "remote URL" },
      { field: "arguments", before: String(current?.args.length ?? 0), after: String(mutation.transport === "stdio" ? mutation.args.length : 0) },
      { field: "enabled", before: String(current?.enabled ?? false), after: String(mutation.enabled) },
      { field: "environment keys", before: String(Object.keys(current?.env ?? {}).length), after: String(Object.keys(mutation.env).length) },
      { field: "header names", before: String(Object.keys(current?.headers ?? {}).length), after: String(Object.keys(mutation.headers).length) },
    ],
    warnings: Object.keys(mutation.headers).length || Object.keys(mutation.env).length
      ? ["Environment and header values are write-only: they are preserved server-side and never returned by the API."]
      : [],
  };
}

function mcpInventory(value: unknown, inspect: Record<string, unknown>): ExtensionInventorySnapshot["mcpServers"] {
  const native: ExtensionInventorySnapshot["mcpServers"] = nativeMcpRecords(value).map((item) => ({
    id: mcpId(item.scope, item.name), name: item.name, transport: item.transport, sourceType: "grok-config",
    scope: item.scope, enabled: item.enabled, editable: true,
    environmentKeys: Object.keys(item.env).sort(), headerNames: Object.keys(item.headers).sort(),
  }));
  const names = new Set(native.map((item) => item.name));
  for (const [index, item] of records(inspect.mcpServers).entries()) {
    const name = safeText(item.name, "unnamed", 100);
    if (names.has(name)) continue;
    const source = sourceType(item.source);
    native.push({
      id: mcpId("readonly", `${name}:${index}`), name, transport: safeText(item.transport, "unknown", 30), sourceType: source,
      scope: source.includes("plugin") ? "plugin" : source.includes("claude") || source.includes("cursor") ? "compat" : "unknown",
      enabled: true, editable: false, environmentKeys: [], headerNames: [],
    });
  }
  return native;
}

function nativeMcpRecords(value: unknown): NativeMcpRecord[] {
  const output: NativeMcpRecord[] = [];
  for (const item of records(value).slice(0, 500)) {
    if (item.scope !== "user" && item.scope !== "project") continue;
    let name: string;
    try { name = validateMcpName(item.name); } catch { continue; }
    const command = typeof item.command === "string" ? item.command.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const transport = url ? item.type === "sse" ? "sse" : "http" : "stdio";
    const target = url || command;
    if (!target) continue;
    output.push({
      name, scope: item.scope, transport, target, args: safeStringArray(item.args), env: safeStoredRecord(item.env),
      headers: safeStoredRecord(item.headers), enabled: item.enabled !== false,
    });
  }
  return output;
}

function mcpId(scope: string, name: string): string {
  return crypto.createHash("sha256").update(`mcp\0${scope}\0${name}`).digest("base64url").slice(0, 24);
}

function mcpScope(value: unknown): "user" | "project" {
  if (value === "user" || value === "project") return value;
  throw new Error("MCP scope must be user or project");
}

function mcpTransport(value: unknown, fallback?: NativeMcpRecord["transport"]): NativeMcpRecord["transport"] {
  if (value === "stdio" || value === "http" || value === "sse") return value;
  if (value == null || value === "") return fallback ?? "stdio";
  throw new Error("MCP transport must be stdio, http, or sse");
}

function mcpEnabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  throw new Error("MCP enabled state must be boolean");
}

function validateMcpName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("MCP name may contain only letters, numbers, hyphens, and underscores");
  return value;
}

function validateDiagnosticName(value: string): string {
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(value)) throw new Error("Invalid extension name");
  return value;
}

function safeEditableMcpTarget(value: string): string | null {
  if (secretBearing(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || [...url.searchParams.keys()].some(secretKey)) return null;
  } catch { /* stdio command */ }
  return value;
}

function redactMcpArgs(args: string[]): string[] {
  return args.map((item, index) => secretBearing(item) || (index > 0 && /^--?(?:token|secret|password|api[_-]?key|authorization|cookie)$/i.test(args[index - 1])) ? WRITE_ONLY : item);
}

function mergeMcpArgs(next: string[], current: string[]): string[] {
  return next.map((item, index) => item === WRITE_ONLY ? current[index] ?? "" : item).filter((item) => item !== "");
}

function mergeSecretRecord(current: Record<string, string>, updates: Record<string, string>, removals: string[]): Record<string, string> {
  const output = { ...current, ...updates };
  for (const key of removals) delete output[key];
  return output;
}

function keyArray(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error("MCP removal keys are invalid");
  return value.map((item) => {
    if (typeof item !== "string" || !/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(item)) throw new Error("MCP removal key is invalid");
    return item;
  });
}

function safeStoredRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 50));
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 100) : [];
}

function secretKey(value: string): boolean { return /(?:secret|token|password|passphrase|api[_-]?key|authorization|cookie|credential)/i.test(value); }
function secretBearing(value: string): boolean { return /(?:secret|token|password|passphrase|api[_-]?key|authorization|cookie|credential)\s*[=:]\s*\S+/i.test(value) || /(?:xai|sk)-[A-Za-z0-9._-]{8,}/i.test(value); }

function patchMcpEnabled(content: string, name: string, enabled: boolean): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const section = `mcp_servers.${name}`;
  let start = -1; let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (!match) continue;
    if (start >= 0) { end = index; break; }
    if (match[1].trim() === section) start = index;
  }
  if (start < 0) throw new Error("Official MCP CLI did not create the expected config section");
  const relative = lines.slice(start + 1, end).findIndex((line) => /^\s*enabled\s*=/.test(line));
  if (relative < 0) lines.splice(end, 0, `enabled = ${String(enabled)}`);
  else lines[start + 1 + relative] = `enabled = ${String(enabled)}`;
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

async function assertSafeConfig(file: string, base: string): Promise<void> {
  if (!isWithin(base, file)) throw new Error("MCP config escaped its configured scope");
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2_000_000) throw new Error("MCP config must be a regular file within the size limit");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    let cursor = path.dirname(file);
    while (isWithin(base, cursor) && cursor !== path.resolve(base)) {
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("MCP config parent must be a real directory");
        break;
      } catch (parentError) {
        if (!isNodeError(parentError) || parentError.code !== "ENOENT") throw parentError;
        cursor = path.dirname(cursor);
      }
    }
  }
}

async function atomicConfigWrite(file: string, content: string, base: string): Promise<void> {
  await assertSafeConfig(file, base);
  await atomicReplace(file, content);
}

function isWithin(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateMcpTarget(value: unknown, transport: NativeMcpRecord["transport"]): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000 || /[\r\n\0]/.test(value)) throw new Error("Invalid MCP target");
  const target = value.trim();
  if (transport !== "stdio") {
    let url: URL;
    try { url = new URL(target); } catch { throw new Error("Remote MCP target must be an HTTP(S) URL"); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Remote MCP target must use HTTP(S) without embedded credentials");
  }
  return target;
}

function stringRecord(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Environment and header updates must be key-value objects");
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) || typeof item !== "string" || item.length > 10_000 || /[\r\n\0]/.test(item)) throw new Error("Invalid environment or header entry");
    output[key] = item;
  }
  return output;
}

function stringArray(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("MCP command arguments must be an array within the size limit");
  return value.map((item) => {
    if (typeof item !== "string" || item.length > 1_000 || /[\r\n\0]/.test(item)) throw new Error("Invalid MCP command argument");
    return item;
  });
}

function safeDoctorDetail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/oauth authorization required/i.test(value)) return "OAuth authorization required";
  if (/^\d+(?:\.\d+)?s$/.test(value.trim())) return value.trim();
  if (/^protocol [\w.-]+$/i.test(value.trim())) return value.trim().slice(0, 100);
  if (/^\d+ tools? discovered$/i.test(value.trim())) return value.trim().slice(0, 100);
  return "Diagnostic detail hidden";
}
