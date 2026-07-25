import { spawn } from "node:child_process";
import path from "node:path";
import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { TerminalRunRequestSchema, type GrokHomeProfileStatus, type GrokHomeProfileSwitchResult, type RendererBootstrap } from "../shared/contracts.js";
import type { BackendProcess } from "./BackendProcess.js";
import type { LanShareService } from "./LanShareService.js";
import { TerminalSessionManager } from "./TerminalSessionManager.js";
import { TextClipStore } from "./TextClipStore.js";
import { isTrustedRendererFrame } from "./policy.js";
import { canonicalDroppedDirectories, optionalProjectId, validProjectId } from "./shellInputValidation.js";

export interface ShellIpcOptions {
  backend: BackendProcess;
  lanShare: LanShareService;
  window: () => BrowserWindow | null;
  chooseProject: (window: BrowserWindow | null) => Promise<void>;
  registerProjects: (directories: string[]) => Promise<void>;
  textClips: TextClipStore;
  bootstrap: (window: BrowserWindow | null) => RendererBootstrap;
  grokHomeStatus: () => GrokHomeProfileStatus;
  switchGrokHome: (profileId: string) => Promise<GrokHomeProfileSwitchResult>;
  chooseCustomGrokHome: (window: BrowserWindow | null) => Promise<GrokHomeProfileSwitchResult>;
  rememberProject: (projectId: string) => Promise<void>;
  saveWindowRoute: (window: BrowserWindow | null, route: string) => void;
  isTaskForeground: (taskId: string) => boolean;
  focusTask: (taskId: string) => void;
}

