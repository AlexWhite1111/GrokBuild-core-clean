import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  shell,
  type OpenDialogOptions,
  type Rectangle,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RendererBootstrap, ThemeLibrarySnapshot, ThemeManifestV1 } from "../shared/contracts.js";
import { installApplicationMenu } from "./ApplicationMenu.js";
import { BackendProcess } from "./BackendProcess.js";
import { GrokHomeProfiles } from "./GrokHomeProfiles.js";
import { LanShareService } from "./LanShareService.js";
import { installQuitCoordinator } from "./QuitCoordinator.js";
import { registerShellIpc } from "./ShellIpc.js";
import { startTextClipLifecycle } from "./TextClipLifecycle.js";
import { TextClipStore } from "./TextClipStore.js";
import { initialWindowBounds, loadWindowStates, MAX_WINDOW_COUNT, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, normalizedWindowRoute, persistWindowStates, type SavedWindowState } from "./WindowState.js";
import { loadWorkspace, locateGrokBinary, persistWorkspace, validDirectory } from "./WorkspaceState.js";
import { isAllowedRendererPermission, isSafeExternalUrl, isTrustedAppUrl } from "./policy.js";
import { registrationOrderForFirstActive } from "./shellInputValidation.js";

interface WindowRuntime {
  windowId: string;
  window: BrowserWindow;
  route: string;
  bounds: Rectangle;
  maximized: boolean;
  startupTheme?: ThemeManifestV1;
}

app.setName("Grok Build");
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(sourceDirectory, "preload.cjs");
const serverSourceDirectory = app.isPackaged
  ? sourceDirectory.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  : sourceDirectory;
const serverEntry = path.resolve(serverSourceDirectory, "../../dist-server/server/index.js");
const windows = new Map<string, WindowRuntime>();
let lastFocusedWindowId: string | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", () => restoreWindow(activeWindow()));

