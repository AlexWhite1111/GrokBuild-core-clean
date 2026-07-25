import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapabilitySnapshot } from "../../shared/contracts.js";
import type { RuntimePermissionCapabilities } from "../tasks/taskTypes.js";
import { currentWorkspace, type WorkspaceSource } from "../projects/workspaceSource.js";

export class PermissionCapabilityResolver {
  constructor(
    private readonly grokHome: string,
    private readonly projectPath: WorkspaceSource,
  ) {}

  resolve(capabilities?: CapabilitySnapshot): RuntimePermissionCapabilities {
    const lock = this.#alwaysApproveLock();
    const commands = capabilities?.acp.availableCommands.map((command) => command.name.toLowerCase()) ?? [];
    const xai = new Map((capabilities?.acp.xai || []).map((entry) => [entry.method, entry.availability]));
    const xaiAvailable = (method: string) => {
      const availability = xai.get(method);
      return availability === "advertised" || availability === "probed";
    };
    const structuredYolo = capabilities?.acp.extensions.grokShell === true
      && xaiAvailable("x.ai/yolo_mode_changed")
      && xaiAvailable("x.ai/sessions/list");
    const verifiedMode = this.#verifiedConfigMode();
    return {
      auto: {
        available: false,
        reason: commands.includes("auto")
          ? "Grok advertised /auto but did not advertise a structured Auto control with state readback."
          : "The current ACP runtime did not advertise the /auto feature.",
      },
      alwaysApprove: {
        available: !lock && structuredYolo,
        reason: lock
          ? "Always Approve is disabled by Grok requirements policy."
          : structuredYolo
            ? undefined
            : "Grok did not advertise the structured Always Approve control and session-roster readback.",
        lockedBy: lock || undefined,
      },
      acceptEdits: {
        available: structuredYolo && verifiedMode === "acceptEdits",
        reason: !structuredYolo
          ? "The current runtime cannot read back the effective session permission state."
          : verifiedMode === "acceptEdits" ? undefined : "No effective Claude settings source selects Accept Edits.",
      },
      dontAsk: {
        available: structuredYolo && verifiedMode === "dontAsk",
        reason: !structuredYolo
          ? "The current runtime cannot read back the effective session permission state."
          : verifiedMode === "dontAsk" ? undefined : "No effective Claude settings source selects Don’t Ask.",
      },
    };
  }

  #alwaysApproveLock(): string | null {
    const workspace = currentWorkspace(this.projectPath);
    const sources: Array<readonly [string, string]> = [
      ["/etc/grok/requirements.toml", "system requirements"],
      [path.join(this.grokHome, "requirements.toml"), "active Grok Home requirements"],
      ...workspaceDirectories(workspace).map((directory) => [
        path.join(directory, ".grok", "requirements.toml"),
        "project requirements",
      ] as const),
    ];
    for (const [source, label] of sources) {
      const text = readText(source);
      if (text && (
        /\bdisable_bypass_permissions_mode\s*=\s*true\b/i.test(text)
        || /^\s*yolo\s*=\s*false\b/im.test(text)
      )) return label;
    }
    return null;
  }

  #verifiedConfigMode(): "acceptEdits" | "dontAsk" | null {
    const workspace = currentWorkspace(this.projectPath);
    const home = process.env.HOME || os.homedir();
    const sources = [
      path.join(home, ".claude", "settings.json"),
      path.join(home, ".claude", "settings.local.json"),
      ...workspaceDirectories(workspace).flatMap((directory) => [
        path.join(directory, ".claude", "settings.json"),
        path.join(directory, ".claude", "settings.local.json"),
      ]),
    ];
    let effective: SupportedDefaultMode | null = null;
    for (const source of sources) {
      const mode = readDefaultMode(source);
      if (mode) effective = mode;
    }
    return effective === "acceptEdits" || effective === "dontAsk" ? effective : null;
  }
}

type SupportedDefaultMode = "default" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "plan";

function readDefaultMode(file: string): SupportedDefaultMode | null {
  const text = readText(file);
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const permissions = value.permissions && typeof value.permissions === "object" && !Array.isArray(value.permissions)
      ? value.permissions as Record<string, unknown>
      : null;
    const candidate = permissions && Object.hasOwn(permissions, "defaultMode")
      ? permissions.defaultMode
      : value.defaultMode;
    return candidate === "default" || candidate === "acceptEdits" || candidate === "bypassPermissions" || candidate === "dontAsk" || candidate === "plan"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function workspaceDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    directories.push(current);
    if (fs.existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) return [path.resolve(cwd)];
    current = parent;
  }
  return directories.reverse();
}

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1_000_000) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
