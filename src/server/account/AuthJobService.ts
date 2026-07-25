import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthJobSnapshot, AuthLogoutPreview } from "../../shared/contracts.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export class AuthJobService {
  private active: { snapshot: AuthJobSnapshot; process: ChildProcessWithoutNullStreams } | null = null;
  private latest: AuthJobSnapshot | null = null;

  constructor(
    private readonly binary: string,
    private readonly workspace: WorkspaceSource,
    private readonly grokHome: string,
    private readonly processes?: OwnedProcessRegistry,
  ) {}

  get(): AuthJobSnapshot | null {
    const snapshot = this.active?.snapshot ?? this.latest;
    return snapshot ? clone(snapshot) : null;
  }

  start(action: "login-oauth" | "login-device"): AuthJobSnapshot {
    if (this.active?.snapshot.status === "running") throw new Error("An authentication job is already running");
    const args = ["login", action === "login-device" ? "--device-auth" : "--oauth"];
    const id = crypto.randomUUID();
    const isolatedProcessGroup = process.platform !== "win32";
    const child = spawn(this.binary, args, {
      cwd: currentWorkspace(this.workspace),
      env: { ...process.env, GROK_HOME: this.grokHome },
      detached: isolatedProcessGroup,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (this.processes) {
      try {
        this.processes.register({ ownerKind: "application", ownerId: `auth:${id}`, child, isolatedProcessGroup });
      } catch (error) {
        child.once("error", () => undefined);
        signalChild(child, "SIGKILL", isolatedProcessGroup);
        throw error;
      }
    }
    const snapshot: AuthJobSnapshot = {
      id,
      action,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      output: [],
      truncated: false,
    };
    this.active = { snapshot, process: child };
    this.latest = snapshot;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const consume = (kind: "stdout" | "stderr", chunk: Buffer) => {
      const combined = (kind === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
      const lines = combined.split(/\r?\n/);
      if (kind === "stdout") stdoutBuffer = lines.pop() ?? "";
      else stderrBuffer = lines.pop() ?? "";
      for (const line of lines) this.append(snapshot, line);
    };
    child.stdout.on("data", (chunk: Buffer) => consume("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => consume("stderr", chunk));
    child.once("error", (error) => {
      this.append(snapshot, error.message);
      this.finish(snapshot, "failed", null);
    });
    child.once("exit", (code) => {
      if (stdoutBuffer) this.append(snapshot, stdoutBuffer);
      if (stderrBuffer) this.append(snapshot, stderrBuffer);
      if (snapshot.status === "cancelled") return;
      this.finish(snapshot, code === 0 ? "completed" : "failed", code);
    });
    return clone(snapshot);
  }

  cancel(id: string): AuthJobSnapshot {
    const active = this.active;
    if (!active || active.snapshot.id !== id || active.snapshot.status !== "running") throw new Error("Authentication job is not running");
    this.finish(active.snapshot, "cancelled", null);
    this.stopProcess(active.snapshot.id, active.process);
    return clone(active.snapshot);
  }

  async logoutPreview(authenticated: boolean, credentialEntries: number): Promise<AuthLogoutPreview> {
    return {
      token: "logout",
      authenticated,
      credentialEntries,
      warning: "This calls official `grok logout` and clears cached credentials. It does not remove environment API keys.",
    };
  }

  async logout(confirmation: string): Promise<{ ok: true; output: string }> {
    if (confirmation !== "logout") throw new Error("Logout confirmation must exactly equal logout");
    if (this.active?.snapshot.status === "running") throw new Error("Cancel the active authentication job before logout");
    const result = await new GrokRunner(this.binary, this.processes).run(["logout"], {
      cwd: currentWorkspace(this.workspace),
      timeoutMs: 30_000,
      maxOutputBytes: 100_000,
      env: { GROK_HOME: this.grokHome },
    });
    if (result.code !== 0) throw new Error(sanitizeAuthOutput(result.stderr || result.stdout || "grok logout failed"));
    return { ok: true, output: sanitizeAuthOutput(result.stdout || result.stderr).slice(0, 1_000) };
  }

  async credentialEntries(): Promise<number> {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.grokHome, "auth.json"), "utf8")) as unknown;
      return isRecord(parsed) ? Object.keys(parsed).length : 0;
    } catch { return 0; }
  }

  stop(): void {
    if (this.active?.snapshot.status === "running") {
      const { snapshot, process: child } = this.active;
      this.finish(snapshot, "cancelled", null);
      this.stopProcess(snapshot.id, child);
    }
  }

  private append(snapshot: AuthJobSnapshot, raw: string): void {
    const line = sanitizeAuthOutput(raw);
    if (!line) return;
    if (snapshot.output.length >= 200 || snapshot.output.join("\n").length + line.length > 20_000) {
      snapshot.truncated = true;
      return;
    }
    snapshot.output.push(line);
  }

  private finish(snapshot: AuthJobSnapshot, status: AuthJobSnapshot["status"], exitCode: number | null): void {
    snapshot.status = status;
    snapshot.exitCode = exitCode;
    snapshot.completedAt = new Date().toISOString();
    this.latest = snapshot;
    if (this.active?.snapshot.id === snapshot.id && status !== "running") this.active = null;
  }

  private stopProcess(id: string, child: ChildProcessWithoutNullStreams): void {
    if (this.processes) void this.processes.stopOwner("application", `auth:${id}`).catch(() => { signalChild(child, "SIGKILL", process.platform !== "win32"); });
    else signalChild(child, "SIGTERM", process.platform !== "win32");
  }
}

function signalChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals, group: boolean): void {
  try {
    if (group && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The authentication process may already have exited.
  }
}

function sanitizeAuthOutput(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(?:xai|sk|key)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-jwt]")
    .replace(/((?:access|refresh|id)_token\s*[=:]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/(authorization\s*[=:]\s*(?:bearer\s+)?)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 2_000);
}

function clone(value: AuthJobSnapshot): AuthJobSnapshot {
  return { ...value, output: [...value.output] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
