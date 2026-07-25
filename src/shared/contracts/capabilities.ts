type CapabilityStatus = "ready" | "degraded" | "unavailable";

export interface CliCommandInfo {
  name: string;
  description: string;
}

export interface AcpCommandInfo {
  name: string;
  description?: string;
  inputHint?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  reasoningEfforts: string[];
}

export interface InspectSummary {
  available: boolean;
  grokVersion: string | null;
  channel: string | null;
  projectRootDetected: boolean;
  projectTrusted: boolean;
  bridgeTrusted: boolean;
  counts: {
    projectInstructions: number;
    permissions: number;
    hooks: number;
    skills: number;
    agents: number;
    plugins: number;
    marketplaces: number;
    mcpServers: number;
    lspServers: number;
    configSources: number;
    externalCompat: number;
  };
  permissionPolicy: {
    loaded: number;
    skipped: number;
    sourceCount: number;
    sourceKinds: Array<"claude" | "native" | "managed" | "runtime" | "unknown">;
    managedSettingsExists: boolean;
    managedSettingsActive: boolean;
  };
  error?: string;
}

export interface CapabilitySnapshot {
  scannedAt: string;
  status: CapabilityStatus;
  platform: {
    os: NodeJS.Platform;
    arch: string;
    node: string;
    nativeSandboxExpected: boolean;
    sandboxMechanism: "seatbelt" | "landlock" | "none";
    childNetworkRestriction: boolean;
    sandboxNote: string;
  };
  cli: {
    available: boolean;
    binary: string;
    version: string | null;
    commit: string | null;
    commands: CliCommandInfo[];
    permissionModes: string[];
    error?: string;
  };
  inspect: InspectSummary;
  acp: {
    available: boolean;
    protocolVersion: number | null;
    agentVersion: string | null;
    loadSession: boolean;
    prompt: {
      image: boolean;
      audio: boolean;
      embeddedContext: boolean;
    };
    mcp: {
      http: boolean;
      sse: boolean;
    };
    fsNotify: boolean;
    hookBlockingEvents: string[];
    hookDecisions: string[];
    authMethods: Array<{ id: string; name: string }>;
    models: ModelInfo[];
    availableCommands: AcpCommandInfo[];
    mcpServers: Array<{ name: string; status?: string; toolCount: number }>;
    extensions: {
      grokShell: boolean;
      mcpSdk: boolean;
      pluginDirs: boolean;
      mcpApps: boolean;
      cancelRewind: boolean;
      sessionRecap: boolean;
    };
    xai: Array<{
      method: string;
      kind: "request" | "notification" | "reverseRequest" | "event";
      sideEffect: "none" | "read" | "write";
      availability: "advertised" | "probed" | "unavailable" | "policyLocked";
      reason?: string;
    }>;
    error?: string;
  };
  security: {
    bindHost: string;
    originGuard: boolean;
    imageRoots: string[];
    imageExtensions: string[];
  };
}
