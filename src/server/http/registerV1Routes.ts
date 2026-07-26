import type { Express } from "express";
import { z } from "zod";
import {
  GateDecisionSchema,
  MutationRequestSchema,
  ProjectIdSchema,
  ProjectDefaultsMutationSchema,
  ProjectMutationSchema,
  TaskCreateSchema,
  QueueMutationSchema,
  ComposerRichTextPreviewRequestSchema,
  RemoteMarkdownImageRequestSchema,
  RichTextRenderRequestSchema,
  TaskConfigMutationSchema,
  TaskCommandMutationSchema,
  TaskGoalMutationSchema,
  TaskWorkModeMutationSchema,
  TaskWorkStopSchema,
  TaskInterjectSchema,
  TaskForkSchema,
  TaskPromptSchema,
  TaskRewindAndPromptSchema,
  TaskQueueSubmitSchema,
  TaskResumeSchema,
  SupervisorSettingsMutationSchema,
  SystemPromptPresetDeleteSchema,
  SystemPromptPresetSaveSchema,
  ThemeSaveSchema,
  ThemeSelectSchema,
  ThemeAssetImportSchema,
  ThemeAssetDiscardSchema,
  ThemeBundleImportSchema,
  ThemeBundleExportSchema,
  ThemePreferencesMutationSchema,
  ThemeRenameSchema,
  DraftKeySchema,
  DraftMutationSchema,
  TaskUiStateMutationSchema,
  UiPreferencesMutationSchema,
  SourceControlDiffQuerySchema,
  SourceControlMutationSchema,
  PlanReviewDraftIdentitySchema,
  PlanReviewDraftMutationSchema,
} from "../../shared/contracts.js";
import type { CapabilityRegistry } from "../grok/CapabilityRegistry.js";
import { IdempotencyStore } from "../security/idempotencyStore.js";
import { AppProblem } from "../security/problemResponse.js";
import type { PathReferenceStore } from "../security/PathReferenceStore.js";
import type { TaskSupervisor } from "../tasks/TaskSupervisor.js";
import type { ThemeRepository } from "../themes/ThemeRepository.js";
import type { UiStateStore } from "../storage/UiStateStore.js";
import { executeMutation as mutate } from "./idempotentMutation.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { RichTextRenderService } from "../rendering/RichTextRenderService.js";
import { renderComposerRichTextPreview } from "../rendering/composerRichTextPreview.js";
import type { AccountModelService } from "../account/AccountModelService.js";
import type { SourceControlService } from "../sourceControl/SourceControlService.js";
import { appendPersistentTaskContext } from "../tasks/taskPersistentContext.js";
import { resolveRichTextLocalLinks } from "../rendering/richTextLocalLinks.js";

export interface V1RouteDependencies {
  supervisor: TaskSupervisor;
  themes: ThemeRepository;
  paths: PathReferenceStore;
  media: MediaArtifactStore;
  capabilities: CapabilityRegistry;
  uiState: UiStateStore;
  richText: RichTextRenderService;
  account: AccountModelService;
  sourceControl: SourceControlService;
  appVersion: string;
  startedAt: string;
}

