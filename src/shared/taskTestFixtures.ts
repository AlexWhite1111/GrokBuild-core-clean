import type { TaskSnapshot } from "./contracts.js";

/** Minimal complete snapshot shared by cross-layer contract tests. */
export function createTaskSnapshotFixture(projectId: string): TaskSnapshot {
  const now = "2026-07-20T00:00:00.000Z";
  return {
    taskId: "task-fixture",
    projectId,
    grokHomeId: "native",
    sessionId: "session-parent",
    title: "性能审查",
    connection: "ready",
    turn: "running",
    currentPromptExecutionId: "turn-1",
    workMode: "normal",
    permission: { requested: "ask", effective: "ask", base: "ask", modes: [] },
    sandbox: {
      requested: "workspace",
      effective: "workspace",
      locked: true,
      mechanism: "seatbelt",
      verified: true,
      source: "task-create",
    },
    plan: { document: null },
    goal: {
      status: "unknown",
      lastOutcome: null,
      objective: null,
      timeUsedSeconds: 0,
      source: "none",
      updatedAt: null,
      telemetry: null,
    },
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
    modelId: null,
    effort: null,
    configOptions: [],
    commands: { available: [], execution: null },
    error: null,
    createdAt: now,
    updatedAt: now,
    projectionEpoch: "fixture-runtime",
    revision: 0,
  };
}
