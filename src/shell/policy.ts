const SAFE_RENDERER_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "clipboard-write",
  "fullscreen",
  "notifications",
]);

export interface BackendEnvironmentOptions {
  port: number;
  workspace: string;
  appHome: string;
  grokHome: string;
  grokHomeId: string;
  grokBin: string;
  launchToken: string;
  shellToken: string;
  appVersion: string;
}

export function isTrustedAppUrl(value: string, port: number): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && url.hostname === "127.0.0.1"
      && Number(url.port || "80") === port;
  } catch {
    return false;
  }
}

export function isTrustedRendererFrame(value: string, mainFrame: boolean, port: number): boolean {
  return mainFrame && isTrustedAppUrl(value, port);
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isAllowedRendererPermission(permission: string, origin: string, port: number): boolean {
  return SAFE_RENDERER_PERMISSIONS.has(permission) && isTrustedAppUrl(origin, port);
}

export function backendEnvironment(
  base: NodeJS.ProcessEnv,
  options: BackendEnvironmentOptions,
): NodeJS.ProcessEnv {
  const environment = { ...base };
  for (const key of ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] as const) delete environment[key];
  return {
    ...environment,
    GROK_GUI_HOST: "127.0.0.1",
    GROK_GUI_PORT: String(options.port),
    GROK_GUI_CWD: options.workspace,
    GROK_GUI_NO_BROWSER: "1",
    GROK_GUI_HOME: options.appHome,
    GROK_HOME: options.grokHome,
    GROK_GUI_GROK_HOME_ID: options.grokHomeId,
    GROK_BIN: options.grokBin,
    GROK_GUI_LAUNCH_TOKEN: options.launchToken,
    GROK_GUI_SHELL_TOKEN: options.shellToken,
    GROK_GUI_ALLOWED_ORIGIN: `http://127.0.0.1:${options.port}`,
    GROK_GUI_APP_VERSION: options.appVersion,
  };
}
