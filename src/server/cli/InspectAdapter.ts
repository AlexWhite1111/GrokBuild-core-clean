import type { InspectSummary } from "../../shared/contracts.js";
import { GrokRunner } from "./GrokRunner.js";

export class InspectAdapter {
  constructor(
    private readonly runner: GrokRunner,
    private readonly cwd: string,
  ) {}

  async scan(): Promise<InspectSummary> {
    try {
      const result = await this.runner.run(["inspect", "--json"], {
        cwd: this.cwd,
        timeoutMs: 15_000,
        maxOutputBytes: 2_000_000,
      });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "grok inspect --json failed");
      }
      if (result.truncated) throw new Error("grok inspect --json exceeded the output limit");
      return summarizeInspect(JSON.parse(result.stdout) as unknown);
    } catch (error) {
      return emptyInspect(errorMessage(error));
    }
  }
}

/**
 * Convert the verbose inspect payload into a strict allowlisted summary.
 * Paths, rule text, permission details, plugin metadata and credentials never
 * cross the HTTP boundary.
 */
function summarizeInspect(value: unknown): InspectSummary {
  if (!isRecord(value)) return emptyInspect("inspect returned a non-object payload");
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  return {
    available: true,
    grokVersion: stringValue(value.grokVersion),
    channel: stringValue(value.channel),
    projectRootDetected: typeof value.projectRoot === "string" && value.projectRoot.length > 0,
    projectTrusted: value.projectTrusted === true,
    bridgeTrusted: value.bridgeTrusted === true,
    counts: {
      projectInstructions: collectionCount(value.projectInstructions),
      permissions: isRecord(value.permissions) ? numberValue(value.permissions.loaded) : collectionCount(value.permissions),
      hooks: collectionCount(value.hooks),
      skills: collectionCount(value.skills),
      agents: collectionCount(value.agents),
      plugins: collectionCount(value.plugins),
      marketplaces: collectionCount(value.marketplaces),
      mcpServers: collectionCount(value.mcpServers),
      lspServers: collectionCount(value.lspServers),
      configSources: collectionCount(value.configSources),
      externalCompat: collectionCount(value.externalCompat),
    },
    permissionPolicy: {
      loaded: numberValue(permissions.loaded),
      skipped: collectionCount(permissions.skipped),
      sourceCount: collectionCount(permissions.sources),
      sourceKinds: Array.isArray(permissions.sources)
        ? [...new Set(permissions.sources.map(permissionSourceKind))]
        : [],
      managedSettingsExists: permissions.managedSettingsExists === true,
      managedSettingsActive: permissions.managedSettingsActive === true,
    },
  };
}

function emptyInspect(error: string): InspectSummary {
  return {
    available: false,
    grokVersion: null,
    channel: null,
    projectRootDetected: false,
    projectTrusted: false,
    bridgeTrusted: false,
    counts: {
      projectInstructions: 0,
      permissions: 0,
      hooks: 0,
      skills: 0,
      agents: 0,
      plugins: 0,
      marketplaces: 0,
      mcpServers: 0,
      lspServers: 0,
      configSources: 0,
      externalCompat: 0,
    },
    permissionPolicy: {
      loaded: 0,
      skipped: 0,
      sourceCount: 0,
      sourceKinds: [],
      managedSettingsExists: false,
      managedSettingsActive: false,
    },
    error,
  };
}

function permissionSourceKind(value: unknown): InspectSummary["permissionPolicy"]["sourceKinds"][number] {
  if (typeof value !== "string") return "unknown";
  const source = value.toLowerCase().replace(/\\/g, "/");
  if (source.includes("/.claude/settings")) return "claude";
  if (source.includes("/.grok/config.toml")) return "native";
  if (source.includes("managed")) return "managed";
  if (source.includes("command line") || source.includes("cli")) return "runtime";
  return "unknown";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function collectionCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return isRecord(value) ? Object.keys(value).length : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