void app.whenReady().then(async () => {
  const shellHome = !app.isPackaged && process.env.GROK_GUI_TEST_HOME
    ? path.resolve(process.env.GROK_GUI_TEST_HOME)
    : path.join(app.getPath("userData"), "Rebuild");
  const grokHomes = new GrokHomeProfiles(shellHome);
  const activeProfile = grokHomes.active();
  const appHome = activeProfile.appHome;
  fs.mkdirSync(appHome, { recursive: true, mode: 0o700 });
  app.setAppLogsPath(path.join(shellHome, "logs"));
  const workspaceFile = path.join(appHome, "workspace.json");
  const windowsFile = path.join(appHome, "windows.json");
  const workspace = loadWorkspace(workspaceFile, app.isPackaged, path.join(shellHome, "workspace.json"));
  persistWorkspace(workspaceFile, workspace);
  const textClips = new TextClipStore(path.join(app.getPath("temp"), "com.alexwhite.grokbuild", "text-clips"));
  const backend = new BackendProcess({
    serverEntry,
    appHome,
    grokHome: activeProfile.grokHome,
    grokHomeId: activeProfile.summary.id,
    grokBin: locateGrokBinary(),
    workspace,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
  });
  const lanShare = new LanShareService({ backendBootstrap: () => backend.bootstrap() });
  backend.on("log", (scope, message) => log(String(scope), String(message)));
  backend.on("exit", (code) => {
    void lanShare.stop();
    log("backend:exit", String(code));
    const target = activeWindow();
    if (code) void (target ? dialog.showMessageBox(target, backendExitMessage(code)) : dialog.showMessageBox(backendExitMessage(code)));
  });
  await backend.start();
  const stopTextClipLifecycle = await startTextClipLifecycle(textClips, backend, (message) => log("text-clips", message));

  const broadcast = (channel: string, value?: unknown) => {
    for (const runtime of windows.values()) if (!runtime.window.isDestroyed()) runtime.window.webContents.send(channel, value);
  };
  const saveWindows = () => persistWindowStates(windowsFile, [...windows.values()].map((runtime) => ({
    windowId: runtime.windowId,
    route: runtime.route,
    bounds: runtime.bounds,
    maximized: runtime.maximized,
  })));
  const registerProjects = async (directories: string[]) => {
    if (!directories.length) return;
    for (const directory of registrationOrderForFirstActive(directories)) await backend.registerProject(directory);
    persistWorkspace(workspaceFile, directories[0]);
    broadcast("grok-shell:project-changed");
  };
  const chooseProject = async (parent: BrowserWindow | null = activeWindow()) => {
    const options = { title: "Open a Grok project", defaultPath: backend.workspace, properties: ["openDirectory", "createDirectory"] as OpenDialogOptions["properties"] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return;
    const selectedWorkspace = validDirectory(selected, os.homedir());
    if (selectedWorkspace !== backend.workspace) await registerProjects([selectedWorkspace]);
  };
  const rememberProject = async (projectId: string) => {
    const directory = await backend.projectPath(projectId);
    backend.rememberWorkspace(directory);
    persistWorkspace(workspaceFile, directory);
  };

  lanShare.on("changed", (status) => broadcast("grok-shell:lan-share-changed", status));
  let quitting = false;
  const quitCoordinator = installQuitCoordinator(backend, activeWindow, () => {
    for (const runtime of windows.values()) updateWindowState(runtime);
    quitting = true;
    saveWindows();
  });
  const switchGrokHome = async (profileId: string) => {
    const current = grokHomes.status();
    const target = current.profiles.find((profile) => profile.id === profileId);
    if (!target || !target.available) throw new Error("The selected Grok Home is not available.");
    if (target.active) return { changed: false, status: current };
    const changed = await quitCoordinator.relaunch(() => { grokHomes.select(profileId); });
    return { changed, status: grokHomes.status() };
  };
  const chooseCustomGrokHome = async (parent: BrowserWindow | null) => {
    const current = grokHomes.status();
    const options: OpenDialogOptions = { title: "Choose or create a Grok Home", defaultPath: current.profiles.find((profile) => profile.active)?.path, properties: ["openDirectory", "createDirectory"] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return { changed: false, status: current };
    const directory = fs.realpathSync.native(selected);
    if (!fs.statSync(directory).isDirectory()) throw new Error("The selected Grok Home is not available.");
    if (current.profiles.some((profile) => profile.active && profile.path === directory)) return { changed: false, status: current };
    const changed = await quitCoordinator.relaunch(() => { grokHomes.registerAndSelect(directory); });
    return { changed, status: grokHomes.status() };
  };

  const openWindow = async (saved?: SavedWindowState): Promise<BrowserWindow | null> => {
    if (windows.size >= MAX_WINDOW_COUNT) { restoreWindow(activeWindow()); return activeWindow(); }
    const windowId = saved?.windowId || randomUUID();
    const route = normalizedWindowRoute(saved?.route);
    const startupTheme = await resolveStartupTheme(backend);
    const bounds = initialWindowBounds(saved?.bounds, windows.size);
    const window = new BrowserWindow({
      ...bounds,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      title: "Grok Build",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 14 },
      backgroundColor: electronBackground(startupTheme),
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: true },
    });
    const runtime: WindowRuntime = { windowId, window, route, bounds, maximized: saved?.maximized === true, startupTheme };
    windows.set(windowId, runtime);
    lastFocusedWindowId = windowId;
    let saveTimer: NodeJS.Timeout | undefined;
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { updateWindowState(runtime); saveWindows(); }, 250);
    };
    window.on("resize", scheduleSave);
    window.on("move", scheduleSave);
    window.on("maximize", scheduleSave);
    window.on("unmaximize", scheduleSave);
    window.on("focus", () => { lastFocusedWindowId = windowId; });
    hardenWindow(window, backend.port);
    window.once("ready-to-show", () => {
      window.show();
      if (runtime.maximized) window.maximize();
    });
    window.on("closed", () => {
      clearTimeout(saveTimer);
      windows.delete(windowId);
      if (!quitting) saveWindows();
    });
    await window.loadURL(startupUrl(backend.port, startupTheme));
    return window;
  };

  const disposeShellIpc = registerShellIpc({
    backend,
    lanShare,
    textClips,
    window: activeWindow,
    bootstrap: (window): RendererBootstrap => {
      const runtime = runtimeFor(window);
      return runtime ? { ...backend.bootstrap(), windowId: runtime.windowId, initialRoute: runtime.route, startupTheme: runtime.startupTheme } : backend.bootstrap();
    },
    chooseProject,
    registerProjects,
    rememberProject,
    saveWindowRoute: (window, route) => {
      const runtime = runtimeFor(window);
      if (!runtime || runtime.route === route) return;
      runtime.route = normalizedWindowRoute(route);
      saveWindows();
    },
    isTaskForeground: (taskId) => {
      const route = `/tasks/${taskId}`;
      return [...windows.values()].some((runtime) =>
        !runtime.window.isDestroyed()
        && runtime.window.isFocused()
        && runtime.route === route);
    },
    focusTask: (taskId) => {
      const route = `/tasks/${taskId}`;
      const matching = [...windows.values()].find((runtime) =>
        !runtime.window.isDestroyed() && runtime.route === route);
      const target = matching || runtimeFor(activeWindow());
      if (!target) return;
      target.route = route;
      saveWindows();
      target.window.webContents.send("grok-shell:open-task", taskId);
      restoreWindow(target.window);
    },
    grokHomeStatus: () => grokHomes.status(),
    switchGrokHome,
    chooseCustomGrokHome,
  });
  app.on("will-quit", () => { stopTextClipLifecycle(); disposeShellIpc(); void lanShare.stop(); });
  installApplicationMenu({
    window: activeWindow,
    newWindow: () => { void openWindow(); },
    newTask: () => activeWindow()?.webContents.send("grok-shell:new-task"),
    openProject: () => { void chooseProject(); },
    toggleSidebar: () => activeWindow()?.webContents.send("grok-shell:toggle-sidebar"),
    commandPalette: () => activeWindow()?.webContents.send("grok-shell:command-palette"),
  });

  const restored = loadWindowStates(windowsFile, path.join(shellHome, "window.json"));
  for (const state of restored.length ? restored : [undefined]) await openWindow(state);
  saveWindows();
  app.on("activate", () => { if (windows.size) restoreWindow(activeWindow()); else void openWindow(); });
}).catch((error) => {
  log("startup", error instanceof Error ? error.message : String(error));
  void dialog.showMessageBox({ type: "error", title: "Grok Build", message: startupFailureMessage() }).finally(() => app.quit());
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

function activeWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && [...windows.values()].some((runtime) => runtime.window === focused)) return focused;
  if (lastFocusedWindowId) {
    const last = windows.get(lastFocusedWindowId)?.window;
    if (last && !last.isDestroyed()) return last;
  }
  return [...windows.values()].find((runtime) => !runtime.window.isDestroyed())?.window || null;
}

