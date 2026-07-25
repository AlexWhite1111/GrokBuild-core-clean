export interface AccountModelSnapshot {
  scannedAt: string;
  account: {
    authenticated: boolean;
    label: string;
    authFile: {
      exists: boolean;
      modifiedAt: string | null;
      credentialEntries: number;
      providers: string[];
    };
    environment: {
      xaiApiKeyConfigured: boolean;
      externalProviderConfigured: boolean;
      oidcConfigured: boolean;
      customModelsEndpointConfigured: boolean;
    };
    advertisedMethods: Array<{ id: string; name: string }>;
    capabilities: {
      loginOAuth: true;
      loginDevice: true;
      logout: true;
      usage: false;
      privacy: false;
      unavailableReason: string;
    };
  };
  models: {
    defaultModel: string | null;
    available: Array<{ id: string; isDefault: boolean }>;
    source: "grok models";
  };
}

export interface AccountStatusSnapshot {
  scannedAt: string;
  account: AccountModelSnapshot["account"];
}

export interface AuthJobSnapshot {
  id: string;
  action: "login-oauth" | "login-device";
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  output: string[];
  truncated: boolean;
}

export interface AuthLogoutPreview {
  token: "logout";
  authenticated: boolean;
  credentialEntries: number;
  warning: string;
}

export interface CustomModelSummary {
  name: string;
  scope: "user" | "project";
  modelId: string | null;
  displayName: string | null;
  description: string | null;
  baseUrl: string | null;
  envKey: string | null;
  apiBackend: "chat_completions" | "responses" | "messages";
  contextWindow: number | null;
  apiKeyConfigured: boolean;
  unknownFieldCount: number;
}

export interface CustomModelInventory {
  scannedAt: string;
  defaults: { user: string | null; project: string | null };
  models: CustomModelSummary[];
}

export interface CustomModelMutationPreview {
  token: string;
  action: "save" | "delete" | "set-default";
  scope: "user" | "project";
  name: string;
  relativeTarget: string;
  changes: Array<{ field: string; before: string; after: string }>;
  warnings: string[];
}
