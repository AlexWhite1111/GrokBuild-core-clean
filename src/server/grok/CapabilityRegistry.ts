import type {
  AcpCommandInfo,
  CapabilitySnapshot,
  CliCommandInfo,
  ModelInfo,
} from "../../shared/contracts.js";
import { GROK_BIN, GROK_HOME, HOST, IMAGE_EXTENSIONS, WORKSPACE } from "../config.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { InspectAdapter } from "../cli/InspectAdapter.js";
import { sandboxPlatformFacts } from "../security/platformSandbox.js";
import { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { XaiMethodDescriptor } from "../acp/XaiMethodRegistry.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

interface InitializeResult {
  protocolVersion?: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    _meta?: {
      "x.ai/fs_notify"?: boolean;
      "x.ai/hooks"?: { blockingEvents?: string[]; decisions?: string[] };
    };
  };
  authMethods?: Array<{ id?: string; name?: string }>;
  _meta?: {
    agentVersion?: string;
    modelState?: { availableModels?: unknown[] };
    availableCommands?: unknown[];
    mcpServers?: unknown[];
    grokShell?: boolean;
    "x.ai/mcp/sdk"?: boolean;
    "x.ai/pluginDirs"?: boolean;
    mcpApps?: boolean;
    cancelRewind?: boolean;
    sessionRecap?: boolean;
  };
}

export interface CapabilityRegistryOptions {
  binary?: string;
  grokHome?: string;
  workspace?: WorkspaceSource;
  processes?: OwnedProcessRegistry;
}

export class CapabilityRegistry extends EventEmitter {
  private snapshot: CapabilitySnapshot | null = null;
  private refreshPromise: Promise<CapabilitySnapshot> | null = null;
  private readonly runner: GrokRunner;
  private readonly binary: string;
  private readonly grokHome: string;
  private readonly workspace: WorkspaceSource;
  private readonly processes?: OwnedProcessRegistry;

  constructor(options: CapabilityRegistryOptions = {}) {
    super();
    this.binary = options.binary || GROK_BIN;
    this.grokHome = options.grokHome || GROK_HOME;
    this.workspace = options.workspace || WORKSPACE;
    this.processes = options.processes;
    this.runner = new GrokRunner(this.binary, this.processes);
  }

  async get(): Promise<CapabilitySnapshot> {
    return this.snapshot ?? this.refresh();
  }

  async refresh(): Promise<CapabilitySnapshot> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.scan().finally(() => {
      this.refreshPromise = null;
    });
    this.snapshot = await this.refreshPromise;
    this.emit("changed", this.snapshot);
    return this.snapshot;
  }

  private async scan(): Promise<CapabilitySnapshot> {
    const workspace = currentWorkspace(this.workspace);
    const [cli, inspect, acp] = await Promise.all([
      this.scanCli(),
      new InspectAdapter(this.runner, workspace).scan(),
      this.scanAcp(workspace),
    ]);
    const status = cli.available && acp.available
      ? "ready"
      : cli.available || acp.available
        ? "degraded"
        : "unavailable";

    return {
      scannedAt: new Date().toISOString(),
      status,
      platform: platformSnapshot(),
      cli,
      inspect,
      acp,
      security: {
        bindHost: HOST,
        originGuard: true,
        imageRoots: ["active-project", "theme-assets"],
        imageExtensions: [...IMAGE_EXTENSIONS],
      },
    };
  }

  private async scanCli(): Promise<CapabilitySnapshot["cli"]> {
    try {
      const workspace = currentWorkspace(this.workspace);
      const [versionResult, helpResult] = await Promise.all([
        this.runner.run(["--version"], { cwd: workspace, timeoutMs: 10_000 }),
        this.runner.run(["--help"], { cwd: workspace, timeoutMs: 10_000 }),
      ]);
      if (versionResult.code !== 0) {
        throw new Error(versionResult.stderr.trim() || "grok --version failed");
      }
      const parsed = parseCliVersion(versionResult.stdout);
      return {
        available: true,
        binary: path.basename(this.binary),
        version: parsed.version,
        commit: parsed.commit,
        commands: parseTopLevelCommands(helpResult.stdout),
        permissionModes: parsePermissionModes(helpResult.stdout),
      };
    } catch (error) {
      return {
        available: false,
        binary: path.basename(this.binary),
        version: null,
        commit: null,
        commands: [],
        permissionModes: [],
        error: errorMessage(error),
      };
    }
  }

  private async scanAcp(workspace: string): Promise<CapabilitySnapshot["acp"]> {
    const client = new OfficialAcpClient({
      binary: this.binary,
      cwd: workspace,
      grokHome: this.grokHome,
      permissionMode: "default",
      sandboxMode: "workspace",
      processes: this.processes,
      processOwner: { kind: "application", id: "capability-acp" },
    });
    try {
      const result = await client.start();
      return sanitizeAcpInitialize(result as InitializeResult, client.registry.snapshot());
    } catch (error) {
      return emptyAcp(errorMessage(error));
    } finally {
      await client.shutdown();
    }
  }
}

function parseCliVersion(text: string): { version: string | null; commit: string | null } {
  const match = text.trim().match(/grok\s+([^\s]+)(?:\s+\(([^)]+)\))?/i);
  return { version: match?.[1] ?? null, commit: match?.[2] ?? null };
}

