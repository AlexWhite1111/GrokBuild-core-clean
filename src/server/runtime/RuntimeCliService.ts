import type { RuntimeCliMutationPreview, RuntimeCliSnapshot } from "../../shared/contracts.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "./OwnedProcessRegistry.js";

type Input = Record<string, unknown>;
export class RuntimeCliService {
  private readonly runner: GrokRunner;
  constructor(binary: string, private readonly workspace: WorkspaceSource, private readonly grokHome: string, processes?: OwnedProcessRegistry) { this.runner = new GrokRunner(binary, processes); }
  async snapshot(): Promise<RuntimeCliSnapshot> {
    const workspace = currentWorkspace(this.workspace);
    const options = { cwd: workspace, timeoutMs: 30_000, maxOutputBytes: 200_000, env: { GROK_HOME: this.grokHome } };
    const [versionResult, updateResult, leadersResult] = await Promise.all([this.runner.run(["version", "--json"], options), this.runner.run(["update", "--check", "--json"], options), this.runner.run(["leader", "list"], options)]);
    const version = safeJson(versionResult.stdout);
    const update = safeJson(updateResult.stdout);
    const leaderText = sanitize(leadersResult.stdout || leadersResult.stderr, this.grokHome, workspace);
    return { scannedAt: new Date().toISOString(), version: { current: stringValue(version.currentVersion) ?? "unknown", channel: stringValue(version.channel) ?? "unknown" }, update: { current: stringValue(update.currentVersion) ?? "unknown", latest: stringValue(update.latestVersion) ?? "unknown", available: update.updateAvailable === true, channel: stringValue(update.channel) ?? "unknown", installer: stringValue(update.installer) ?? "unknown", autoUpdate: update.autoUpdate === true, error: stringValue(update.error) }, leaders: { summary: leaderText || "No output", count: /no leader candidates/i.test(leaderText) ? 0 : null }, commands: [
      { id: "version/update-check", mode: "read-only", detail: "Official JSON version and update check." },
      { id: "update/install", mode: "confirmed-mutation", detail: "Official updater after exact confirmation." },
      { id: "leader/list", mode: "read-only", detail: "Official leader process inventory." },
      { id: "leader/kill", mode: "confirmed-mutation", detail: "Stops Grok leader processes only after exact confirmation." },
      { id: "setup", mode: "confirmed-mutation", detail: "Fetches managed configuration after exact confirmation." },
      { id: "completions/wrap/dashboard", mode: "gui-equivalent", detail: "Shell/terminal surfaces are documented; GUI provides native completion, clipboard, and dashboard equivalents." },
    ] };
  }
  preview(input: Input): RuntimeCliMutationPreview {
    const action = actionValue(input.action);
    if (action === "update") { const version = optionalVersion(input.version); return { token: version ? `update:${version}` : "update:latest", action, target: version ?? "latest stable version", warning: "This replaces the official Grok CLI installation and may require restarting running Grok clients." }; }
    if (action === "setup") return { token: "setup-managed-config", action, target: "managed Grok configuration", warning: "This fetches and installs organization-managed configuration using official `grok setup`." };
    return { token: "kill-grok-leaders", action, target: "all Grok leader processes", warning: "This stops Grok leader processes and can disconnect clients using shared leader mode." };
  }
  async apply(input: Input, confirmation: unknown): Promise<{ ok: true; action: string; output: string }> {
    const preview = this.preview(input); if (confirmation !== preview.token) throw new Error(`Confirmation must exactly equal ${preview.token}`);
    const args = preview.action === "update" ? ["update", ...(input.version ? ["--version", String(input.version)] : [])] : preview.action === "setup" ? ["setup"] : ["leader", "kill"];
    const workspace = currentWorkspace(this.workspace);
    const result = await this.runner.run(args, { cwd: workspace, timeoutMs: 180_000, maxOutputBytes: 500_000, env: { GROK_HOME: this.grokHome } });
    if (result.code !== 0) throw new Error(sanitize(result.stderr || result.stdout, this.grokHome, workspace) || `${preview.action} failed`);
    return { ok: true, action: preview.action, output: sanitize(result.stdout || result.stderr, this.grokHome, workspace) };
  }
}
function actionValue(value: unknown): "update" | "setup" | "kill-leaders" { if (value === "update" || value === "setup" || value === "kill-leaders") return value; throw new Error("Unsupported runtime action"); }
function optionalVersion(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw new Error("Version is invalid"); return value; }
function safeJson(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return isRecord(parsed) ? parsed : {}; } catch { return {}; } }
function sanitize(value: string, home: string, workspace: string): string { return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replaceAll(home, "~/.grok").replaceAll(workspace, "<workspace>").replace(/\b(?:xai|sk)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted-token]").trim().slice(0, 5_000); }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value.slice(0, 500) : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
