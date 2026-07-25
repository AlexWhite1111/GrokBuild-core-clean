export type MemoryScope = "global" | "workspace" | "session";

export interface MemoryFileSummary {
  id: string;
  scope: MemoryScope;
  workspaceKey: string | null;
  relativePath: string;
  displayPath: string;
  sizeBytes: number;
  modifiedAt: string;
  ageDays: number;
  staleness: "curated" | "fresh" | "aging" | "stale";
}

export interface MemoryInventory {
  scannedAt: string;
  status: {
    configuredEnabled: boolean | null;
    environmentOverride: "enabled" | "disabled" | null;
    effectiveAtNextAgentStart: boolean;
    source: "environment" | "user-config" | "default";
    existingSessionsMayDiffer: true;
    memoryRootExists: boolean;
  };
  files: MemoryFileSummary[];
  totalBytes: number;
  truncated: boolean;
  capabilities: {
    localPreview: true;
    localTextSearch: true;
    deleteSessionFile: true;
    officialClearCli: true;
    hybridSearch: false;
    hybridSearchReason: string;
  };
}

export interface MemoryFilePreview extends MemoryFileSummary {
  content: string;
  contentTruncated: boolean;
}

export interface MemorySearchSnapshot {
  query: string;
  mode: "local-text";
  results: Array<{
    file: MemoryFileSummary;
    excerpt: string;
    matchCount: number;
  }>;
  truncated: boolean;
  note: string;
}

export interface MemoryMutationPreview {
  token: string;
  action: "set-enabled" | "delete-session" | "clear";
  scope: "config" | "session" | "global" | "workspace" | "all";
  target: string;
  changes: Array<{ field: string; before: string; after: string }>;
  warnings: string[];
}

export interface ConfigFieldSnapshot {
  id: string;
  group: "interface" | "features" | "session" | "tools" | "compatibility";
  label: string;
  description: string;
  kind: "boolean" | "integer" | "number" | "enum";
  value: boolean | number | string | null;
  configuredValue: boolean | number | string | null;
  defaultValue: boolean | number | string | null;
  source: "environment" | "user-config" | "default";
  environmentVariable: string | null;
  options: string[];
  min: number | null;
  max: number | null;
  applies: "immediate-tui" | "new-session" | "next-launch";
}

export interface ConfigInventory {
  scannedAt: string;
  fields: ConfigFieldSnapshot[];
  sources: Array<{
    name: string;
    role: "user" | "managed" | "requirements";
    exists: boolean;
    sizeBytes: number;
    modifiedAt: string | null;
  }>;
  boundary: string;
}

export interface ConfigMutationPreview {
  token: string;
  changes: Array<{
    id: string;
    label: string;
    before: string;
    after: string;
    action: "set" | "remove";
  }>;
  warnings: string[];
}

export interface HeadlessRunSnapshot {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  promptChars: number;
  model: string | null;
  sessionId: string | null;
  stopReason: string | null;
  events: Array<{
    type: "text" | "thought" | "end" | "error" | "unknown";
    data: string;
    receivedAt: string;
  }>;
  outputChars: number;
  truncated: boolean;
  options: {
    maxTurns: number | null;
    permissionMode: "default" | "bypassPermissions";
    toolsRestricted: boolean;
    resume: boolean;
    fork: boolean;
    structuredOutput: boolean;
    check: boolean;
    bestOfN: number | null;
  };
}

export interface RuntimeCliSnapshot {
  scannedAt: string;
  version: { current: string; channel: string };
  update: {
    current: string;
    latest: string;
    available: boolean;
    channel: string;
    installer: string;
    autoUpdate: boolean;
    error: string | null;
  };
  leaders: { summary: string; count: number | null };
  commands: Array<{ id: string; mode: "read-only" | "confirmed-mutation" | "gui-equivalent"; detail: string }>;
}

export interface RuntimeCliMutationPreview {
  token: string;
  action: "update" | "setup" | "kill-leaders";
  target: string;
  warning: string;
}
