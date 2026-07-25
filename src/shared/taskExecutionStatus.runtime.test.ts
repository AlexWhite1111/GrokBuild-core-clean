import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "./taskTestFixtures.js";
import { projectTaskExecution } from "./taskExecutionStatus.js";

test("task execution status has one precedence order", () => {
  const base = createTaskSnapshotFixture("project-fixture");

  assert.deepEqual(projectTaskExecution(base), {
    state: "running",
    foregroundBusy: true,
    backgroundBusy: false,
    busy: true,
    needsAttention: false,
    currentTurnOutcome: "running",
    allowedActions: { send: false, stop: true, queue: true, interject: true },
  });
  assert.equal(projectTaskExecution({ ...base, error: { code: "failed", message: "failed" }, gates: [gate()] }).state, "failed");
  assert.equal(projectTaskExecution({ ...base, turn: "idle", gates: [gate()] }).state, "gate");
  assert.equal(projectTaskExecution({ ...base, turn: "idle", activities: { ...base.activities, running: 1 } }).state, "running");
});

test("detached and idle snapshots do not claim the current turn is running", () => {
  const base = createTaskSnapshotFixture("project-fixture");
  const detached = projectTaskExecution({
    ...base,
    turn: "idle",
    connection: "recovering",
  });
  const idle = projectTaskExecution({
    ...base,
    turn: "idle",
  });

  assert.deepEqual(detached, {
    state: "detached",
    foregroundBusy: false,
    backgroundBusy: false,
    busy: false,
    needsAttention: false,
    currentTurnOutcome: "unknown",
    allowedActions: { send: true, stop: false, queue: false, interject: false },
  });
  assert.deepEqual(idle, {
    state: "idle",
    foregroundBusy: false,
    backgroundBusy: false,
    busy: false,
    needsAttention: false,
    currentTurnOutcome: "unknown",
    allowedActions: { send: true, stop: false, queue: false, interject: false },
  });
});

test("background work keeps the task active without taking foreground actions away", () => {
  const base = createTaskSnapshotFixture("project-fixture");
  const execution = projectTaskExecution({
    ...base,
    turn: "idle",
    activities: { ...base.activities, running: 1 },
  });

  assert.equal(execution.state, "running");
  assert.equal(execution.busy, true);
  assert.equal(execution.foregroundBusy, false);
  assert.equal(execution.backgroundBusy, true);
  assert.deepEqual(execution.allowedActions, {
    send: true,
    stop: false,
    queue: false,
    interject: false,
  });
});

function gate() {
  return {
    gateId: "gate",
    kind: "question" as const,
    title: "Question",
    risk: "unknown" as const,
    receivedAt: "2026-07-20T00:00:00.000Z",
    turnId: "turn",
    position: 1,
    total: 1,
    payload: {},
  };
}
