import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CustomModelInventory, CustomModelMutationPreview, CustomModelSummary } from "../../shared/contracts.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { parseModelsOutput } from "../account/AccountModelService.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

type Scope = "user" | "project";
type Action = "save" | "delete" | "set-default";
type Input = Record<string, unknown>;

const MANAGED_KEYS = new Set(["model", "base_url", "name", "description", "api_key", "env_key", "api_backend", "temperature", "top_p", "max_completion_tokens", "context_window"]);

export class CustomModelService {
  constructor(private readonly binary: string, private readonly workspace: WorkspaceSource, private readonly grokHome: string, private readonly processes?: OwnedProcessRegistry) {}

  async inventory(): Promise<CustomModelInventory> {
    const [user, project] = await Promise.all([this.readConfig("user"), this.readConfig("project")]);
    return {
      scannedAt: new Date().toISOString(),
      defaults: { user: parseDefault(user), project: parseDefault(project) },
      models: [...parseModels(user, "user"), ...parseModels(project, "project")],
    };
  }

  async preview(input: Input): Promise<CustomModelMutationPreview> {
    const action = modelAction(input.action);
    const scope = modelScope(input.scope);
    const name = modelName(input.name);
    const beforeText = await this.readConfig(scope);
    const afterText = mutateConfig(beforeText, input, action, name);
    const before = parseModels(beforeText, scope).find((model) => model.name === name) ?? null;
    const after = parseModels(afterText, scope).find((model) => model.name === name) ?? null;
    const changes = action === "set-default"
      ? [{ field: "models.default", before: parseDefault(beforeText) ?? "unset", after: name }]
      : modelChanges(before, after);
    if (action === "delete" && parseDefault(beforeText) !== parseDefault(afterText)) {
      changes.push({ field: "models.default", before: parseDefault(beforeText) ?? "unset", after: parseDefault(afterText) ?? "unset" });
    }
    return {
      token: `${action}:${scope}:${name}`,
      action,
      scope,
      name,
      relativeTarget: scope === "user" ? "~/.grok/config.toml" : ".grok/config.toml",
      changes,
      warnings: [
        "Unknown sections, fields, and comments outside managed keys are preserved.",
        ...(typeof input.apiKey === "string" && input.apiKey.trim() ? ["A write-only API key will be stored in Grok config; its value is never returned by preview or inventory."] : []),
      ],
    };
  }

  async apply(input: Input, confirmation: string): Promise<{ ok: true; action: Action; scope: Scope; name: string }> {
    const preview = await this.preview(input);
    if (confirmation !== preview.token) throw new Error(`Confirmation must exactly equal ${preview.token}`);
    const file = this.file(preview.scope);
    const before = await this.readConfig(preview.scope);
    const after = mutateConfig(before, input, preview.action, preview.name);
    await atomicWrite(file, after);
    return { ok: true, action: preview.action, scope: preview.scope, name: preview.name };
  }

  async diagnose(nameInput: unknown): Promise<{ found: boolean; defaultModel: string | null; exitCode: number | null; durationMs: number; error: string | null }> {
    const name = modelName(nameInput);
    const result = await new GrokRunner(this.binary, this.processes).run(["models"], { cwd: currentWorkspace(this.workspace), timeoutMs: 30_000, maxOutputBytes: 200_000, env: { GROK_HOME: this.grokHome } });
    const parsed = parseModelsOutput(`${result.stdout}\n${result.stderr}`);
    return {
      found: parsed.models.some((model) => model.id === name),
      defaultModel: parsed.defaultModel,
      exitCode: result.code,
      durationMs: result.durationMs,
      error: result.code === 0 ? null : safeDiagnostic(result.stderr || result.stdout),
    };
  }

  private file(scope: Scope): string {
    return scope === "user" ? path.join(this.grokHome, "config.toml") : path.join(currentWorkspace(this.workspace), ".grok", "config.toml");
  }

  private async readConfig(scope: Scope): Promise<string> {
    try {
      const file = this.file(scope);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2_000_000) throw new Error("Config file is not a regular file within the 2 MB limit");
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return "";
      throw error;
    }
  }
}

