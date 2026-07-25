import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function loadWorkspace(file: string, packaged: boolean, legacyFile?: string): string {
  const fallback = packaged ? os.homedir() : process.cwd();
  const explicit = process.env.GROK_GUI_CWD;
  if (explicit) return validDirectory(explicit, fallback);
  for (const candidate of [file, legacyFile]) {
    if (!candidate) continue;
    try {
      const stored = JSON.parse(fs.readFileSync(candidate, "utf8")) as { workspace?: unknown };
      if (typeof stored.workspace === "string") return validDirectory(stored.workspace, fallback);
    } catch { /* Try the next persisted location. */ }
  }
  return validDirectory(undefined, fallback);
}

export function persistWorkspace(file: string, workspace: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ workspace }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function validDirectory(candidate: string | undefined, fallback: string): string {
  const resolved = path.resolve(candidate?.trim() || fallback);
  try {
    return fs.statSync(resolved).isDirectory() ? fs.realpathSync.native(resolved) : path.resolve(fallback);
  } catch {
    return path.resolve(fallback);
  }
}

export function locateGrokBinary(options: { home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): string {
  const home = options.home || os.homedir();
  const environment = options.env || process.env;
  const platform = options.platform || process.platform;
  const executable = platform === "win32" ? "grok.exe" : "grok";
  const downloads = downloadCandidates(path.join(home, ".grok", "downloads"), platform);
  const candidates = [
    environment.GROK_BIN,
    path.join(home, ".grok", "bin", executable),
    ...downloads,
    ...(environment.PATH || "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executable)),
    ...(platform === "darwin" ? ["/opt/homebrew/bin/grok", "/usr/local/bin/grok"] : []),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return path.resolve(candidate);
    } catch {
      // Try the next documented installation location.
    }
  }
  return path.resolve(candidates[0] || executable);
}

function downloadCandidates(directory: string, platform: NodeJS.Platform): string[] {
  const suffix = platform === "darwin" ? "macos-aarch64" : platform === "linux" ? "linux-x64" : "windows-x64.exe";
  try {
    return fs.readdirSync(directory)
      .filter((name) => name === `grok-${suffix}` || new RegExp(`^grok-\\d+\\.\\d+\\.\\d+-${suffix.replace(".", "\\.")}$`).test(name))
      .sort((left, right) => versionFromName(right).localeCompare(versionFromName(left), undefined, { numeric: true }))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function versionFromName(name: string): string { return name.match(/grok-(\d+\.\d+\.\d+)/)?.[1] || "9999.9999.9999"; }
