const { contextBridge, ipcRenderer, webUtils } = require("electron");

const listen = (channel, callback) => {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, ...values) => callback(...values);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const localPaths = (files) => {
  const dropped = Array.from(files || []);
  if (!dropped.length) return Promise.reject(new Error("A drop must contain a local filesystem item."));
  const paths = dropped.flatMap((file) => {
    try {
      const value = webUtils.getPathForFile(file);
      return value ? [value] : [];
    } catch {
      return [];
    }
  });
  if (paths.length !== dropped.length) {
    return Promise.reject(new Error("One or more dropped items do not expose a local filesystem path."));
  }
  return paths;
};

const registerDroppedFiles = (files, projectId) => {
  const paths = localPaths(files);
  return paths instanceof Promise ? paths : ipcRenderer.invoke("grok-shell:register-dropped-paths", { paths, projectId });
};

const registerWorkspaceFolders = (files) => {
  const paths = localPaths(files);
  return paths instanceof Promise ? paths : ipcRenderer.invoke("grok-shell:register-workspace-folders", { paths });
};

if (process.isMainFrame) contextBridge.exposeInMainWorld("grokDesktop", Object.freeze({
  getBootstrap: () => ipcRenderer.invoke("grok-shell:bootstrap"),
  getGrokHomeProfiles: () => ipcRenderer.invoke("grok-shell:grok-home-status"),
  selectGrokHome: (profileId) => ipcRenderer.invoke("grok-shell:grok-home-select", profileId),
  chooseCustomGrokHome: () => ipcRenderer.invoke("grok-shell:grok-home-choose-custom"),
  getLanShareStatus: () => ipcRenderer.invoke("grok-shell:lan-share-status"),
  setLanShare: (input) => ipcRenderer.invoke("grok-shell:lan-share-set", input),
  chooseProject: () => ipcRenderer.invoke("grok-shell:choose-project"),
  rememberProject: (projectId) => ipcRenderer.invoke("grok-shell:remember-project", projectId),
  setWindowRoute: (route) => ipcRenderer.invoke("grok-shell:window-route", route),
  registerWorkspaceFolders,
  setAttentionCount: (count) => ipcRenderer.invoke("grok-shell:set-badge", count),
  notifyTask: (value) => ipcRenderer.invoke("grok-shell:notify-task", value),
  openTerminal: () => ipcRenderer.invoke("grok-shell:open-terminal"),
  startTerminal: (input) => ipcRenderer.invoke("grok-shell:terminal-start", input),
  writeTerminal: (input) => ipcRenderer.invoke("grok-shell:terminal-write", input),
  resizeTerminal: (input) => ipcRenderer.invoke("grok-shell:terminal-resize", input),
  stopTerminal: (sessionId) => ipcRenderer.invoke("grok-shell:terminal-stop", sessionId),
  openThemesDirectory: () => ipcRenderer.invoke("grok-shell:open-themes"),
  choosePaths: (mode, projectId) => ipcRenderer.invoke("grok-shell:choose-paths", { mode, projectId }),
  registerDroppedFiles,
  createTextClip: (input) => ipcRenderer.invoke("grok-shell:create-text-clip", input),
  transferTextClips: (input) => ipcRenderer.invoke("grok-shell:transfer-text-clips", input),
  releaseTextClips: (ownerKey) => ipcRenderer.invoke("grok-shell:release-text-clips", ownerKey),
  restorePaths: (paths, projectId) => ipcRenderer.invoke("grok-shell:restore-paths", { paths, projectId }),
  revealPath: (refId) => ipcRenderer.invoke("grok-shell:reveal-path", refId),
  revealMedia: (taskId, mediaId) => ipcRenderer.invoke("grok-shell:reveal-media", taskId, mediaId),
  runArtifactAction: (input) => ipcRenderer.invoke("grok-shell:run-artifact-action", input),
  onNewTask: (callback) => listen("grok-shell:new-task", callback),
  onToggleSidebar: (callback) => listen("grok-shell:toggle-sidebar", callback),
  onCommandPalette: (callback) => listen("grok-shell:command-palette", callback),
  onSettings: (callback) => listen("grok-shell:settings", callback),
  onProjectChanged: (callback) => listen("grok-shell:project-changed", callback),
  onOpenTask: (callback) => listen("grok-shell:open-task", callback),
  onLanShareChanged: (callback) => listen("grok-shell:lan-share-changed", callback),
  onTerminalData: (callback) => listen("grok-shell:terminal-data", callback),
  onTerminalExit: (callback) => listen("grok-shell:terminal-exit", callback),
}));