const TaskIdSchema = z.string().uuid();
const ChildSessionIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/);
const ThemeDeleteSchema = MutationRequestSchema.extend({ themeId: z.string().min(1).max(96) });
const TaskRenameSchema = MutationRequestSchema.extend({ title: z.string().trim().min(1).max(160) });
const TaskDeleteSchema = MutationRequestSchema.extend({ confirmation: z.string().min(1).max(128) });
const TaskArchiveSchema = MutationRequestSchema.extend({ archived: z.boolean() });
const TaskPinSchema = MutationRequestSchema.extend({ pinned: z.boolean() });
export function registerV1Routes(app: Express, dependencies: V1RouteDependencies): void {
  const idempotency = new IdempotencyStore();
  const { supervisor, themes, paths, capabilities, uiState } = dependencies;

  app.get("/api/v1/bootstrap", async (_req, res, next) => {
    try {
      const capabilitySnapshot = await capabilities.get();
      const accountStatus = await dependencies.account.accountStatus(capabilitySnapshot.acp.authMethods);
      const library = themes.library();
      res.json({
        appVersion: dependencies.appVersion,
        startedAt: dependencies.startedAt,
        capabilities: capabilitySnapshot,
        workspace: supervisor.workspace(),
        themeLibrary: library,
        activeTheme: themes.get(library.selectedThemeId),
        uiPreferences: uiState.preferences(),
        accountStatus,
      });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/workspace", (_req, res) => res.json(supervisor.workspace()));
  app.get("/api/v1/capabilities", async (_req, res, next) => {
    try { res.json(await capabilities.get()); } catch (error) { next(error); }
  });
  app.get("/api/v1/diagnostics/events", (_req, res) => res.json({ diagnostics: supervisor.diagnostics() }));
  app.get("/api/v1/ui/preferences", (_req, res) => res.json(uiState.preferences()));
  app.post("/api/v1/render/rich-text", (req, res, next) => {
    try {
      const input = RichTextRenderRequestSchema.parse(req.body);
      const document = dependencies.richText.render(input.text, input.level, input.placements, input.policy);
      if (!input.taskId) { res.json({ document, localLinks: [] }); return; }
      const task = supervisor.detail(input.taskId);
      res.json(resolveRichTextLocalLinks(document, input.text, supervisor.projectPath(task.snapshot.projectId), paths, input.policy));
    } catch (error) { next(error); }
  });
  app.post("/api/v1/render/composer-preview", (req, res, next) =>
    mutate(req, res, next, ComposerRichTextPreviewRequestSchema, idempotency, (input) => {
      const projectPath = supervisor.projectPath(input.projectId);
      return renderComposerRichTextPreview(input, projectPath, paths, dependencies.media, dependencies.richText);
    }));
  app.post("/api/v1/ui/preferences", (req, res, next) =>
    mutate(req, res, next, UiPreferencesMutationSchema, idempotency, (input) =>
      uiState.savePreferences(input.preferences)));
  app.get("/api/v1/ui/tasks/:taskId", (req, res, next) => {
    try { res.json(uiState.taskState(TaskIdSchema.parse(req.params.taskId))); } catch (error) { next(error); }
  });
  app.post("/api/v1/ui/tasks/:taskId", (req, res, next) =>
    mutate(req, res, next, TaskUiStateMutationSchema, idempotency, (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const task = supervisor.detail(taskId);
      const projectPath = supervisor.projectPath(task.snapshot.projectId);
      const contextResources = input.contextResources === undefined
        ? undefined
        : rebindContextResources(paths, uiState.taskState(taskId).contextResources, input.contextResources, projectPath);
      return uiState.saveTaskState(taskId, {
        ...(input.scrollAnchor === undefined ? {} : { scrollAnchor: input.scrollAnchor }),
        ...(input.contextOpen === undefined ? {} : { contextOpen: input.contextOpen }),
        ...(contextResources === undefined ? {} : { contextResources }),
        ...(input.contextSection === undefined ? {} : { contextSection: input.contextSection }),
      });
    }));
  app.get("/api/v1/ui/drafts/:key", (req, res, next) => {
    try { res.json(uiState.draft(DraftKeySchema.parse(req.params.key))); } catch (error) { next(error); }
  });
  app.post("/api/v1/ui/drafts", (req, res, next) =>
    mutate(req, res, next, DraftMutationSchema, idempotency, (input) =>
      uiState.saveDraft(input.key, input.document)));
  app.get("/api/v1/tasks", (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.slice(0, 500) : "";
    res.json({ tasks: supervisor.listTasks(query) });
  });
  app.get("/api/v1/tasks/archived", (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.slice(0, 500) : "";
    res.json({ tasks: supervisor.archivedTasks(query) });
  });
  app.get("/api/v1/search", (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.slice(0, 500) : "";
    res.json({ results: supervisor.searchTasks(query) });
  });
  app.get("/api/v1/tasks/:taskId", (req, res, next) => {
    try { res.json(supervisor.detail(TaskIdSchema.parse(req.params.taskId))); }
    catch (error) { next(error); }
  });
  app.get("/api/v1/tasks/:taskId/children/:childSessionId", (req, res, next) => {
    try { res.json(supervisor.childDetail(TaskIdSchema.parse(req.params.taskId), ChildSessionIdSchema.parse(req.params.childSessionId))); }
    catch (error) { next(error); }
  });
  app.get("/api/v1/tasks/:taskId/delete-preview", (req, res, next) => {
    try { res.json(supervisor.deletePreview(TaskIdSchema.parse(req.params.taskId))); } catch (error) { next(error); }
  });
  app.post("/api/v1/media-scopes/:scopeId/:mediaId/lease", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, () => {
      const scopeId = TaskIdSchema.parse(req.params.scopeId);
      const mediaId = TaskIdSchema.parse(req.params.mediaId);
      const lease = dependencies.media.lease(scopeId, mediaId);
      try {
        let projectPath = supervisor.activeProjectPath();
        try {
          const projectId = supervisor.detail(scopeId).snapshot.projectId;
          projectPath = supervisor.projectPath(projectId);
        } catch (error) {
          if (!(error instanceof AppProblem) || error.code !== "NOT_FOUND") throw error;
        }
        return { ...lease, path: paths.registerPath(dependencies.media.referencePath(scopeId, mediaId), projectPath) };
      } catch (error) {
        if (error instanceof AppProblem && error.code === "CAPABILITY_UNAVAILABLE") return lease;
        throw error;
      }
    }));
  app.post("/api/v1/media-scopes/:scopeId/remote-image", (req, res, next) =>
    mutate(req, res, next, RemoteMarkdownImageRequestSchema, idempotency, async (input) => {
      const scopeId = TaskIdSchema.parse(req.params.scopeId);
      supervisor.detail(scopeId);
      return { media: await dependencies.media.registerRemoteImage(scopeId, input.url, input.anchor, input.name) };
    }));

  app.post("/api/v1/tasks", (req, res, next) =>
    mutate(req, res, next, TaskCreateSchema, idempotency, async (input) => {
      const snapshot = await supervisor.create(input);
      if (input.draftKey) uiState.transferDraft(input.draftKey, `task:${snapshot.taskId}`);
      return snapshot;
    }));
  app.post("/api/v1/tasks/:taskId/resume", (req, res, next) =>
    mutate(req, res, next, TaskResumeSchema, idempotency, () => supervisor.resume(TaskIdSchema.parse(req.params.taskId))));
  app.post("/api/v1/tasks/:taskId/sleep", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, () => supervisor.sleep(TaskIdSchema.parse(req.params.taskId))));
  app.post("/api/v1/tasks/:taskId/pin", (req, res, next) =>
    mutate(req, res, next, TaskPinSchema, idempotency, (input) => supervisor.pin(TaskIdSchema.parse(req.params.taskId), input.pinned)));
  app.post("/api/v1/tasks/:taskId/prompt", (req, res, next) =>
    mutate(req, res, next, TaskPromptSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const resolved = resolveTaskComposer(supervisor, uiState, paths, taskId, input);
      return supervisor.prompt(taskId, input.requestId, resolved.transportPrompt, resolved.displayPrompt, resolved.paths, input.submissionMode, resolved.composerDocument);
    }));
  app.post("/api/v1/tasks/:taskId/rewind-and-prompt", (req, res, next) =>
    mutate(req, res, next, TaskRewindAndPromptSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const resolved = resolveTaskComposer(supervisor, uiState, paths, taskId, input);
      return supervisor.rewindAndPrompt(
        taskId,
        input.requestId,
        input.targetPromptIndex,
        input.sourceBlockId,
        resolved.transportPrompt,
        resolved.displayPrompt,
        resolved.paths,
        input.submissionMode,
        resolved.composerDocument,
      );
    }));
  app.post("/api/v1/tasks/:taskId/fork", (req, res, next) =>
    mutate(req, res, next, TaskForkSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const snapshot = await supervisor.fork(taskId, input);
      uiState.transferDraft(`task:${taskId}`, `task:${snapshot.taskId}`);
      return snapshot;
    }));
  app.post("/api/v1/tasks/:taskId/queue/submit", (req, res, next) =>
    mutate(req, res, next, TaskQueueSubmitSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const resolved = resolveTaskComposer(supervisor, uiState, paths, taskId, input);
      return supervisor.enqueue(taskId, input.requestId, resolved.transportPrompt, resolved.displayPrompt, resolved.paths, resolved.composerDocument);
    }));
  app.post("/api/v1/tasks/:taskId/interject", (req, res, next) =>
    mutate(req, res, next, TaskInterjectSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      return supervisor.interject(taskId, input.requestId, input.text);
    }));
  app.post("/api/v1/tasks/:taskId/queue", (req, res, next) =>
    mutate(req, res, next, QueueMutationSchema, idempotency, (input) =>
      supervisor.mutateQueue(TaskIdSchema.parse(req.params.taskId), input)));
  app.post("/api/v1/tasks/:taskId/cancel", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, () =>
      supervisor.cancel(TaskIdSchema.parse(req.params.taskId))));
  app.post("/api/v1/tasks/:taskId/config-option", (req, res, next) =>
    mutate(req, res, next, TaskConfigMutationSchema, idempotency, (input) =>
      supervisor.setConfigOption(TaskIdSchema.parse(req.params.taskId), input.configId, input.value)));
  app.post("/api/v1/tasks/:taskId/commands", (req, res, next) =>
    mutate(req, res, next, TaskCommandMutationSchema, idempotency, (input) =>
      supervisor.executeCommand(TaskIdSchema.parse(req.params.taskId), input.requestId, input.name, input.input)));
  app.post("/api/v1/tasks/:taskId/goal", (req, res, next) =>
    mutate(req, res, next, TaskGoalMutationSchema, idempotency, (input) =>
      supervisor.executeGoal(TaskIdSchema.parse(req.params.taskId), input.requestId, input.action, input.action === "set" ? input.objective : undefined)));
  app.post("/api/v1/tasks/:taskId/mode", (req, res, next) =>
    mutate(req, res, next, TaskWorkModeMutationSchema, idempotency, (input) =>
      supervisor.setWorkMode(TaskIdSchema.parse(req.params.taskId), input.requestId, input.mode)));
  app.post("/api/v1/tasks/:taskId/work/stop", (req, res, next) =>
    mutate(req, res, next, TaskWorkStopSchema, idempotency, (input) =>
      supervisor.stopWork(TaskIdSchema.parse(req.params.taskId), input.requestId, input.workItemId)));
  app.post("/api/v1/tasks/:taskId/gates/decision", (req, res, next) =>
    mutate(req, res, next, GateDecisionSchema, idempotency, (input) =>
      supervisor.decideGate(TaskIdSchema.parse(req.params.taskId), input)));
  app.get("/api/v1/tasks/:taskId/plan-draft", (req, res, next) => {
    try {
      const identity = PlanReviewDraftIdentitySchema.parse(req.query);
      res.json(supervisor.planReviewDraft(TaskIdSchema.parse(req.params.taskId), identity));
    } catch (error) { next(error); }
  });
  app.post("/api/v1/tasks/:taskId/plan-draft", (req, res, next) =>
    mutate(req, res, next, PlanReviewDraftMutationSchema, idempotency, (input) =>
      supervisor.savePlanReviewDraft(
        TaskIdSchema.parse(req.params.taskId),
        { gateId: input.gateId, baseHash: input.baseHash },
        input.draft,
      )));
  app.post("/api/v1/tasks/:taskId/rename", (req, res, next) =>
    mutate(req, res, next, TaskRenameSchema, idempotency, (input) =>
      supervisor.renameTask(TaskIdSchema.parse(req.params.taskId), input.requestId, input.title)));
  app.post("/api/v1/tasks/:taskId/archive", (req, res, next) =>
    mutate(req, res, next, TaskArchiveSchema, idempotency, (input) =>
      supervisor.archiveTask(TaskIdSchema.parse(req.params.taskId), input.archived)));
  app.post("/api/v1/tasks/:taskId/export", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, (input) =>
      supervisor.exportTask(TaskIdSchema.parse(req.params.taskId), input.requestId)));
  app.post("/api/v1/tasks/:taskId/delete", (req, res, next) =>
    mutate(req, res, next, TaskDeleteSchema, idempotency, async (input) => {
      const taskId = TaskIdSchema.parse(req.params.taskId);
      const workspace = await supervisor.deleteTask(taskId, input.requestId, input.confirmation);
      uiState.deleteTaskState(taskId);
      return workspace;
    }));

  app.post("/api/v1/supervisor/settings", (req, res, next) =>
    mutate(req, res, next, SupervisorSettingsMutationSchema, idempotency, (input) =>
      supervisor.setSettings(input.settings)));

  app.post("/api/v1/projects/activate", (req, res, next) =>
    mutate(req, res, next, ProjectMutationSchema, idempotency, (input) =>
      supervisor.activateProject(input.projectId)));
  app.post("/api/v1/projects/remove", (req, res, next) =>
    mutate(req, res, next, ProjectMutationSchema, idempotency, (input) =>
      supervisor.removeProject(input.projectId)));
  app.post("/api/v1/projects/defaults", (req, res, next) =>
    mutate(req, res, next, ProjectDefaultsMutationSchema, idempotency, (input) =>
      supervisor.updateProjectDefaults(input.projectId, input.defaults)));
  app.post("/api/v1/system-prompt-presets/save", (req, res, next) =>
    mutate(req, res, next, SystemPromptPresetSaveSchema, idempotency, (input) =>
      supervisor.saveSystemPromptPreset(input.preset)));
  app.post("/api/v1/system-prompt-presets/delete", (req, res, next) =>
    mutate(req, res, next, SystemPromptPresetDeleteSchema, idempotency, (input) =>
      supervisor.deleteSystemPromptPreset(input.presetId)));
  app.get("/api/v1/projects/:projectId/source-control", (req, res, next) => {
    void dependencies.sourceControl.snapshot(ProjectIdSchema.parse(req.params.projectId))
      .then((value) => res.json(value)).catch(next);
  });
  app.get("/api/v1/projects/:projectId/source-control/diff", (req, res, next) => {
    try {
      const projectId = ProjectIdSchema.parse(req.params.projectId);
      const query = SourceControlDiffQuerySchema.parse(req.query);
      void dependencies.sourceControl.diff(projectId, query.path, query.staged === "1")
        .then((value) => res.json(value)).catch(next);
    } catch (error) { next(error); }
  });
  app.post("/api/v1/projects/:projectId/source-control", (req, res, next) =>
    mutate(req, res, next, SourceControlMutationSchema, idempotency, (input) =>
      dependencies.sourceControl.mutate(ProjectIdSchema.parse(req.params.projectId), input)));

  app.get("/api/v1/themes", (_req, res) => res.json(themes.library()));
  app.get("/api/v1/themes/:themeId", (req, res, next) => {
    try { res.json(themes.get(req.params.themeId)); } catch (error) { next(error); }
  });
  app.get("/api/v1/themes/:themeId/bundle", (req, res, next) => {
    try { res.json(themes.bundle(req.params.themeId)); } catch (error) { next(error); }
  });
  app.get("/theme-assets/:assetId", (req, res, next) => {
    try {
      const file = themes.assetPath(req.params.assetId);
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.type(file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".otf") ? "font/otf" : file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : file.endsWith(".avif") ? "image/avif" : "image/jpeg");
      res.sendFile(file);
    } catch (error) { next(error); }
  });
  app.post("/api/v1/themes/save", (req, res, next) =>
    mutate(req, res, next, ThemeSaveSchema, idempotency, (input) =>
      themes.save(input.manifest, input.overwrite)));
  app.post("/api/v1/themes/assets/import", (req, res, next) =>
    mutate(req, res, next, ThemeAssetImportSchema, idempotency, (input) =>
      themes.importAsset(input.kind, input.fileName, input.dataBase64)));
  app.post("/api/v1/themes/assets/discard", (req, res, next) =>
    mutate(req, res, next, ThemeAssetDiscardSchema, idempotency, (input) =>
      themes.discardAsset(input.assetId)));
  app.post("/api/v1/themes/bundle/import", (req, res, next) =>
    mutate(req, res, next, ThemeBundleImportSchema, idempotency, (input) =>
      themes.importBundle(input.bundle, input.overwrite)));
  app.post("/api/v1/themes/bundle/export", (req, res, next) =>
    mutate(req, res, next, ThemeBundleExportSchema, idempotency, (input) =>
      themes.bundleManifest(input.manifest)));
  app.post("/api/v1/themes/select", (req, res, next) =>
    mutate(req, res, next, ThemeSelectSchema, idempotency, (input) =>
      themes.select(input.themeId, input.followSystem)));
  app.post("/api/v1/themes/preferences", (req, res, next) =>
    mutate(req, res, next, ThemePreferencesMutationSchema, idempotency, (input) =>
      themes.configureSystem(input.systemLightThemeId, input.systemDarkThemeId)));
  app.post("/api/v1/themes/rename", (req, res, next) =>
    mutate(req, res, next, ThemeRenameSchema, idempotency, (input) =>
      themes.rename(input.themeId, input.nextId, input.nextName)));
  app.post("/api/v1/themes/delete", (req, res, next) =>
    mutate(req, res, next, ThemeDeleteSchema, idempotency, (input) => themes.delete(input.themeId)));
  app.post("/api/v1/themes/:themeId/diff", (req, res, next) => {
    try { res.json({ changes: themes.tokenDiff(req.params.themeId, req.body?.manifest) }); }
    catch (error) { next(error); }
  });

  app.post("/api/v1/capabilities/refresh", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, () => capabilities.refresh()));

  app.get("/api/v1/system/active-for-quit", (_req, res) => {
    res.json({ tasks: supervisor.activeForQuit() });
  });
  app.post("/api/v1/system/prepare-quit", (req, res, next) =>
    mutate(req, res, next, MutationRequestSchema, idempotency, async () => {
      await supervisor.shutdown();
      return { ok: true };
    }));
}

