import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";

export interface ExtensionRunner {
  run(args: string[], options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number; env?: NodeJS.ProcessEnv }): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>;
}

export class ExtensionRuntime {
  constructor(private readonly runner: ExtensionRunner, private readonly cwd: WorkspaceSource, readonly grokHome: string) {}

  workspace(): string { return currentWorkspace(this.cwd); }

  async json(args: string[], timeoutMs: number, maxOutputBytes: number, allowNonZero = false): Promise<unknown> {
    const result = await this.run(args, timeoutMs, maxOutputBytes);
    if ((!allowNonZero && result.code !== 0) || result.truncated) throw new Error(`${args.slice(0, 2).join(" ")} failed`);
    try { return JSON.parse(result.stdout) as unknown; }
    catch { throw new Error(`${args.slice(0, 2).join(" ")} returned invalid JSON`); }
  }

  run(args: string[], timeoutMs: number, maxOutputBytes: number) {
    return this.runner.run(args, {
      cwd: this.workspace(), timeoutMs, maxOutputBytes,
      env: { GROK_HOME: this.grokHome, HOME: process.env.HOME || os.homedir() },
    });
  }
}

export async function atomicReplace(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

export function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
export function safeText(value: unknown, fallback: string, max: number): string { return typeof value === "string" && value.trim() ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : fallback; }
export function safeOptional(value: unknown, max: number): string | null { return typeof value === "string" && value.trim() ? safeText(value, "", max) : null; }
export function nonNegative(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
export function sourceType(value: unknown): string { return isRecord(value) ? safeText(value.type, "unknown", 60) : typeof value === "string" ? sourceLabel(value) : "unknown"; }
export function sourceLabel(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const lower = value.toLowerCase().replace(/\\/g, "/");
  if (lower.startsWith("plugin:")) return safeText(value, "plugin", 100);
  if (lower.includes(".claude")) return "claude-compat";
  if (lower.includes(".grok") || lower.includes("config.toml")) return "grok-config";
  if (lower.includes("grok.com")) return "grok-cloud";
  return "other";
}
export function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && "code" in value; }