function parseModels(content: string, scope: Scope): CustomModelSummary[] {
  const lines = splitLines(content);
  const sections = sectionRanges(lines);
  return sections.flatMap((section) => {
    const match = section.name.match(/^model\.([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/);
    if (!match) return [];
    const values = new Map<string, string>();
    let apiKeyConfigured = false;
    let unknownFieldCount = 0;
    for (const line of lines.slice(section.start + 1, section.end)) {
      const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (!assignment) continue;
      if (assignment[1] === "api_key") apiKeyConfigured = true;
      if (!MANAGED_KEYS.has(assignment[1])) unknownFieldCount += 1;
      values.set(assignment[1], assignment[2]);
    }
    const backend = scalarString(values.get("api_backend"));
    return [{
      name: match[1],
      scope,
      modelId: scalarString(values.get("model")),
      displayName: scalarString(values.get("name")),
      description: scalarString(values.get("description")),
      baseUrl: safeBaseUrl(scalarString(values.get("base_url"))),
      envKey: scalarString(values.get("env_key")),
      apiBackend: backend === "responses" || backend === "messages" ? backend : "chat_completions",
      contextWindow: scalarInteger(values.get("context_window")),
      apiKeyConfigured,
      unknownFieldCount,
    }];
  });
}

function mutateConfig(content: string, input: Input, action: Action, name: string): string {
  if (action === "delete") {
    const removed = removeSection(content, `model.${name}`);
    return parseDefault(removed) === name ? upsertKeys(removed, "models", new Map([["default", null]])) : removed;
  }
  if (action === "set-default") return upsertKeys(content, "models", new Map([["default", JSON.stringify(name)]]));
  const modelId = requiredText(input.modelId, "modelId", 200);
  const baseUrl = optionalUrl(input.baseUrl);
  const envKey = optionalEnvKey(input.envKey);
  const backend = enumValue(input.apiBackend, ["chat_completions", "responses", "messages"], "chat_completions");
  const keys = new Map<string, string | null>([
    ["model", JSON.stringify(modelId)],
    ["name", optionalString(input.displayName, 200)],
    ["description", optionalString(input.description, 1_000)],
    ["base_url", baseUrl ? JSON.stringify(baseUrl) : null],
    ["env_key", envKey ? JSON.stringify(envKey) : null],
    ["api_backend", JSON.stringify(backend)],
    ["context_window", optionalInteger(input.contextWindow, 1_000, 10_000_000)],
    ["max_completion_tokens", optionalInteger(input.maxCompletionTokens, 1, 10_000_000)],
    ["temperature", optionalNumber(input.temperature, 0, 2)],
    ["top_p", optionalNumber(input.topP, 0, 1)],
  ]);
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    if (input.apiKey.length > 10_000 || /[\r\n\0]/.test(input.apiKey)) throw new Error("API key is invalid");
    keys.set("api_key", JSON.stringify(input.apiKey));
  } else if (input.clearApiKey === true) keys.set("api_key", null);
  return upsertKeys(content, `model.${name}`, keys);
}

function modelChanges(before: CustomModelSummary | null, after: CustomModelSummary | null): CustomModelMutationPreview["changes"] {
  const fields: Array<[string, string, string]> = [
    ["exists", String(Boolean(before)), String(Boolean(after))],
    ["model", before?.modelId ?? "unset", after?.modelId ?? "unset"],
    ["displayName", before?.displayName ?? "unset", after?.displayName ?? "unset"],
    ["baseUrl", before?.baseUrl ?? "unset", after?.baseUrl ?? "unset"],
    ["envKey", before?.envKey ?? "unset", after?.envKey ?? "unset"],
    ["apiBackend", before?.apiBackend ?? "unset", after?.apiBackend ?? "unset"],
    ["contextWindow", before?.contextWindow?.toString() ?? "unset", after?.contextWindow?.toString() ?? "unset"],
    ["apiKey", before?.apiKeyConfigured ? "configured" : "unset", after?.apiKeyConfigured ? "configured" : "unset"],
  ];
  return fields.filter(([, oldValue, newValue]) => oldValue !== newValue).map(([field, oldValue, newValue]) => ({ field, before: oldValue, after: newValue }));
}

function upsertKeys(content: string, sectionName: string, keys: Map<string, string | null>): string {
  const lines = splitLines(content);
  const section = sectionRanges(lines).find((item) => item.name === sectionName);
  if (!section) {
    const additions = [...keys].filter(([, value]) => value != null).map(([key, value]) => `${key} = ${value}`);
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${sectionName}]\n${additions.join("\n")}\n`;
  }
  const block = lines.slice(section.start + 1, section.end);
  for (const [key, value] of keys) {
    const found = block.findIndex((line) => new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line));
    if (found >= 0) {
      if (value == null) block.splice(found, 1);
      else block[found] = `${key} = ${value}`;
    } else if (value != null) block.push(`${key} = ${value}`);
  }
  const output = [...lines.slice(0, section.start + 1), ...block, ...lines.slice(section.end)];
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function removeSection(content: string, sectionName: string): string {
  const lines = splitLines(content);
  const section = sectionRanges(lines).find((item) => item.name === sectionName);
  if (!section) return content;
  let end = section.end;
  while (end < lines.length && !lines[end].trim()) end += 1;
  lines.splice(section.start, end - section.start);
  return lines.length ? `${lines.join("\n").replace(/^\n+|\n+$/g, "")}\n` : "";
}

function parseDefault(content: string): string | null {
  const lines = splitLines(content);
  const section = sectionRanges(lines).find((item) => item.name === "models");
  if (!section) return null;
  for (const line of lines.slice(section.start + 1, section.end)) {
    const match = line.match(/^\s*default\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (match) return scalarString(match[1]);
  }
  return null;
}

function sectionRanges(lines: string[]): Array<{ name: string; start: number; end: number }> {
  const starts: Array<{ name: string; start: number }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (match) starts.push({ name: match[1].trim(), start: index });
  });
  return starts.map((item, index) => ({ ...item, end: starts[index + 1]?.start ?? lines.length }));
}

function splitLines(content: string): string[] { return content ? content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : []; }
function scalarString(value: string | undefined): string | null { if (!value) return null; try { const parsed = JSON.parse(value); return typeof parsed === "string" ? parsed : null; } catch { const match = value.match(/^'(.*)'$/); return match?.[1] ?? null; } }
function scalarInteger(value: string | undefined): number | null { if (!value || !/^\d+$/.test(value.trim())) return null; const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : null; }
function modelScope(value: unknown): Scope { if (value === "user" || value === "project") return value; throw new Error("scope must be user or project"); }
function modelAction(value: unknown): Action { if (value === "save" || value === "delete" || value === "set-default") return value; throw new Error("Unsupported model action"); }
function modelName(value: unknown): string { if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) throw new Error("Model name must be lowercase kebab-case, 1-64 characters"); return value; }
function requiredText(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${label} is required and invalid`); return value.trim(); }
function optionalString(value: unknown, max: number): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("String field is invalid"); return JSON.stringify(value.trim()); }
function optionalUrl(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || value.length > 2_000) throw new Error("baseUrl is invalid"); const url = new URL(value); if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("baseUrl must be http(s) without credentials, query, or fragment"); return url.toString().replace(/\/$/, ""); }
function safeBaseUrl(value: string | null): string | null { if (!value) return null; try { const url = new URL(value); if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null; return `${url.origin}${url.pathname}`.replace(/\/$/, ""); } catch { return null; } }
function optionalEnvKey(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(value)) throw new Error("envKey must be an uppercase environment variable name"); return value; }
function enumValue(value: unknown, options: string[], fallback: string): string { return typeof value === "string" && options.includes(value) ? value : fallback; }
function optionalInteger(value: unknown, min: number, max: number): string | null { if (value == null || value === "") return null; if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("Integer field is out of range"); return String(value); }
function optionalNumber(value: unknown, min: number, max: number): string | null { if (value == null || value === "") return null; if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Numeric field is out of range"); return String(value); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function safeDiagnostic(value: string): string { return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/(?:xai|sk)-[A-Za-z0-9._-]{8,}/gi, "[redacted]").trim().slice(0, 1_000); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