function parseTopLevelCommands(help: string): CliCommandInfo[] {
  const marker = help.indexOf("Commands:");
  if (marker < 0) return [];
  const block = help.slice(marker + "Commands:".length);
  const commands: CliCommandInfo[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^[A-Z][a-z]+:/.test(line.trim())) break;
    const match = line.match(/^\s{2}([a-z][\w-]*)\s{2,}(.+)$/);
    if (match) commands.push({ name: match[1], description: match[2].trim() });
  }
  return commands;
}

function parsePermissionModes(help: string): string[] {
  const match = help.match(/--permission-mode\s+<[^>]+>[\s\S]{0,240}?\[possible values:\s*([^\]]+)\]/i);
  return match ? match[1].split(",").map((value) => value.trim()).filter(Boolean) : [];
}

function sanitizeAcpInitialize(
  result: InitializeResult,
  xai: XaiMethodDescriptor[] = [],
): CapabilitySnapshot["acp"] {
  const capabilities = result.agentCapabilities ?? {};
  const prompt = capabilities.promptCapabilities ?? {};
  const mcp = capabilities.mcpCapabilities ?? {};
  const hooks = capabilities._meta?.["x.ai/hooks"] ?? {};
  return {
    available: true,
    protocolVersion: result.protocolVersion ?? null,
    agentVersion: result._meta?.agentVersion ?? null,
    loadSession: Boolean(capabilities.loadSession),
    prompt: {
      image: Boolean(prompt.image),
      audio: Boolean(prompt.audio),
      embeddedContext: Boolean(prompt.embeddedContext),
    },
    mcp: { http: Boolean(mcp.http), sse: Boolean(mcp.sse) },
    fsNotify: Boolean(capabilities._meta?.["x.ai/fs_notify"]),
    hookBlockingEvents: stringArray(hooks.blockingEvents),
    hookDecisions: stringArray(hooks.decisions),
    authMethods: (result.authMethods ?? []).flatMap((method) =>
      method.id
        ? [{ id: method.id, name: method.name || method.id }]
        : [],
    ),
    models: sanitizeModels(result._meta?.modelState?.availableModels),
    availableCommands: sanitizeCommands(result._meta?.availableCommands),
    mcpServers: sanitizeMcpServers(result._meta?.mcpServers),
    extensions: {
      grokShell: result._meta?.grokShell === true,
      mcpSdk: result._meta?.["x.ai/mcp/sdk"] === true,
      pluginDirs: result._meta?.["x.ai/pluginDirs"] === true,
      mcpApps: result._meta?.mcpApps === true,
      cancelRewind: result._meta?.cancelRewind === true,
      sessionRecap: result._meta?.sessionRecap === true,
    },
    xai,
  };
}

function sanitizeModels(value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.modelId) || stringValue(entry.id);
    if (!id) return [];
    const meta = isRecord(entry._meta) ? entry._meta : {};
    return [{
      id,
      name: stringValue(entry.name),
      description: stringValue(entry.description),
      reasoningEfforts: stringArray(meta.reasoningEfforts).length
        ? stringArray(meta.reasoningEfforts)
        : objectIdArray(meta.reasoningEfforts),
    }];
  });
}

function sanitizeCommands(value: unknown): AcpCommandInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !stringValue(entry.name)) return [];
    const input = isRecord(entry.input) ? entry.input : {};
    return [{
      name: stringValue(entry.name)!,
      description: stringValue(entry.description),
      inputHint: stringValue(input.hint),
    }];
  });
}

function sanitizeMcpServers(value: unknown): Array<{ name: string; status?: string; toolCount: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !stringValue(entry.name)) return [];
    return [{
      name: stringValue(entry.name)!,
      status: stringValue(entry.status),
      toolCount: Array.isArray(entry.tools) ? entry.tools.length : 0,
    }];
  });
}

function emptyAcp(error: string): CapabilitySnapshot["acp"] {
  return {
    available: false,
    protocolVersion: null,
    agentVersion: null,
    loadSession: false,
    prompt: { image: false, audio: false, embeddedContext: false },
    mcp: { http: false, sse: false },
    fsNotify: false,
    hookBlockingEvents: [],
    hookDecisions: [],
    authMethods: [],
    models: [],
    availableCommands: [],
    mcpServers: [],
    extensions: {
      grokShell: false,
      mcpSdk: false,
      pluginDirs: false,
      mcpApps: false,
      cancelRewind: false,
      sessionRecap: false,
    },
    xai: [],
    error,
  };
}

function platformSnapshot(): CapabilitySnapshot["platform"] {
  const sandbox = sandboxPlatformFacts(process.platform);
  return {
    os: process.platform,
    arch: process.arch,
    node: process.version,
    nativeSandboxExpected: sandbox.kernelSupported,
    sandboxMechanism: sandbox.mechanism,
    childNetworkRestriction: sandbox.childNetworkRestriction,
    sandboxNote: sandbox.note,
  };
}

function objectIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && stringValue(entry.id) ? [stringValue(entry.id)!] : [],
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { EventEmitter } from "node:events";
import path from "node:path";