function resolveComposer(paths: PathReferenceStore, input: { prompt: string; paths: Array<{ refId: string }>; document?: import("../../shared/contracts.js").ComposerInputDocument }) {
  if (input.document) return paths.resolveDocument(input.document);
  const resolvedPaths = paths.resolve(input.paths);
  return {
    transportPrompt: `${input.prompt}${resolvedPaths.promptSuffix}`,
    displayPrompt: input.prompt,
    paths: resolvedPaths.paths,
    composerDocument: {
      version: 1 as const,
      nodes: [
        { type: "text" as const, text: input.prompt },
        ...resolvedPaths.paths.map((path) => ({ type: "path" as const, path })),
      ],
    },
  };
}

function resolveTaskComposer(
  supervisor: TaskSupervisor,
  uiState: UiStateStore,
  paths: PathReferenceStore,
  taskId: string,
  input: { prompt: string; paths: Array<{ refId: string }>; document?: import("../../shared/contracts.js").ComposerInputDocument },
) {
  const base = resolveComposer(paths, input);
  const projectId = supervisor.detail(taskId).snapshot.projectId;
  return appendPersistentTaskContext(
    base,
    uiState.taskState(taskId).contextResources,
    supervisor.projectPath(projectId),
    paths,
  );
}

function rebindContextResources(
  paths: PathReferenceStore,
  current: import("../../shared/contracts.js").SavedContextResource[],
  incoming: import("../../shared/contracts.js").SavedContextResource[],
  projectPath: string,
) {
  const saved = new Map(current.map((resource) => [contextPathIdentity(resource.path), resource]));
  return incoming.map((resource) => {
    let rebound: import("../../shared/contracts.js").PathReferenceSummary;
    try {
      rebound = paths.rebind(resource.path.refId, projectPath);
    } catch (error) {
      if (!(error instanceof AppProblem) || error.code !== "NOT_FOUND") throw error;
      const existing = saved.get(contextPathIdentity(resource.path));
      if (!existing) throw error;
      rebound = paths.restoreSaved(existing.path, projectPath);
    }
    return { ...resource, path: rebound };
  });
}

function contextPathIdentity(path: Pick<import("../../shared/contracts.js").PathReferenceSummary, "withinProject" | "displayPath">): string {
  return `${path.withinProject ? "project" : "external"}:${path.displayPath}`;
}
