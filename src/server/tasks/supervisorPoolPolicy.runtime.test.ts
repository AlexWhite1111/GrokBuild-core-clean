import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { projectSourceControlLocked } from "./supervisorPoolPolicy.js";
import type { TaskActor } from "./TaskActor.js";

test("an unloaded official Goal still locks Source Control", () => {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.goal.status = "active";
  snapshot.connection = "unloaded";
  snapshot.turn = "idle";

  assert.equal(projectSourceControlLocked(
    new Map<string, TaskActor>(),
    [snapshot],
    "project-fixture",
  ), true);

  snapshot.goal.status = "inactive";
  assert.equal(projectSourceControlLocked(
    new Map<string, TaskActor>(),
    [snapshot],
    "project-fixture",
  ), false);
});
