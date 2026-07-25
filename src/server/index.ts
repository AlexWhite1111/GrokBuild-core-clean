import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import {
  APP_HOME,
  APP_STATE_FILE,
  APP_VERSION,
  EXPECTED_ORIGIN,
  GROK_BIN,
  GROK_HOME,
  GROK_HOME_ID,
  HOST,
  LAUNCH_TOKEN,
  MEDIA_CACHE_HOME,
  PORT,
  PREVIEW_CACHE_HOME,
  RUNS_HOME,
  SHELL_TOKEN,
  THEME_ASSETS_HOME,
  THEMES_HOME,
  WORKSPACE,
} from "./config.js";
import { CapabilityRegistry } from "./grok/CapabilityRegistry.js";
import { registerV1Routes } from "./http/registerV1Routes.js";
import { registerManagementV1Routes } from "./http/registerManagementV1Routes.js";
import { registerShellRoutes } from "./http/registerShellRoutes.js";
import { createManagementServices } from "./management/ManagementServices.js";
import { PermissionCapabilityResolver } from "./permissions/PermissionCapabilityResolver.js";
import { ProjectStore } from "./projects/ProjectStore.js";
import { attachTaskSocketServer } from "./protocol/TaskSocketServer.js";
import { requireApiSecurity } from "./security/apiSecurity.js";
import { PathReferenceStore } from "./security/PathReferenceStore.js";
import { AppProblem, sendAppProblem } from "./security/problemResponse.js";
import { JsonStateStore } from "./storage/JsonStateStore.js";
import { UiStateStore } from "./storage/UiStateStore.js";
import { TaskSupervisor } from "./tasks/TaskSupervisor.js";
import { ThemeRepository } from "./themes/ThemeRepository.js";
import { MediaArtifactStore } from "./media/MediaArtifactStore.js";
import { registerMediaRoutes } from "./http/registerMediaRoutes.js";
import { RichTextRenderService } from "./rendering/RichTextRenderService.js";
import { LocalRunService } from "./runtime/LocalRunService.js";
import { registerLocalRunRoutes } from "./http/registerLocalRunRoutes.js";
import { SourceControlService } from "./sourceControl/SourceControlService.js";
import { TextClipAuthorityStore } from "./storage/TextClipAuthorityStore.js";
import { PreviewRuntimeService } from "./preview/PreviewRuntimeService.js";
import { registerPreviewRuntimeRoutes } from "./http/registerPreviewRuntimeRoutes.js";
import { OwnedProcessRegistry } from "./runtime/OwnedProcessRegistry.js";

fs.mkdirSync(APP_HOME, { recursive: true, mode: 0o700 });
fs.mkdirSync(GROK_HOME, { recursive: true, mode: 0o700 });
const startedAt = new Date().toISOString();
const state = new JsonStateStore(APP_STATE_FILE);
const uiState = new UiStateStore(state);
const projects = new ProjectStore(state);
const project = projects.addProject(WORKSPACE);
const activeWorkspace = () => {
  const active = projects.list().find((item) => item.active) || projects.list()[0];
  return active ? projects.getCanonicalPath(active.projectId) : WORKSPACE;
};
const processes = new OwnedProcessRegistry();
const capabilities = new CapabilityRegistry({ binary: GROK_BIN, grokHome: GROK_HOME, workspace: activeWorkspace, processes });
const permissionResolver = new PermissionCapabilityResolver(GROK_HOME, activeWorkspace);
const management = createManagementServices(GROK_BIN, activeWorkspace, GROK_HOME, processes);
const media = new MediaArtifactStore({ cacheDirectory: MEDIA_CACHE_HOME });
const supervisor = new TaskSupervisor({
  state,
  projects,
  grokBin: GROK_BIN,
  grokHome: GROK_HOME,
  grokHomeId: GROK_HOME_ID,
  permissionCapabilities: permissionResolver.resolve(),
  media,
  processes,
  ensureTaskCreationAllowed: async () => {
    const capabilitySnapshot = await capabilities.get();
    const account = await management.account.snapshot(capabilitySnapshot.acp.authMethods);
    if (!account.account.authenticated) {
      throw new AppProblem(401, "AUTH_REQUIRED", "Sign in to the active Grok Home before starting or resuming a task.");
    }
  },
});
const themes = new ThemeRepository(state, THEMES_HOME, THEME_ASSETS_HOME);
const paths = new PathReferenceStore();
const richText = new RichTextRenderService();
const localRuns = new LocalRunService(RUNS_HOME, activeWorkspace, undefined, undefined, processes);
const previews = new PreviewRuntimeService(PREVIEW_CACHE_HOME);
const sourceControl = new SourceControlService(
  (projectId) => supervisor.projectPath(projectId),
  (projectIds) => supervisor.projectsSourceControlLocked(projectIds),
  (directory) => supervisor.projectIdForCanonicalPath(directory),
  "/usr/bin/git",
  (projectIds, operation) => supervisor.withProjectsSourceControlWriteLease(projectIds, operation),
  processes,
);
capabilities.on("changed", (snapshot) => supervisor.setPermissionCapabilities(permissionResolver.resolve(snapshot)));
supervisor.on("project.changed", () => {
  void capabilities.refresh().catch((error) => console.error("[grok-build] project capability scan failed", error instanceof Error ? error.message : String(error)));
});
const app = express();
const server = http.createServer(app);

