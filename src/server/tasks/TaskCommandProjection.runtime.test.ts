import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { TaskCommandProjection } from "./TaskCommandProjection.js";

test("an older command completion does not overwrite the newer active command", () => {
  const snapshot = createTaskSnapshotFixture("project-a");
  const projection = new TaskCommandProjection();

  projection.begin(snapshot, "turn-a", "request-a", "goal", "first");
  projection.begin(snapshot, "turn-b", "request-b", "goal", "second");
  projection.finish(snapshot, "turn-a", "request-a", "goal");

  assert.deepEqual(snapshot.commands.execution, {
    requestId: "request-b",
    name: "goal",
    state: "pending",
    message: null,
  });

  projection.finish(snapshot, "turn-b", "request-b", "goal");
  assert.equal(snapshot.commands.execution?.state, "confirmed");
});
