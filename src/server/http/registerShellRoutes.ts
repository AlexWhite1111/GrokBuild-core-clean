import type { Express } from "express";
import { z } from "zod";
import { ProjectIdSchema } from "../../shared/contracts.js";
import { IdempotencyStore } from "../security/idempotencyStore.js";
import type { TaskSupervisor } from "../tasks/TaskSupervisor.js";
import type { PathReferenceStore } from "../security/PathReferenceStore.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { TextClipAuthorityStore } from "../storage/TextClipAuthorityStore.js";
import { executeMutation } from "./idempotentMutation.js";

const ProjectRegistrationSchema = z.object({
  requestId: z.string().uuid(),
  directory: z.string().min(1).max(4096),
});
const PathRegistrationSchema = z.object({
  requestId: z.string().uuid(),
  path: z.string().min(1).max(4096),
  projectId: ProjectIdSchema.optional(),
});

export function registerShellRoutes(app: Express, supervisor: TaskSupervisor, paths: PathReferenceStore, media: MediaArtifactStore, textClips: TextClipAuthorityStore): void {
  const idempotency = new IdempotencyStore();
  app.post("/internal/v1/projects/register", (req, res, next) =>
    executeMutation(req, res, next, ProjectRegistrationSchema, idempotency, (input) =>
      supervisor.registerProject(input.directory)));
  app.get("/internal/v1/projects/active-path", (_req, res, next) => {
    try { res.json({ directory: supervisor.activeProjectPath() }); } catch (error) { next(error); }
  });
  app.get("/internal/v1/projects/:projectId/path", (req, res, next) => {
    try { res.json({ directory: supervisor.projectPath(ProjectIdSchema.parse(req.params.projectId)) }); }
    catch (error) { next(error); }
  });
  app.post("/internal/v1/paths/register", (req, res, next) =>
    executeMutation(req, res, next, PathRegistrationSchema, idempotency, (input) =>
      paths.registerPath(input.path, input.projectId ? supervisor.projectPath(input.projectId) : supervisor.activeProjectPath())));
  app.get("/internal/v1/paths/:refId", (req, res, next) => {
    try { res.json({ path: paths.absolutePath(z.string().uuid().parse(req.params.refId)) }); }
    catch (error) { next(error); }
  });
  app.get("/internal/v1/media/:taskId/:mediaId/path", (req, res, next) => {
    try {
      const taskId = z.string().uuid().parse(req.params.taskId);
      const mediaId = z.string().uuid().parse(req.params.mediaId);
      res.json({ path: media.absolutePath(taskId, mediaId) });
    } catch (error) { next(error); }
  });
  app.get("/internal/v1/text-clips/authority", (_req, res, next) => {
    try { res.json(textClips.snapshot()); }
    catch (error) { next(error); }
  });
}