function runtimeFor(window: BrowserWindow | null): WindowRuntime | null {
  if (!window) return null;
  return [...windows.values()].find((runtime) => runtime.window === window) || null;
}

function updateWindowState(runtime: WindowRuntime): void {
  if (runtime.window.isDestroyed()) return;
  runtime.bounds = runtime.window.getNormalBounds();
  runtime.maximized = runtime.window.isMaximized();
}

function restoreWindow(window: BrowserWindow | null): void {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function resolveStartupTheme(backend: BackendProcess): Promise<ThemeManifestV1 | undefined> {
  try {
    const library = await backend.request<ThemeLibrarySnapshot>("GET", "/api/v1/themes");
    const themeId = library.followSystem
      ? nativeTheme.shouldUseDarkColors ? library.systemDarkThemeId : library.systemLightThemeId
      : library.selectedThemeId;
    return await backend.request<ThemeManifestV1>("GET", `/api/v1/themes/${encodeURIComponent(themeId)}`);
  } catch (error) {
    log("theme", `Startup theme fallback: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function startupUrl(port: number, theme?: ThemeManifestV1): string {
  const url = new URL(`http://127.0.0.1:${port}`);
  if (theme) {
    url.searchParams.set("startupAppearance", theme.appearance);
    url.searchParams.set("startupCanvas", theme.colors.canvas);
    url.searchParams.set("startupText", theme.colors.text);
  }
  return url.toString();
}

function electronBackground(theme?: ThemeManifestV1): string {
  const canvas = theme?.colors.canvas;
  return typeof canvas === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(canvas)
    ? canvas
    : (theme?.appearance === "light" || !theme && !nativeTheme.shouldUseDarkColors) ? "#f5f2eb" : "#171716";
}

function backendExitMessage(code: number) {
  return { type: "error" as const, title: "Grok Build", message: "服务已停止 / Service stopped", detail: `Exit code: ${code}` };
}

function startupFailureMessage(): string {
  return app.getLocale().toLowerCase().startsWith("zh") ? "启动失败" : "Startup failed";
}

function hardenWindow(window: BrowserWindow, port: number): void {
  window.webContents.setWindowOpenHandler(({ url }) => { if (isSafeExternalUrl(url)) void shell.openExternal(url); return { action: "deny" }; });
  window.webContents.on("will-navigate", (event, url) => { if (isTrustedAppUrl(url, port)) return; event.preventDefault(); if (isSafeExternalUrl(url)) void shell.openExternal(url); });
  window.webContents.session.setPermissionCheckHandler((_contents, permission, origin) => isAllowedRendererPermission(permission, origin, port));
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(isAllowedRendererPermission(permission, contents.getURL(), port)));
}

function log(scope: string, message: string): void {
  if (!message) return;
  try {
    fs.mkdirSync(app.getPath("logs"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("logs"), "grok-build.log"), `${new Date().toISOString()} [${scope}] ${message}\n`, { mode: 0o600 });
  } catch { /* Logging must never prevent app shutdown. */ }
}
