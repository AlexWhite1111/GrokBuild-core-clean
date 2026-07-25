import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { applyGoalSessionUpdate } from "./taskGoalProjection.js";

test("Goal lifecycle changes only through official goal_updated projection", () => {
  const goal = createTaskSnapshotFixture("project-fixture").goal;
  const activatedAt = new Date("2026-07-25T00:00:00.000Z");

  assert.equal(applyGoalSessionUpdate(goal, {
    status: "active",
    objective: "统一官方链条",
    goalId: "goal-native",
    elapsedMs: 4_000,
  }, activatedAt), true);
  assert.equal(goal.source, "native");
  assert.equal(goal.status, "active");
  assert.equal(goal.objective, "统一官方链条");
  assert.equal(goal.timeUsedSeconds, 4);

  applyGoalSessionUpdate(goal, { tokensUsed: 128, phase: "working" }, new Date("2026-07-25T00:00:01.000Z"));
  assert.equal(goal.status, "active");
  assert.equal(goal.objective, "统一官方链条");
  assert.equal(goal.telemetry?.tokensUsed, 128);
  assert.equal(goal.updatedAt, activatedAt.toISOString());
  assert.equal(goal.timeUsedSeconds, 4);

  applyGoalSessionUpdate(goal, { status: "cleared" }, new Date("2026-07-25T00:00:02.000Z"));
  assert.equal(goal.source, "native");
  assert.equal(goal.status, "inactive");
  assert.equal(goal.lastOutcome, "cleared");
  assert.equal(goal.objective, null);
  assert.equal(goal.timeUsedSeconds, 6);
});

test("Goal identity resets elapsed state and an explicit empty objective clears it", () => {
  const goal = createTaskSnapshotFixture("project-fixture").goal;
  goal.status = "active";
  goal.objective = "Old objective";
  goal.timeUsedSeconds = 12;
  goal.updatedAt = "2026-07-25T00:00:00.000Z";
  goal.telemetry = null;

  applyGoalSessionUpdate(goal, {
    status: "active",
    goalId: "goal-new",
    elapsedMs: 0,
  }, new Date("2026-07-25T00:00:12.000Z"));

  assert.equal(goal.telemetry?.goalId, "goal-new");
  assert.equal(goal.timeUsedSeconds, 0);
  assert.equal(goal.objective, null);

  applyGoalSessionUpdate(goal, { objective: "Temporary" });
  assert.equal(goal.objective, "Temporary");
  applyGoalSessionUpdate(goal, { objective: "" });
  assert.equal(goal.objective, null);
});

test("Goal infra pause is projected as paused from the official update", () => {
  const goal = createTaskSnapshotFixture("project-fixture").goal;
  goal.status = "active";
  goal.objective = "Wait for connectivity";
  goal.timeUsedSeconds = 3;
  goal.updatedAt = "2026-07-25T00:00:00.000Z";

  assert.equal(applyGoalSessionUpdate(goal, {
    status: "infra_paused",
    goalId: "goal-native",
    elapsedMs: 4_000,
  }, new Date("2026-07-25T00:00:04.000Z")), true);
  assert.equal(goal.source, "native");
  assert.equal(goal.status, "paused");
  assert.equal(goal.objective, "Wait for connectivity");
  assert.equal(goal.timeUsedSeconds, 4);
  assert.equal(goal.telemetry?.goalId, "goal-native");
});

test("Goal transitions remain append-only across consecutive Goals", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-goal-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.taskId = "session-goal";
  snapshot.sessionId = "session-goal";
  snapshot.turn = "idle";
  snapshot.currentPromptExecutionId = null;
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );

  for (const [turnId, goal] of [
    ["turn-1", { status: "active", objective: "First", goal_id: "goal-1", elapsed_ms: 1_000 }],
    ["turn-1", { status: "completed", goal_id: "goal-1", elapsed_ms: 2_000 }],
    ["turn-2", { status: "active", objective: "Second", goal_id: "goal-2", elapsed_ms: 500 }],
    ["turn-2", { status: "completed", goal_id: "goal-2", elapsed_ms: 1_500 }],
  ] as const) {
    projection.applyNotification({
      kind: "acp",
      turnId,
      params: { sessionId: "session-goal", update: { sessionUpdate: "goal_updated", ...goal } },
    });
  }

  const transitions = projection.detail().events.filter((event) => event.method === "task/goal:structured");
  assert.equal(transitions.length, 4);
  assert.deepEqual(transitions.map((event) => (event.payload as { goalId?: string }).goalId), [
    "goal-1", "goal-1", "goal-2", "goal-2",
  ]);
});
