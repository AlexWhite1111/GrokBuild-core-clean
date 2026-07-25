import type {
  ExtensionInventorySnapshot,
  ExtensionMutationPreview,
  McpConfigDetail,
  McpDoctorSnapshot,
  PluginCatalogSnapshot,
} from "../../shared/contracts.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import type { WorkspaceSource } from "../projects/workspaceSource.js";
import { ExtensionDocumentStore } from "./ExtensionDocumentStore.js";
import { McpConfigAdapter } from "./McpConfigAdapter.js";
import {
  ExtensionRuntime,
  type ExtensionRunner,
  isRecord,
  nonNegative,
  records,
  safeOptional,
  safeText,
  sourceType,
} from "./ExtensionRuntime.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export class ExtensionInventoryService {
  private readonly runtime: ExtensionRuntime;
  private readonly documents: ExtensionDocumentStore;
  private readonly mcp: McpConfigAdapter;
  private catalogCache: { expiresAt: number; value: PluginCatalogSnapshot } | null = null;

  constructor(binary: string, cwd: WorkspaceSource, grokHome: string, runner?: ExtensionRunner, processes?: OwnedProcessRegistry) {
    this.runtime = new ExtensionRuntime(runner ?? new GrokRunner(binary, processes), cwd, grokHome);
    this.documents = new ExtensionDocumentStore(grokHome, () => this.runtime.workspace());
    this.mcp = new McpConfigAdapter(this.runtime);
  }

  async inventory(): Promise<ExtensionInventorySnapshot> {
    const value = await this.runtime.json(["inspect", "--json"], 30_000, 5_000_000);
    if (!isRecord(value)) throw new Error("grok inspect returned a non-object payload");
    const [documents, mcpServers] = await Promise.all([this.documents.discover(value), this.mcp.inventory(value)]);
    return {
      scannedAt: new Date().toISOString(),
      projectRules: documents.projectRules,
      hooks: documents.hooks,
      skills: documents.skills,
      agents: documents.agents,
      plugins: records(value.plugins).slice(0, 500).map((item) => {
        const provides = isRecord(item.provides) ? item.provides : {};
        const name = safeText(item.name, "unnamed", 100);
        const document = documents.plugins.find((candidate) => candidate.name === name);
        return {
          id: document?.id ?? `plugin:${name}`,
          name,
          scope: safeText(item.scope, "unknown", 60),
          enabled: item.enabled === true,
          editable: document?.editable ?? false,
          relativePath: document?.relativePath ?? null,
          skills: nonNegative(provides.skills),
          agents: nonNegative(provides.agents),
          hooks: provides.hooks === true,
          mcpServers: nonNegative(provides.mcpServers),
        };
      }),
      marketplaces: records(value.marketplaces).slice(0, 100).map((item) => ({
        name: safeText(item.name, "unnamed", 100),
        kind: safeText(item.kind, "unknown", 60),
      })),
      mcpServers,
      lspServers: records(value.lspServers).slice(0, 500).map((item) => ({
        name: safeText(item.name, "unnamed", 100),
        sourceType: sourceType(item.source),
      })),
      configLayers: isRecord(value.configSources)
        ? records(value.configSources.layers).slice(0, 100).map((item) => ({ role: safeText(item.role, "unknown", 100) }))
        : [],
      compatibility: isRecord(value.externalCompat)
        ? records(value.externalCompat.cells).slice(0, 500).map((item) => ({
          vendor: safeText(item.vendor, "unknown", 100),
          surface: safeText(item.surface, "unknown", 100),
          enabled: item.enabled === true,
          source: safeText(item.source, "unknown", 100),
        }))
        : [],
    };
  }

  doctor(name?: string): Promise<McpDoctorSnapshot> { return this.mcp.doctor(name); }

  async catalog(force = false): Promise<PluginCatalogSnapshot> {
    if (!force && this.catalogCache && this.catalogCache.expiresAt > Date.now()) return this.catalogCache.value;
    const [pluginValue, marketplaceValue] = await Promise.all([
      this.runtime.json(["plugin", "list", "--json", "--available"], 60_000, 25_000_000),
      this.runtime.json(["plugin", "marketplace", "list", "--json"], 30_000, 5_000_000),
    ]);
    const value: PluginCatalogSnapshot = {
      scannedAt: new Date().toISOString(),
      plugins: records(pluginValue).slice(0, 2_000).map((item) => {
        const components = isRecord(item.components) ? item.components : {};
        return {
          name: safeText(item.name, "unnamed", 100),
          status: safeText(item.status, "unknown", 40),
          version: safeOptional(item.version, 100),
          description: safeText(item.description, "", 500),
          marketplace: safeOptional(item.marketplace, 100),
          components: {
            skills: collectionCount(components.skills) || nonNegative(item.skill_count),
            commands: collectionCount(components.commands),
            agents: collectionCount(components.agents),
            mcpServers: collectionCount(components.mcpServers),
            hooks: collectionCount(components.hooks),
          },
        };
      }),
      marketplaces: records(marketplaceValue).slice(0, 100).map((item) => ({
        name: safeText(item.name, "unnamed", 100),
        kind: safeText(item.kind, "unknown", 60),
      })),
    };
    this.catalogCache = { expiresAt: Date.now() + 60_000, value };
    return value;
  }

  document(id: unknown) { return this.documents.detail(id); }
  previewDocument(input: unknown) { return this.documents.preview(input); }
  applyDocument(input: unknown, confirmation: unknown) { return this.documents.apply(input, confirmation); }
  mcpDetail(name: unknown, scope: unknown): Promise<McpConfigDetail> { return this.mcp.detail(name, scope); }

  previewPlugin(input: unknown): ExtensionMutationPreview {
    if (!isRecord(input)) throw new Error("Plugin mutation is invalid");
    const action = safePluginAction(input.action);
    const target = action === "install" ? validateSource(input.source) : validateName(safeText(input.name, "", 100));
    const trust = input.trust === true;
    const keepData = input.keepData === true;
    return {
      token: target,
      domain: "plugin",
      action,
      target,
      changes: action === "enable" || action === "disable"
        ? [{ field: "enabled", before: action === "enable" ? "false" : "true", after: action === "enable" ? "true" : "false" }]
        : action === "install"
          ? [{ field: "installed", before: "false", after: "true" }, { field: "trusted", before: "false", after: String(trust) }]
          : action === "uninstall"
            ? [{ field: "installed", before: "true", after: "false" }, { field: "data", before: "present", after: keepData ? "preserved" : "removed" }]
            : [{ field: "version", before: "current", after: "latest available" }],
      warnings: action === "install" && !trust
        ? ["Non-interactive install requires an explicit Trust choice before apply."]
        : action === "uninstall" ? ["Uninstall may remove components used by active sessions."] : [],
    };
  }

  async applyPlugin(input: unknown, confirmation: unknown): Promise<{ ok: true; action: string; target: string }> {
    const preview = this.previewPlugin(input);
    if (confirmation !== preview.token) throw new Error("Exact plugin target confirmation is required");
    const value = input as Record<string, unknown>;
    const args = ["plugin", preview.action];
    if (preview.action === "install") {
      if (value.trust !== true) throw new Error("Explicit Trust is required for non-interactive plugin install");
      args.push("--trust", "--", preview.target);
    } else if (preview.action === "uninstall") {
      args.push("--confirm");
      if (value.keepData === true) args.push("--keep-data");
      args.push("--", preview.target);
    } else {
      args.push("--", preview.target);
    }
    const result = await this.runtime.run(args, 5 * 60_000, 2_000_000);
    if (result.code !== 0) throw new Error(`Plugin ${preview.action} failed`);
    this.catalogCache = null;
    return { ok: true, action: preview.action, target: preview.target };
  }

  previewMcp(input: unknown): Promise<ExtensionMutationPreview> { return this.mcp.preview(input); }
  applyMcp(input: unknown, confirmation: unknown) { return this.mcp.apply(input, confirmation); }

}

function validateName(value: string): string {
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(value)) throw new Error("Invalid extension name");
  return value;
}
function safePluginAction(value: unknown): "install" | "uninstall" | "update" | "enable" | "disable" {
  if (value === "install" || value === "uninstall" || value === "update" || value === "enable" || value === "disable") return value;
  throw new Error("Unsupported plugin action");
}
function validateSource(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000 || /[\r\n\0]/.test(value)) throw new Error("Invalid plugin source");
  return value.trim();
}
function collectionCount(value: unknown): number { return Array.isArray(value) ? value.length : 0; }