app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use("/api/v1", requireApiSecurity({ expectedOrigin: EXPECTED_ORIGIN, launchToken: LAUNCH_TOKEN }));
app.use("/internal/v1", requireApiSecurity({ expectedOrigin: EXPECTED_ORIGIN, launchToken: SHELL_TOKEN }));
registerV1Routes(app, { supervisor, themes, paths, media, capabilities, uiState, richText, account: management.account, sourceControl, appVersion: APP_VERSION, startedAt });
registerManagementV1Routes(app, management, capabilities);
registerShellRoutes(app, supervisor, paths, media, new TextClipAuthorityStore(state));
registerMediaRoutes(app, media, EXPECTED_ORIGIN);
registerLocalRunRoutes(app, localRuns);
registerPreviewRuntimeRoutes(app, previews, (taskId) => {
  if (!taskId) return supervisor.activeProjectPath();
  try {
    const task = supervisor.detail(taskId);
    return supervisor.projectPath(task.snapshot.projectId);
  } catch {
    return supervisor.activeProjectPath();
  }
});

const distDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
if (fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory, {
    index: false,
    setHeaders: (res, file) => {
      const relative = path.relative(distDirectory, file).split(path.sep).join("/");
      if (relative === "index.html" || relative === "manifest.webmanifest") res.setHeader("Cache-Control", "no-store");
      else if (relative.startsWith("assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.get("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AppProblem) {
    sendAppProblem(res, error);
    return;
  }
  if (error instanceof ZodError) {
    sendAppProblem(res, new AppProblem(400, "VALIDATION_FAILED", error.issues.map((issue) => issue.message).join("; ")));
    return;
  }
  console.error("[grok-build] request failed", error instanceof Error ? error.message : "unknown error");
  sendAppProblem(res, new AppProblem(500, "INTERNAL_ERROR", "The local service could not complete the request."));
});

const sockets = attachTaskSocketServer(server, { expectedOrigin: EXPECTED_ORIGIN, launchToken: LAUNCH_TOKEN, supervisor, localRuns });
server.listen(PORT, HOST, () => {
  console.log(`[grok-build] ready http://${HOST}:${PORT} project=${project.projectId}`);
  void capabilities.refresh().catch((error) => console.error("[grok-build] capability scan failed", error instanceof Error ? error.message : String(error)));
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  console.log(`[grok-build] ${signal}; shutting down`);
  processes.beginShutdown();
  sockets.closeClients();
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  await supervisor.shutdown();
  management.stop();
  localRuns.stop();
  await processes.shutdown();
  paths.close();
  media.close();
  sockets.close();
  await serverClosed;
  clearTimeout(forceExit);
  process.exit(0);
}

process.once("beforeExit", () => processes.beginShutdown());
process.on("SIGINT", () => void shutdown("SIGINT")); process.on("SIGTERM", () => void shutdown("SIGTERM"));
