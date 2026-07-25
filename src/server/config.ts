import os from "node:os";
import path from "node:path";

export const APP_VERSION = process.env.GROK_GUI_APP_VERSION || "development";
export const HOST = "127.0.0.1";
export const PORT = parsePort(process.env.GROK_GUI_PORT, 5180);
export const WORKSPACE = path.resolve(process.env.GROK_GUI_CWD || process.cwd());
export const APP_HOME = path.resolve(
  process.env.GROK_GUI_HOME
    || path.join(os.homedir(), "Library", "Application Support", "Grok Build", "Rebuild"),
);
export const GROK_HOME = path.resolve(
  process.env.GROK_HOME || path.join(os.homedir(), ".grok"),
);
export const GROK_HOME_ID = process.env.GROK_GUI_GROK_HOME_ID || "native";
export const GROK_BIN = path.resolve(
  process.env.GROK_BIN ||
    path.join(os.homedir(), ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok"),
);
export const LAUNCH_TOKEN = process.env.GROK_GUI_LAUNCH_TOKEN || "development-only-token";
export const SHELL_TOKEN = process.env.GROK_GUI_SHELL_TOKEN || "development-only-shell-token";
export const EXPECTED_ORIGIN = process.env.GROK_GUI_ALLOWED_ORIGIN || `http://${HOST}:${PORT}`;
export const APP_STATE_FILE = path.join(APP_HOME, "app-state.json");
export const THEMES_HOME = path.join(APP_HOME, "themes");
export const THEME_ASSETS_HOME = path.join(APP_HOME, "theme-assets");
export const MEDIA_CACHE_HOME = path.join(APP_HOME, "media-cache-v2");
export const PREVIEW_CACHE_HOME = path.join(APP_HOME, "preview-cache-v2");
export const RUNS_HOME = path.join(APP_HOME, "runs-v2");
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : fallback;
}
