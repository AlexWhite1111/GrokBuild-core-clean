import fs from "node:fs/promises";
import path from "node:path";
import type { AccountModelSnapshot, AccountStatusSnapshot } from "../../shared/contracts.js";
import type { GrokRunner, RunResult } from "../cli/GrokRunner.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";

interface RunnerLike {
  run(args: string[], options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }): Promise<RunResult>;
}

export class AccountModelService {
  constructor(
    private readonly runner: RunnerLike | GrokRunner,
    private readonly workspace: WorkspaceSource,
    private readonly grokHome: string,
  ) {}

  async accountStatus(advertisedMethods: Array<{ id: string; name: string }> = []): Promise<AccountStatusSnapshot> {
    const authFile = await inspectAuthFile(path.join(this.grokHome, "auth.json"));
    const environment = accountEnvironment(process.env);
    const authenticated = authFile.credentialEntries > 0 || environment.xaiApiKeyConfigured;
    return {
      scannedAt: new Date().toISOString(),
      account: {
        authenticated,
        label: environment.xaiApiKeyConfigured ? "API key configured" : authenticated ? "Cached credential" : "Not authenticated",
        authFile,
        environment,
        advertisedMethods: safeAdvertisedMethods(advertisedMethods),
        capabilities: ACCOUNT_CAPABILITIES,
      },
    };
  }

  async snapshot(advertisedMethods: Array<{ id: string; name: string }> = []): Promise<AccountModelSnapshot> {
    const [modelsResult, status] = await Promise.all([
      this.runner.run(["models"], { cwd: currentWorkspace(this.workspace), timeoutMs: 20_000, maxOutputBytes: 200_000 }),
      this.accountStatus(advertisedMethods),
    ]);
    const output = stripAnsi(`${modelsResult.stdout}\n${modelsResult.stderr}`);
    const parsed = parseModelsOutput(output);
    const authenticated = parsed.authenticated || status.account.authenticated;

    return {
      scannedAt: new Date().toISOString(),
      account: {
        ...status.account,
        authenticated,
        label: parsed.authLabel ?? status.account.label,
      },
      models: {
        defaultModel: parsed.defaultModel,
        available: parsed.models,
        source: "grok models",
      },
    };
  }
}

const ACCOUNT_CAPABILITIES: AccountModelSnapshot["account"]["capabilities"] = {
  loginOAuth: true,
  loginDevice: true,
  logout: true,
  usage: false,
  privacy: false,
  unavailableReason: "The current Grok runtime exposes /usage and /privacy only inside the TUI; no CLI or client ACP method is advertised.",
};

function accountEnvironment(env: NodeJS.ProcessEnv): AccountModelSnapshot["account"]["environment"] {
  return {
    xaiApiKeyConfigured: Boolean(env.XAI_API_KEY || env.GROK_CODE_XAI_API_KEY),
    externalProviderConfigured: Boolean(env.GROK_AUTH_PROVIDER_COMMAND),
    oidcConfigured: Boolean(env.GROK_OIDC_ISSUER && env.GROK_OIDC_CLIENT_ID),
    customModelsEndpointConfigured: Boolean(env.GROK_MODELS_BASE_URL || env.GROK_MODELS_LIST_URL),
  };
}

function safeAdvertisedMethods(methods: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  return methods.map((method) => ({ id: safeText(method.id, 100), name: safeText(method.name, 160) })).filter((method) => method.id);
}

export function parseModelsOutput(value: string): {
  authenticated: boolean;
  authLabel: string | null;
  defaultModel: string | null;
  models: Array<{ id: string; isDefault: boolean }>;
} {
  const text = stripAnsi(value);
  const auth = text.match(/^You are logged in with\s+(.+?)\.\s*$/im);
  const defaultModel = text.match(/^Default model:\s*(\S+)\s*$/im)?.[1] ?? null;
  const models: Array<{ id: string; isDefault: boolean }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/^\s*[-*]\s+([^\s(]+)(?:\s+\(default\))?\s*$/gim)) {
    const id = safeText(match[1], 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, isDefault: id === defaultModel || /\(default\)/i.test(match[0]) });
  }
  return {
    authenticated: Boolean(auth),
    authLabel: auth ? safeText(auth[1], 120) : null,
    defaultModel,
    models,
  };
}

async function inspectAuthFile(file: string): Promise<AccountModelSnapshot["account"]["authFile"]> {
  try {
    const [stat, text] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
    const parsed = JSON.parse(text) as unknown;
    const entries = isRecord(parsed) ? Object.keys(parsed) : [];
    const providers = [...new Set(entries.flatMap((key) => {
      const candidate = key.split("::", 1)[0];
      try { return [new URL(candidate).hostname.toLowerCase()]; } catch { return []; }
    }))].slice(0, 20);
    return {
      exists: true,
      modifiedAt: stat.mtime.toISOString(),
      credentialEntries: entries.length,
      providers,
    };
  } catch {
    return { exists: false, modifiedAt: null, credentialEntries: 0, providers: [] };
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
