import { EventEmitter } from "node:events";
import type { z } from "zod";
import { QueueMutationSchema, type ComposerReplayDocument, type GateDecision, type PathReferenceSummary, type PlanReviewDraftIdentity, type PlanReviewDraftSnapshot, type TaskCreate, type ProjectDefaults, type SystemPromptPresetSave, type TaskDetailProjection, type TaskFork, type TaskGoalAction, type TaskListItem, type TaskSearchResult, type TaskSnapshot, type TaskSubmissionMode, type WorkMode, type WorkspaceProjection } from "../../shared/contracts.js";
import type { TaskNotificationIntent } from "../../shared/taskNotifications.js";
import type { ProjectStore } from "../projects/ProjectStore.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRow } from "./TaskStore.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import { TaskActor } from "./TaskActor.js";
import { listItemFromSnapshot } from "./taskHistory.js";
import { workspaceProjection } from "./workspaceProjection.js";
import { deleteTaskSession, exportTaskTranscript } from "./taskLifecycleActions.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";
import { defaultsFrom } from "./taskActorOptions.js";
import { permissionCapabilityList, readSupervisorSettings } from "./supervisorSettings.js";
import { ensurePoolCapacity, isRetirableTaskActor } from "./supervisorPoolPolicy.js";
import { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { TaskSupervisorOptions } from "./taskSupervisorTypes.js";
import { TaskActivationCoordinator } from "./TaskActivationCoordinator.js";
import { TaskDetailReader } from "./TaskDetailReader.js";
import { ProjectSourceControlBarrier } from "./ProjectSourceControlBarrier.js";
import { TaskHistoryCoordinator } from "./TaskHistoryCoordinator.js";
import { TaskStore } from "./TaskStore.js";
import { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";
import { SystemPromptPresetStore } from "../projects/SystemPromptPresetStore.js";

export class TaskSupervisor extends EventEmitter {
  readonly #actors = new Map<string, TaskActor>();
  readonly #observedActors = new WeakSet<TaskActor>();
  readonly #sourceControlBarrier: ProjectSourceControlBarrier;
  readonly #activation: TaskActivationCoordinator;
  readonly #details: TaskDetailReader;
  readonly #history: TaskHistoryCoordinator;
  readonly #store: TaskStore;
  readonly #processes: OwnedProcessRegistry;
  readonly #state: JsonStateStore;
  readonly #projects: ProjectStore;
  readonly #systemPrompts: SystemPromptPresetStore;
  readonly #grokBin: string;
  readonly #grokHome: string;
  readonly #grokHomeId: string;
  #permissionCapabilities: RuntimePermissionCapabilities;
  #idleRetirementMs: number;
  readonly #media: MediaArtifactStore;
  readonly #reaper: NodeJS.Timeout;
  #maxAgents: number;
  #softLimit = 4;
  #hardLimit = 6;
  constructor(options: TaskSupervisorOptions) {
    super();
    this.#state = options.state;
    this.#processes = options.processes || new OwnedProcessRegistry();
    this.#projects = options.projects;
    this.#systemPrompts = new SystemPromptPresetStore(this.#state);
    this.#grokBin = options.grokBin;
    this.#grokHome = options.grokHome;
    this.#grokHomeId = options.grokHomeId;
    this.#store = new TaskStore(this.#grokHome, this.#grokHomeId, this.#projects, this.#state);
    this.#permissionCapabilities = options.permissionCapabilities;
    this.#sourceControlBarrier = new ProjectSourceControlBarrier(
      this.#projects, this.#actors, this.#store,
    );
    const settings = readSupervisorSettings(JSON.stringify(this.#state.get("supervisor.settings") ?? null), options.maxAgents, options.idleRetirementMs);
    this.#softLimit = settings.softLimit;
    this.#hardLimit = settings.hardLimit;
    this.#maxAgents = settings.maxAgents;
    this.#idleRetirementMs = settings.idleRetirementMinutes * 60_000;
    this.#media = options.media || new MediaArtifactStore();
    this.#details = new TaskDetailReader({
      store: this.#store, projects: this.#projects, grokHome: this.#grokHome, media: this.#media,
    });
    this.#activation = new TaskActivationCoordinator({
      actors: this.#actors, store: this.#store,
      actorFactory: options.actorFactory || ((actorOptions) => new TaskActor(actorOptions)),
      permissionCapabilities: () => this.#permissionCapabilities,
      ensureTaskCreationAllowed: options.ensureTaskCreationAllowed || (async () => undefined),
      ensureCapacity: () => this.#ensureCapacity(), taskRow: (taskId) => this.#taskRow(taskId),
      actorRuntime: (projectId) => this.#actorRuntime(projectId), attach: (actor) => this.#attach(actor),
      publishCreatedTask: (actor, input) => this.#publishCreatedTask(actor, input),
    });
    this.#history = new TaskHistoryCoordinator({
      store: this.#store, actors: this.#actors, activation: this.#activation,
      taskRow: (taskId) => this.#taskRow(taskId), workspace: () => this.workspace(),
      publish: (event, payload) => this.emit(event, payload),
    });
    this.#reaper = setInterval(() => this.#retireIdleActors(), 60_000);
    this.#reaper.unref();
  }
  workspace(): WorkspaceProjection {
    return workspaceProjection(this.#projects.list(), this.listTasks(), this.#systemPrompts.list(), {
      activeAgents: this.#actors.size, softLimit: this.#softLimit, hardLimit: this.#hardLimit,
      maxAgents: this.#maxAgents, maxAllowed: 16, idleRetirementMinutes: Math.round(this.#idleRetirementMs / 60_000),
      permissionModes: permissionCapabilityList(this.#permissionCapabilities),
    });
  }
  listTasks(query = "", includeArchived = false): TaskListItem[] {
    const bySession = new Map(this.#store.list(query, includeArchived ? "all" : "active").map((task) => [task.sessionId || task.taskId, task]));
    for (const actor of this.#actors.values()) {
      const sessionId = actor.snapshot.sessionId || actor.snapshot.taskId;
      const archived = this.#store.isArchived(sessionId);
      if (archived && !includeArchived) continue;
      const task = listItemFromSnapshot(
        actor.snapshot,
        this.#isPinned(actor.snapshot.taskId),
        archived,
        actor.detail.messages.some((message) => message.role === "user"),
      );
      if (!query || `${task.title}\n${actor.detail.messages.filter((message) => message.role === "user").map((message) => message.text).join("\n")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) {
        bySession.set(task.sessionId || task.taskId, task);
      }
    }
    return [...bySession.values()]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || Number(right.agentState !== "unloaded") - Number(left.agentState !== "unloaded") || Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }
  searchTasks(query: string): TaskSearchResult[] {
    const normalized = query.trim().toLocaleLowerCase();
    const projectNames = new Map(this.#projects.list().map((project) => [project.projectId, project.name]));
    return this.listTasks(query).map((task) => {
      const detail = this.#actors.get(task.taskId)?.detail || this.#store.readDetail(task.taskId);
      const prompt = detail?.messages.find((message) => message.role === "user" && message.text.toLocaleLowerCase().includes(normalized))?.text || null;
      return {
        task,
        projectName: projectNames.get(task.projectId) || "Project",
        match: task.title.toLocaleLowerCase().includes(normalized) ? "title" : "prompt",
        excerpt: prompt,
      };
    });
  }
  archivedTasks(query = ""): TaskListItem[] {
    return this.listTasks(query, true).filter((task) => task.archived);
  }
  registerProject(directory: string): WorkspaceProjection {
    this.#projects.addProject(directory);
    this.emit("project.changed");
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  activeProjectPath(): string {
    const project = this.#projects.list().find((item) => item.active) || this.#projects.list()[0];
    if (!project) throw new AppProblem(404, "NOT_FOUND", "No Project is indexed.");
    return this.#projects.getCanonicalPath(project.projectId);
  }
  projectPath(projectId: string): string { return this.#projects.getCanonicalPath(projectId); }
  projectIdForCanonicalPath(directory: string): string | null { return this.#projects.projectIdForCanonicalPath(directory); }
  projectsSourceControlLocked(projectIds: readonly string[]): boolean { return this.#sourceControlBarrier.writeLockedMany(projectIds); }
  withProjectsSourceControlWriteLease<T>(projectIds: readonly string[], operation: () => Promise<T>): Promise<T> { return this.#sourceControlBarrier.withWriteLeases(projectIds, operation); }
  activateProject(projectId: string): WorkspaceProjection {
    this.#projects.activate(projectId);
    this.emit("project.changed");
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  removeProject(projectId: string): WorkspaceProjection {
    if ([...this.#actors.values()].some((actor) => actor.snapshot.projectId === projectId)) {
      throw new AppProblem(409, "TASK_BUSY", "Stop or retire this project's loaded agents before removing it from the index.");
    }
    this.#projects.remove(projectId);
    const remaining = this.#projects.list();
    if (remaining.length && !remaining.some((project) => project.active)) this.#projects.activate(remaining[0].projectId);
    this.emit("project.changed");
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  updateProjectDefaults(projectId: string, defaults: ProjectDefaults): WorkspaceProjection {
    this.#projects.updateDefaults(projectId, defaults);
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  saveSystemPromptPreset(input: SystemPromptPresetSave["preset"]): WorkspaceProjection {
    this.#systemPrompts.save(input);
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  deleteSystemPromptPreset(presetId: string): WorkspaceProjection {
    this.#systemPrompts.delete(presetId);
    for (const project of this.#projects.list()) {
      if (project.defaults.systemPromptPresetId === presetId) {
        this.#projects.updateDefaults(project.projectId, {
          ...project.defaults,
          systemPromptPresetId: null,
        });
      }
    }
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  async create(input: TaskCreate): Promise<TaskSnapshot> {
    return this.#sourceControlBarrier.withRuntimeIntent(input.projectId, () =>
      this.#activation.create(input));
  }
  detail(taskId: string): TaskDetailProjection {
    const actor = this.#actors.get(taskId);
    if (actor) return actor.detail;
    return this.#details.parent(this.#taskRow(taskId));
  }
  activeDetails(): TaskDetailProjection[] {
    return [...this.#actors.values()]
      .filter((actor) => actor.snapshot.sessionId === actor.snapshot.taskId)
      .map((actor) => actor.detail);
  }
  async resume(taskId: string): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () => (await this.#activation.activate(taskId)).snapshot);
  }
  sleep(taskId: string): WorkspaceProjection {
    const actor = this.#actors.get(taskId);
    if (!actor) return this.workspace();
    if (!isRetirableTaskActor(actor)) throw new AppProblem(409, "TASK_BUSY", "Finish or clear queued prompts, pause or clear the active Goal, stop background work, and resolve the current turn or Gate before sleeping this Agent.");
    actor.stop();
    this.#actors.delete(taskId);
    this.emit("task.retired", { taskId, reason: "manual" });
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  pin(taskId: string, pinned: boolean): WorkspaceProjection {
    const row = this.#taskRow(taskId);
    this.#store.setPinned(row.session_id || taskId, pinned);
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  async prompt(taskId: string, requestId: string, transportPrompt: string, displayPrompt = transportPrompt, paths: PathReferenceSummary[] = [], mode: TaskSubmissionMode = "prompt", composerDocument?: ComposerReplayDocument): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () =>
      (await this.#activation.intentActor(taskId, requestId)).submit(requestId, transportPrompt, paths, displayPrompt, mode, composerDocument));
  }
  async rewindAndPrompt(
    taskId: string,
    requestId: string,
    targetPromptIndex: number,
    sourceBlockId: string,
    transportPrompt: string,
    displayPrompt = transportPrompt,
    paths: PathReferenceSummary[] = [],
    mode: TaskSubmissionMode = "prompt",
    composerDocument?: ComposerReplayDocument,
  ): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#history.rewindAndPrompt(
      taskId, requestId, targetPromptIndex, sourceBlockId, transportPrompt,
      displayPrompt, paths, mode, composerDocument,
    ));
  }
  async fork(taskId: string, input: TaskFork): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#history.fork(taskId, input));
  }
  childDetail(taskId: string, childSessionId: string) {
    const actor = this.#actors.get(taskId);
    if (actor) return actor.childDetail(childSessionId);
    return this.#details.child(this.#taskRow(taskId), childSessionId);
  }
  async enqueue(taskId: string, requestId: string, transportPrompt: string, displayPrompt = transportPrompt, paths: PathReferenceSummary[] = [], composerDocument?: ComposerReplayDocument): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).enqueue(requestId, transportPrompt, paths, displayPrompt, composerDocument));
  }
  async interject(taskId: string, requestId: string, text: string): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).interject(requestId, text));
  }
  async mutateQueue(taskId: string, input: z.infer<typeof QueueMutationSchema>): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).mutateQueue(input));
  }
  async cancel(taskId: string): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () => {
      const actor = this.#requireActive(taskId);
      await actor.cancel();
      return actor.snapshot;
    });
  }
  async setConfigOption(taskId: string, configId: string, value: string | boolean): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).setConfigOption(configId, value));
  }
  async executeCommand(taskId: string, requestId: string, name: string, input = ""): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).executeCommand(requestId, name, input));
  }
  async executeGoal(taskId: string, requestId: string, action: TaskGoalAction, objective?: string): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () => {
      const actor = await this.#activation.intentActor(taskId, requestId);
      return actor.executeGoal(requestId, action, objective);
    });
  }
  async setWorkMode(taskId: string, requestId: string, mode: WorkMode): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () => {
      const actor = await this.#activation.intentActor(taskId, requestId);
      return actor.setWorkMode(mode);
    });
  }
  async stopWork(taskId: string, requestId: string, workItemId: string): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, async () => {
      if (!this.#actors.has(taskId)) await this.#activation.activate(taskId);
      return this.#requireActive(taskId).stopWork(requestId, workItemId);
    });
  }
  async decideGate(taskId: string, decision: GateDecision): Promise<TaskSnapshot> {
    return this.#withTaskRuntimeIntent(taskId, () => this.#requireActive(taskId).decideGate(decision));
  }
  planReviewDraft(taskId: string, identity: PlanReviewDraftIdentity): PlanReviewDraftSnapshot { return this.#requireActive(taskId).planReviewDraft(identity); }
  savePlanReviewDraft(taskId: string, identity: PlanReviewDraftIdentity, draft: string | null): PlanReviewDraftSnapshot { return this.#requireActive(taskId).savePlanReviewDraft(identity, draft); }
  renameTask(taskId: string, _requestId: string, title: string): WorkspaceProjection {
    const row = this.#taskRow(taskId); const actor = this.#actors.get(taskId);
    actor?.rename(title);
    this.#store.rename(row.session_id || taskId, title);
    const workspace = this.workspace(); this.emit("workspace.changed", workspace); return workspace;
  }
  archiveTask(taskId: string, archived: boolean): WorkspaceProjection {
    const row = this.#taskRow(taskId);
    const actor = this.#actors.get(taskId);
    if (archived && actor && !isRetirableTaskActor(actor)) {
      throw new AppProblem(409, "TASK_BUSY", "Finish the current turn, Gate, Goal, queued prompt, or background work before archiving this task.");
    }
    if (archived && actor) {
      actor.stop();
      this.#actors.delete(taskId);
      this.#activation.forgetTask(taskId);
      this.emit("task.retired", { taskId, reason: "archived" });
    }
    this.#store.setArchived(row.session_id || taskId, archived);
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  deletePreview(taskId: string): { token: string; title: string; warning: string } {
    const row = this.#taskRow(taskId);
    return { token: `delete-task:${taskId}`, title: row.title, warning: "This deletes the Grok session through official `grok sessions delete`, then removes only this app index entry." };
  }
  async deleteTask(taskId: string, _requestId: string, confirmation: string): Promise<WorkspaceProjection> {
    if (confirmation !== `delete-task:${taskId}`) throw new AppProblem(400, "VALIDATION_FAILED", "Task deletion confirmation is invalid.");
    const row = this.#taskRow(taskId);
    const actor = this.#actors.get(taskId);
    const storedGoal = actor?.snapshot.goal || this.#store.readDetail(taskId)?.snapshot.goal;
    if (!storedGoal) throw new AppProblem(404, "NOT_FOUND", "Task not found.");
    const hasGoal = actor?.hasGoal || storedGoal.status === "active" || storedGoal.status === "paused";
    if (hasGoal || (actor && !isRetirableTaskActor(actor)))
      throw new AppProblem(409, "TASK_BUSY", "Clear queued prompts and the Goal, stop background work, and resolve the current turn or Gate before deleting this task.");
    await deleteTaskSession(row, this.#projects.getCanonicalPath(row.project_id), this.#grokBin, this.#grokHome, this.#processes);
    actor?.stop(); this.#actors.delete(taskId); this.#store.deleteTask(row.session_id || taskId);
    this.#media.removeTask(taskId);
    this.#activation.forgetTask(taskId);
    const workspace = this.workspace(); this.emit("workspace.changed", workspace); return workspace;
  }
  async exportTask(taskId: string, _requestId: string): Promise<{ fileName: string; markdown: string }> {
    const row = this.#taskRow(taskId); const result = await exportTaskTranscript(row, this.#projects.getCanonicalPath(row.project_id), this.#grokBin, this.#grokHome, this.#processes);
    return result;
  }
  diagnostics(): Array<{ taskId: string | null; method: string; severity: string; count: number; firstSeenAt: string; lastSeenAt: string; summary: string }> {
    const details = [
      ...[...this.#actors.values()].map((actor) => actor.detail),
      ...this.#store.rows().flatMap((row) => {
        if (this.#actors.has(row.task_id)) return [];
        const detail = this.#store.readDetail(row.task_id);
        return detail ? [detail] : [];
      }),
    ];
    return projectTaskDiagnostics(details);
  }
  setSettings(settings: { softLimit: number; hardLimit: number; maxAgents: number; idleRetirementMinutes: number }): WorkspaceProjection {
    this.#softLimit = settings.softLimit;
    this.#hardLimit = settings.hardLimit;
    this.#maxAgents = settings.maxAgents;
    this.#idleRetirementMs = settings.idleRetirementMinutes * 60_000;
    this.#state.set("supervisor.settings", settings);
    this.#retireForLimit();
    const workspace = this.workspace();
    this.emit("workspace.changed", workspace);
    return workspace;
  }
  setPermissionCapabilities(value: RuntimePermissionCapabilities): void {
    this.#permissionCapabilities = value;
    this.emit("workspace.changed", this.workspace());
  }
  activeForQuit(): TaskListItem[] {
    return [...this.#actors.values()]
      .map((actor) => listItemFromSnapshot(
        actor.snapshot,
        this.#isPinned(actor.snapshot.taskId),
        false,
        actor.detail.messages.some((message) => message.role === "user"),
      ))
      .filter((task) => task.active || task.needsAttention);
  }
  async shutdown(): Promise<void> {
    clearInterval(this.#reaper);
    await Promise.allSettled([...this.#actors.values()].map((actor) => actor.shutdown()));
    this.#actors.clear();
    this.#activation.clear();
  }
  #attach(actor: TaskActor): void {
    const snapshot = actor.snapshot;
    this.#actors.set(snapshot.taskId, actor);
    if (
      snapshot.sessionId !== snapshot.taskId
      || this.#observedActors.has(actor)
    ) return;
    this.#observedActors.add(actor);
    actor.on("change", () => this.emit("task.changed", actor.detail));
  }
  #actorRuntime(projectId: string) {
    return {
      projectPath: this.#projects.getCanonicalPath(projectId),
      grokBin: this.#grokBin,
      grokHome: this.#grokHome,
      grokHomeId: this.#grokHomeId,
      state: this.#state,
      media: this.#media,
      taskStore: this.#store,
      processes: this.#processes,
      publishNotification: (taskId: string, notification: TaskNotificationIntent) => {
        const actor = this.#actors.get(taskId);
        if (actor?.snapshot.sessionId === taskId) {
          this.emit("task.notification", { taskId, notification });
        }
      },
      permissionCapabilities: this.#permissionCapabilities,
    };
  }
  #ensureCapacity(): void {
    ensurePoolCapacity(this.#actors, this.#maxAgents, (taskId) => this.#isPinned(taskId), (taskId) => this.emit("task.retired", { taskId, reason: "capacity" }));
  }
  #requireActive(taskId: string): TaskActor {
    const actor = this.#actors.get(taskId);
    if (!actor) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The task agent is unloaded; resume it before sending an intent.");
    return actor;
  }
  #withTaskRuntimeIntent<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    return this.#sourceControlBarrier.withRuntimeIntent(this.#taskRow(taskId).project_id, operation);
  }
  #publishCreatedTask(actor: TaskActor, input: TaskCreate): void {
    this.#projects.updateDefaults(input.projectId, defaultsFrom(input));
    this.emit("task.created", actor.detail);
  }
  #taskRow(taskId: string): TaskRow {
    const actor = this.#actors.get(taskId) || [...this.#actors.values()].find((candidate) => candidate.snapshot.sessionId === taskId);
    if (actor) {
      const snapshot = actor.snapshot;
      return {
        task_id: snapshot.taskId,
        project_id: snapshot.projectId,
        session_id: snapshot.sessionId || "",
        title: snapshot.title,
        state: `${snapshot.connection}:${snapshot.turn}`,
        revision: snapshot.revision,
        config_json: "{}",
        grok_home_id: snapshot.grokHomeId,
        pinned: this.#isPinned(snapshot.taskId) ? 1 : 0,
        created_at: snapshot.createdAt,
        updated_at: snapshot.updatedAt,
        summary_path: "",
        has_user_turn: actor.detail.messages.some((message) => message.role === "user"),
      };
    }
    const row = this.#store.row(taskId);
    if (!row) throw new AppProblem(404, "NOT_FOUND", "Task not found.");
    return row;
  }
  #retireIdleActors(): void {
    const cutoff = Date.now() - this.#idleRetirementMs;
    for (const [taskId, actor] of this.#actors) {
      if (!isRetirableTaskActor(actor) || actor.lastTouched > cutoff || this.#isPinned(taskId)) continue;
      actor.stop();
      this.#actors.delete(taskId);
      this.emit("task.retired", { taskId });
    }
  }

  #isPinned(taskId: string): boolean {
    const row = this.#store.row(taskId);
    const sessionId = this.#actors.get(taskId)?.snapshot.sessionId;
    return row?.pinned === 1
      || this.#state.get<boolean>(`task.pin.${sessionId || taskId}`) === true;
  }

  #retireForLimit(): void {
    if (this.#actors.size <= this.#maxAgents) return;
    const candidates = [...this.#actors.entries()].filter(([taskId, actor]) => isRetirableTaskActor(actor) && !this.#isPinned(taskId)).sort(([, a], [, b]) => a.lastTouched - b.lastTouched);
    for (const [taskId, actor] of candidates) {
      if (this.#actors.size <= this.#maxAgents) break;
      actor.stop();
      this.#actors.delete(taskId);
      this.emit("task.retired", { taskId, reason: "limit-lowered" });
    }
  }
}

export function projectTaskDiagnostics(details: readonly TaskDetailProjection[]): Array<{ taskId: string | null; method: string; severity: string; count: number; firstSeenAt: string; lastSeenAt: string; summary: string }> {
  const aggregated = new Map<string, { taskId: string | null; method: string; severity: string; count: number; firstSeenAt: string; lastSeenAt: string; summary: string }>();
  for (const detail of details) {
    for (const event of detail.events) {
      const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : {};
      const summary = event.method.includes("unknown")
        ? "Unknown protocol event"
        : event.method.startsWith("child/") && (!payload.sessionId || payload.sessionId === "unknown")
          ? "Child event has no official session identity"
          : null;
      if (!summary) continue;
      const key = `${detail.snapshot.taskId}:${event.method}:${summary}`;
      const current = aggregated.get(key);
      if (current) {
        current.count += 1;
        if (event.occurredAt < current.firstSeenAt) current.firstSeenAt = event.occurredAt;
        if (event.occurredAt > current.lastSeenAt) current.lastSeenAt = event.occurredAt;
      } else {
        aggregated.set(key, {
          taskId: detail.snapshot.taskId,
          method: event.method,
          severity: "warning",
          count: 1,
          firstSeenAt: event.occurredAt,
          lastSeenAt: event.occurredAt,
          summary,
        });
      }
    }
  }
  return [...aggregated.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}