export function registerShellIpc(options: ShellIpcOptions): () => void {
  const terminals = new TerminalSessionManager();
  const handledNotifications = new Set<string>();
  const activeNotifications = new Set<Notification>();
  const registeredChannels = new Set<string>();
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void => {
    if (registeredChannels.has(channel)) throw new Error(`IPC channel ${channel} is already registered.`);
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedShellIpc(event, options.backend.port);
      return listener(event, ...args);
    });
    registeredChannels.add(channel);
  };
  handle("grok-shell:bootstrap", (event) => options.bootstrap(senderWindow(event.sender)));
  handle("grok-shell:grok-home-status", () => options.grokHomeStatus());
  handle("grok-shell:grok-home-select", (_event, profileId: unknown) =>
    options.switchGrokHome(validText(profileId, 96, "Grok Home profile")));
  handle("grok-shell:grok-home-choose-custom", (event) => options.chooseCustomGrokHome(senderWindow(event.sender)));
  handle("grok-shell:lan-share-status", () => options.lanShare.status());
  handle("grok-shell:lan-share-set", async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (typeof value.enabled !== "boolean") throw new Error("LAN sharing requires an explicit enabled state.");
    const preferredPort = value.preferredPort === undefined ? undefined : validPort(value.preferredPort);
    return value.enabled ? options.lanShare.enable(preferredPort) : options.lanShare.stop();
  });
  handle("grok-shell:choose-project", async (event) => {
    await options.chooseProject(senderWindow(event.sender));
    return { changed: true };
  });
  handle("grok-shell:remember-project", (_event, projectId: unknown) =>
    options.rememberProject(validProjectId(projectId)));
  handle("grok-shell:window-route", (event, route: unknown) => {
    options.saveWindowRoute(senderWindow(event.sender), validRoute(route));
  });
  handle("grok-shell:register-workspace-folders", async (_event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const directories = canonicalDroppedDirectories(value.paths);
    await options.registerProjects(directories);
    return { changed: true, count: directories.length };
  });
  handle("grok-shell:set-badge", (_event, count: unknown) => {
    const value = typeof count === "number" && Number.isInteger(count) ? Math.max(0, Math.min(999, count)) : 0;
    app.dock?.setBadge(value ? String(value) : "");
  });
  handle("grok-shell:notify-task", (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const notificationId = validText(value.notificationId, 1_024, "notification id");
    const taskId = validUuid(value.taskId, "task id");
    if (handledNotifications.has(notificationId)) return false;
    handledNotifications.add(notificationId);
    if (handledNotifications.size > 2_048) {
      for (const key of [...handledNotifications].slice(0, 1_024)) handledNotifications.delete(key);
    }
    if (options.isTaskForeground(taskId)) return false;
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: validText(value.title, 120, "title"),
      body: validText(value.body, 500, "body"),
    });
    activeNotifications.add(notification);
    const release = () => activeNotifications.delete(notification);
    notification.once("click", () => { release(); options.focusTask(taskId); });
    notification.once("close", release);
    notification.show();
    return true;
  });
  handle("grok-shell:open-terminal", () => {
    return options.backend.activeProjectPath().then((directory) => {
      const child = spawn("/usr/bin/open", ["-a", "Terminal", directory], { detached: true, stdio: "ignore", shell: false });
      child.unref();
    });
  });
  handle("grok-shell:terminal-start", async (event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const sessionId = validUuid(value.sessionId, "terminal session id");
    const projectId = optionalProjectId(value.projectId);
    const columns = validInteger(value.columns, 20, 320, "terminal columns");
    const rows = validInteger(value.rows, 5, 120, "terminal rows");
    const run = value.run == null ? undefined : TerminalRunRequestSchema.parse(value.run);
    const window = senderWindow(event.sender);
    if (!window) throw new Error("Terminal window is unavailable.");
    return terminals.start(sessionId, await options.backend.projectPath(projectId), { columns, rows, run }, window);
  });
  handle("grok-shell:terminal-write", (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    terminals.write(validUuid(value.sessionId, "terminal session id"), validText(value.data, 65_536, "terminal input"));
  });
  handle("grok-shell:terminal-resize", (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    terminals.resize(
      validUuid(value.sessionId, "terminal session id"),
      validInteger(value.columns, 20, 320, "terminal columns"),
      validInteger(value.rows, 5, 120, "terminal rows"),
    );
  });
  handle("grok-shell:terminal-stop", (_event, sessionId: unknown) => {
    terminals.stop(validUuid(sessionId, "terminal session id"));
  });
  handle("grok-shell:open-themes", () => shell.openPath(path.join(options.backend.appHome, "themes")));
  handle("grok-shell:choose-paths", async (event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : { mode: raw };
    const mode = value.mode;
    const projectId = optionalProjectId(value.projectId);
    if (mode !== "files" && mode !== "folder") throw new Error("Unsupported attachment picker mode.");
    const window = senderWindow(event.sender) || options.window();
    const projectPath = await options.backend.projectPath(projectId);
    let files: string[] = [];
    if (mode === "files") {
      const result = window
        ? await dialog.showOpenDialog(window, { title: "Choose paths", defaultPath: projectPath, properties: ["openFile", "multiSelections"] })
        : await dialog.showOpenDialog({ title: "Choose paths", defaultPath: projectPath, properties: ["openFile", "multiSelections"] });
      if (!result.canceled) files = result.filePaths;
    } else {
      const folderResult = window
        ? await dialog.showOpenDialog(window, { title: "Choose a folder", defaultPath: projectPath, properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ title: "Choose a folder", defaultPath: projectPath, properties: ["openDirectory"] });
      const folder = folderResult.filePaths[0];
      if (folderResult.canceled || !folder) return [];
      files = [folder];
    }
    return Promise.all(files.map((file) => options.backend.registerPath(file, projectId)));
  });
  handle("grok-shell:register-dropped-paths", async (_event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (!Array.isArray(value.paths) || value.paths.length === 0) throw new Error("Invalid dropped paths.");
    const files = value.paths.map((item) => validText(item, 4096, "path"));
    const projectId = optionalProjectId(value.projectId);
    return Promise.all(files.map((file) => options.backend.registerPath(file, projectId)));
  });
  handle("grok-shell:create-text-clip", async (_event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const text = validText(value.text, 5_000_000, "pasted text");
    if ([...text].length <= 1_000) throw new Error("Text clips are reserved for pastes longer than 1000 characters.");
    const ownerKey = validOwnerKey(value.ownerKey);
    const projectId = optionalProjectId(value.projectId);
    const clip = options.textClips.create(text, ownerKey);
    try {
      const reference = await options.backend.registerPath(clip.absolutePath, projectId);
      options.textClips.attachReference(clip.clipId, reference.refId);
      return reference;
    } catch (error) {
      options.textClips.remove(clip.clipId);
      throw error;
    }
  });
  handle("grok-shell:transfer-text-clips", (_event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return { count: options.textClips.transferOwner(validOwnerKey(value.fromOwnerKey), validOwnerKey(value.toOwnerKey)) };
  });
  handle("grok-shell:release-text-clips", (_event, ownerKey: unknown) => ({
    count: options.textClips.releaseOwner(validOwnerKey(ownerKey)),
  }));
  handle("grok-shell:restore-paths", async (_event, raw: unknown) => {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (!Array.isArray(value.paths)) throw new Error("Invalid saved paths.");
    const projectId = optionalProjectId(value.projectId);
    const projectPath = await options.backend.projectPath(projectId);
    return Promise.all(value.paths.map(async (rawPath) => {
      const saved = rawPath && typeof rawPath === "object" ? rawPath as Record<string, unknown> : {};
      const displayPath = validText(saved.displayPath, 4096, "saved path");
      const withinProject = saved.withinProject === true;
      const candidate = withinProject ? path.resolve(projectPath, displayPath) : displayPath;
      if (withinProject && path.relative(projectPath, candidate).startsWith("..")) throw new Error("Saved project path escaped its project.");
      if (!withinProject && !path.isAbsolute(candidate)) throw new Error("Saved external path is not absolute.");
      try {
        const restored = await options.backend.registerPath(candidate, projectId);
        if (typeof saved.refId === "string") options.textClips.rebindReference(saved.refId, restored.refId);
        return restored;
      }
      catch { return { ...saved, valid: false }; }
    }));
  });
  handle("grok-shell:reveal-path", async (_event, refId: unknown) => {
    const file = await options.backend.resolvePath(validText(refId, 64, "path reference"));
    shell.showItemInFolder(file);
  });
  handle("grok-shell:reveal-media", async (_event, taskId: unknown, mediaId: unknown) => {
    const file = await options.backend.resolveMedia(validUuid(taskId, "task id"), validUuid(mediaId, "media id"));
    shell.showItemInFolder(file);
  });
  handle("grok-shell:run-artifact-action", async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const runId = validUuid(value.runId, "run id");
    const artifactId = validUuid(value.artifactId, "artifact id");
    if (value.action !== "open" && value.action !== "reveal") throw new Error("Unsupported artifact action.");
    const file = await options.backend.resolveRunArtifact(runId, artifactId);
    if (value.action === "reveal") shell.showItemInFolder(file);
    else {
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    }
  });
  return () => {
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    registeredChannels.clear();
    terminals.dispose();
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
  };
}

function assertTrustedShellIpc(event: IpcMainInvokeEvent, port: number): void {
  const frame = event.senderFrame;
  if (!frame || !isTrustedRendererFrame(frame.url, frame === event.sender.mainFrame, port)) {
    throw new Error("Rejected IPC request from an untrusted renderer frame.");
  }
}

function senderWindow(contents: WebContents): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(contents);
  return window && !window.isDestroyed() ? window : null;
}

function validText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}

function validRoute(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  if (text === "/new" || /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) || /^\/settings(?:\/[a-z0-9_-]+){0,2}$/i.test(text)) return text;
  throw new Error("Invalid application route.");
}

function validPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error("LAN port must be an integer from 1024 to 65535.");
  }
  return value;
}

function validUuid(value: unknown, label: string): string {
  const text = typeof value === "string" ? value : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function validInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${label}.`);
  return value;
}

function validOwnerKey(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  if (!/^[a-z0-9:._-]{1,256}$/i.test(text)) throw new Error("Invalid text clip owner key.");
  return text;
}
