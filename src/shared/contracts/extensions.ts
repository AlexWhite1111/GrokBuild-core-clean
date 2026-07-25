type ExtensionScope = "user" | "project" | "plugin" | "builtin" | "compat" | "unknown";
export type ExtensionDocumentKind = "plugin" | "skill" | "hook" | "agent" | "rule";

export interface ExtensionDocumentSummary {
  id: string;
  name: string;
  scope: ExtensionScope;
  sourceType: string;
  relativePath: string | null;
  editable: boolean;
  enabled: boolean;
}

export interface ExtensionInventorySnapshot {
  scannedAt: string;
  projectRules: Array<ExtensionDocumentSummary & { fileType: string; sizeBytes: number; approxTokens: number }>;
  hooks: Array<ExtensionDocumentSummary & { event: string; hookType: string; hasMatcher: boolean; eventCount: number }>;
  skills: Array<ExtensionDocumentSummary & { description: string; userInvocable: boolean }>;
  agents: Array<ExtensionDocumentSummary & { description: string }>;
  plugins: Array<{
    id: string;
    name: string;
    scope: string;
    enabled: boolean;
    editable: boolean;
    relativePath: string | null;
    skills: number;
    agents: number;
    hooks: boolean;
    mcpServers: number;
  }>;
  marketplaces: Array<{ name: string; kind: string }>;
  mcpServers: Array<{
    id: string;
    name: string;
    transport: string;
    sourceType: string;
    scope: ExtensionScope;
    enabled: boolean;
    editable: boolean;
    environmentKeys: string[];
    headerNames: string[];
  }>;
  lspServers: Array<{ name: string; sourceType: string }>;
  configLayers: Array<{ role: string }>;
  compatibility: Array<{ vendor: string; surface: string; enabled: boolean; source: string }>;
}

export interface ExtensionDocumentDetail {
  id: string;
  kind: ExtensionDocumentKind;
  name: string;
  scope: "user" | "project";
  sourceType: string;
  relativePath: string;
  editable: true;
  enabled: boolean;
  language: "markdown" | "json";
  content: string;
  revision: string;
  writeOnlyValuesRedacted: boolean;
}

export interface McpConfigDetail {
  id: string;
  name: string;
  scope: "user" | "project";
  sourceType: string;
  editable: true;
  transport: "stdio" | "http" | "sse";
  target: string | null;
  targetConfigured: boolean;
  args: string[];
  enabled: boolean;
  environmentKeys: string[];
  headerNames: string[];
}

export interface McpDoctorSnapshot {
  scannedAt: string;
  healthyCount: number;
  failingCount: number;
  sources: Array<{ label: string; status: string; serverCount: number }>;
  servers: Array<{
    name: string;
    transport: string;
    sourceType: string;
    healthy: boolean;
    checks: Array<{ label: string; passed: boolean; detail: string | null; hint: string | null }>;
  }>;
}

interface PluginCatalogEntry {
  name: string;
  status: string;
  version: string | null;
  description: string;
  marketplace: string | null;
  components: {
    skills: number;
    commands: number;
    agents: number;
    mcpServers: number;
    hooks: number;
  };
}

export interface PluginCatalogSnapshot {
  scannedAt: string;
  plugins: PluginCatalogEntry[];
  marketplaces: Array<{ name: string; kind: string }>;
}

export interface ExtensionMutationPreview {
  token: string;
  domain: "mcp" | "marketplace" | ExtensionDocumentKind;
  action: string;
  target: string;
  changes: Array<{ field: string; before: string; after: string }>;
  warnings: string[];
}
