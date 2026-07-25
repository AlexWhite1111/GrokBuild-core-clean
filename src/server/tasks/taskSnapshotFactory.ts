import type { TaskSnapshot } from "../../shared/contracts.js";
import { permissionModes } from "./taskProtocolRegistry.js";
import { basePermissionMode } from "./taskPermissionState.js";
import type { TaskActorOptions } from "./taskTypes.js";

export function createTaskSnapshot(options: TaskActorOptions): TaskSnapshot {
  const now = new Date().toISOString();
  return {
    taskId: options.taskId,
    projectId: options.projectId,
    grokHomeId: options.grokHomeId,
    sessionId: null,
    title: "New Task",
    connection: "unloaded",
    turn: "idle",
    currentPromptExecutionId: null,
    workMode: options.workMode,
    permission: {
      requested: options.permission,
      effective: "ask",
      base: basePermissionMode(options.permission),
      modes: permissionModes(options.permission, options.permissionCapabilities).map((mode) => ({
        ...mode,
        effective: mode.mode === "ask",
      })),
    },
    sandbox: {
      requested: options.sandbox,
      effective: options.sandbox,
      locked: true,
      mechanism: "none",
      verified: options.sandbox === "off",
      source: "task-create",
    },
    systemPrompt: options.systemPrompt ?? null,
    plan: { document: null },
    goal: { status: "unknown", lastOutcome: null, objective: null, timeUsedSeconds: 0, source: "none", updatedAt: null, telemetry: null },
    contextWindow: null,
    gates: [],
    queue: { available: false, runningEntryId: null, entries: [] },
    activities: {
      batchId: null,
      running: 0,
      unconfirmed: 0,
      waiting: 0,
      failed: 0,
      completed: 0,
      newestActivityAt: null,
    },
    modelId: options.modelId || null,
    effort: options.effort || null,
    configOptions: [],
    commands: { available: [], execution: null },
    error: null,
    createdAt: now,
    updatedAt: now,
    projectionEpoch: "pending-runtime",
    revision: 0,
  };
}
