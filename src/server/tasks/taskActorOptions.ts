import type { TaskCreate, TaskDetailProjection } from "../../shared/contracts.js";
import type { TaskRow } from "./TaskStore.js";
import type { RuntimePermissionCapabilities, TaskActorOptions } from "./taskTypes.js";

interface RuntimeDependencies {
  projectPath: string;
  grokBin: string;
  grokHome: string;
  grokHomeId: string;
  state: TaskActorOptions["state"];
  taskStore: TaskActorOptions["taskStore"];
  processes?: TaskActorOptions["processes"];
  publishNotification: TaskActorOptions["publishNotification"];
  media?: TaskActorOptions["media"];
  permissionCapabilities: RuntimePermissionCapabilities;
}

export function newActorOptions(taskId: string, input: TaskCreate, runtime: RuntimeDependencies): TaskActorOptions {
  return {
    ...runtime,
    taskId,
    projectId: input.projectId,
    workMode: input.workMode,
    permission: input.permission,
    sandbox: input.sandbox,
    systemPrompt: input.systemPrompt,
    modelId: input.modelId,
    effort: input.effort,
  };
}

export function restoredActorOptions(row: TaskRow, existing: TaskDetailProjection, runtime: RuntimeDependencies): TaskActorOptions {
  const snapshot = existing.snapshot;
  return {
    ...runtime,
    grokHomeId: row.grok_home_id,
    taskId: row.task_id,
    projectId: row.project_id,
    workMode: snapshot.workMode,
    permission: snapshot.permission.requested,
    sandbox: snapshot.sandbox.requested,
    systemPrompt: snapshot.systemPrompt ?? null,
    modelId: snapshot.modelId,
    effort: snapshot.effort,
    existing,
  };
}
