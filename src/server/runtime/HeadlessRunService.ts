import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import readline from "node:readline";
import type { HeadlessRunSnapshot } from "../../shared/contracts.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "./OwnedProcessRegistry.js";

type Input = Record<string, unknown>;
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_EVENTS = 1_000;
const MAX_OUTPUT_CHARS = 300_000;

export class HeadlessRunService {
  private active: { snapshot: HeadlessRunSnapshot; process: ChildProcessWithoutNullStreams } | null = null;
  private latest: HeadlessRunSnapshot | null = null;
  constructor(
    private readonly binary: string,
    private readonly workspace: WorkspaceSource,
    private readonly grokHome: string,
    private readonly processes?: OwnedProcessRegistry,
  ) {}

  get(): HeadlessRunSnapshot | null { return this.active ? clone(this.active.snapshot) : this.latest ? clone(this.latest) : null; }

  start(input: Input): HeadlessRunSnapshot {
    if (this.active) throw new Error("A headless run is already active");
    const prompt = text(input.prompt, "prompt", 100_000);
    const model = optionalToken(input.model, "model", 200);
    const maxTurns = optionalInteger(input.maxTurns, 1, 100);
    const permissionMode = headlessPermissionMode(input.permissionMode);
    if (permissionMode === "bypassPermissions" && input.acknowledgeBypass !== true) throw new Error("bypassPermissions requires explicit acknowledgement");
    const tools = optionalToolList(input.tools);
    const disallowedTools = optionalToolList(input.disallowedTools);
    const effort = typeof input.reasoningEffort === "string" && EFFORTS.has(input.reasoningEffort) ? input.reasoningEffort : null;
    const jsonSchema = optionalJsonSchema(input.jsonSchema);
    const check = input.check === true;
    const bestOfN = optionalInteger(input.bestOfN, 1, 10);
    const resume = optionalUuid(input.resumeSessionId);
    const useContinue = input.continueRecent === true;
    if (resume && useContinue) throw new Error("resumeSessionId and continueRecent are mutually exclusive");
    const fork = input.fork === true;
    if (fork && !resume && !useContinue) throw new Error("fork requires resumeSessionId or continueRecent");
    const args = ["--single", prompt, "--verbatim", "--output-format", jsonSchema ? "json" : "streaming-json", "--no-auto-update"];
    if (model) args.push("--model", model);
    if (maxTurns != null) args.push("--max-turns", String(maxTurns));
    if (tools) args.push("--tools", tools);
    if (disallowedTools) args.push("--disallowed-tools", disallowedTools);
    if (effort) args.push("--reasoning-effort", effort);
    if (permissionMode !== "default") args.push("--permission-mode", permissionMode);
    if (jsonSchema) args.push("--json-schema", jsonSchema);
    if (check) args.push("--check");
    if (bestOfN != null) args.push("--best-of-n", String(bestOfN));
    if (input.noSubagents === true) args.push("--no-subagents");
    if (input.disableWebSearch === true) args.push("--disable-web-search");
    if (resume) args.push("--resume", resume);
    else if (useContinue) args.push("--continue");
    if (fork) args.push("--fork-session");
    const id = crypto.randomUUID();
    const isolatedProcessGroup = process.platform !== "win32";
    const child = spawn(this.binary, args, { cwd: currentWorkspace(this.workspace), env: { ...process.env, GROK_HOME: this.grokHome }, detached: isolatedProcessGroup, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    if (this.processes) {
      try {
        this.processes.register({ ownerKind: "run", ownerId: id, child, isolatedProcessGroup });
      } catch (error) {
        child.once("error", () => undefined);
        signalChild(child, "SIGKILL", isolatedProcessGroup);
        throw error;
      }
    }
    const snapshot: HeadlessRunSnapshot = { id, status: "running", startedAt: new Date().toISOString(), completedAt: null, exitCode: null, promptChars: prompt.length, model, sessionId: null, stopReason: null, events: [], outputChars: 0, truncated: false, options: { maxTurns, permissionMode, toolsRestricted: Boolean(tools || disallowedTools), resume: Boolean(resume || useContinue), fork, structuredOutput: Boolean(jsonSchema), check, bestOfN } };
    this.active = { snapshot, process: child }; this.latest = snapshot;
    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    stdout.on("line", (line) => this.consume(snapshot, line));
    stderr.on("line", (line) => this.append(snapshot, "unknown", `[stderr] ${sanitize(line)}`));
    child.once("error", (error) => { this.append(snapshot, "error", sanitize(error.message)); this.finish(snapshot, "failed", null); });
    child.once("exit", (code) => { stdout.close(); stderr.close(); if (snapshot.status === "cancelled") return; this.finish(snapshot, code === 0 ? "completed" : "failed", code); });
    return clone(snapshot);
  }

  cancel(id: unknown): HeadlessRunSnapshot { if (typeof id !== "string" || !this.active || this.active.snapshot.id !== id) throw new Error("Headless run is not active"); const { snapshot, process: child } = this.active; this.finish(snapshot, "cancelled", null); this.stopProcess(snapshot.id, child); return clone(snapshot); }
  stop(): void { if (this.active) { const { snapshot, process: child } = this.active; this.finish(snapshot, "cancelled", null); this.stopProcess(snapshot.id, child); } }

  private consume(snapshot: HeadlessRunSnapshot, line: string): void {
    try {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) throw new Error("not object");
      if (typeof value.type !== "string" && typeof value.text === "string") {
        if (typeof value.sessionId === "string") snapshot.sessionId = safeId(value.sessionId);
        if (typeof value.stopReason === "string") snapshot.stopReason = sanitize(value.stopReason).slice(0, 100);
        this.append(snapshot, "text", sanitize(value.text));
        this.append(snapshot, "end", `stopReason=${snapshot.stopReason ?? "unknown"}`);
        return;
      }
      const rawType = typeof value.type === "string" ? value.type : "unknown";
      const type = rawType === "text" || rawType === "thought" || rawType === "end" || rawType === "error" ? rawType : "unknown";
      const data = typeof value.data === "string" ? value.data : typeof value.message === "string" ? value.message : type === "end" ? `stopReason=${String(value.stopReason ?? "unknown")}` : rawType;
      if (typeof value.sessionId === "string") snapshot.sessionId = safeId(value.sessionId);
      if (typeof value.stopReason === "string") snapshot.stopReason = sanitize(value.stopReason).slice(0, 100);
      this.append(snapshot, type, sanitize(data));
    } catch { this.append(snapshot, "unknown", sanitize(line)); }
  }
  private append(snapshot: HeadlessRunSnapshot, type: HeadlessRunSnapshot["events"][number]["type"], data: string): void { if (!data) return; if (snapshot.events.length >= MAX_EVENTS || snapshot.outputChars + data.length > MAX_OUTPUT_CHARS) { snapshot.truncated = true; return; } snapshot.events.push({ type, data, receivedAt: new Date().toISOString() }); snapshot.outputChars += data.length; }
  private finish(snapshot: HeadlessRunSnapshot, status: HeadlessRunSnapshot["status"], exitCode: number | null): void { snapshot.status = status; snapshot.exitCode = exitCode; snapshot.completedAt = new Date().toISOString(); this.latest = snapshot; if (this.active?.snapshot.id === snapshot.id) this.active = null; }
  private stopProcess(id: string, child: ChildProcessWithoutNullStreams): void { if (this.processes) void this.processes.stopOwner("run", id).catch(() => { signalChild(child, "SIGKILL", process.platform !== "win32"); }); else signalChild(child, "SIGTERM", process.platform !== "win32"); }
}

function signalChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals, group: boolean): void { try { if (group && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* The process may already have exited. */ } }

function optionalToolList(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || value.length > 2_000) throw new Error("Tool list is invalid"); const parts = value.split(",").map((item) => item.trim()); if (!parts.length || parts.some((item) => !/^(?:[A-Za-z_][A-Za-z0-9_.:-]*|Agent(?:\([A-Za-z0-9_, -]+\))?)$/.test(item))) throw new Error("Tool list contains an invalid tool id"); return parts.join(","); }
function headlessPermissionMode(value: unknown): "default" | "bypassPermissions" { if (value == null || value === "") return "default"; if (value === "default" || value === "bypassPermissions") return value; throw new Error("permissionMode must be default or bypassPermissions"); }
function optionalToken(value: unknown, label: string, max: number): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${label} is invalid`); return value; }
function optionalInteger(value: unknown, min: number, max: number): number | null { if (value == null || value === "") return null; if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("Integer option is out of range"); return value; }
function optionalJsonSchema(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || value.length > 50_000) throw new Error("jsonSchema is invalid"); try { const parsed = JSON.parse(value) as unknown; if (!isRecord(parsed)) throw new Error(); return JSON.stringify(parsed); } catch { throw new Error("jsonSchema must be a JSON object"); } }
function optionalUuid(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("resumeSessionId must be a UUID"); return value.toLowerCase(); }
function text(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`${label} is invalid`); return value; }
function sanitize(value: string): string { return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\b(?:xai|sk)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted-token]").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 20_000); }
function safeId(value: string): string | null { return /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clone(value: HeadlessRunSnapshot): HeadlessRunSnapshot { return { ...value, options: { ...value.options }, events: value.events.map((event) => ({ ...event })) }; }
