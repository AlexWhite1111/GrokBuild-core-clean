import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import {
  taskPageError,
  taskSessionSettingsBlocker,
} from "./taskPageLogic.js";

test("blank task errors never reserve an empty notice row", () => {
  assert.equal(taskPageError(" \n ", null), null);
  assert.equal(
    taskPageError(null, { code: "EMPTY", message: "\t" }),
    null,
  );
  assert.equal(taskPageError("  visible  ", null), "visible");
});

test("session-setting readiness mirrors the server history boundary", () => {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.turn = "idle";
  const detail = {
    snapshot,
    messages: [],
    events: [],
    context: { currentTodo: null, activeWork: [], history: [] },
  };

  assert.equal(taskSessionSettingsBlocker(detail), null);
  snapshot.goal.status = "active";
  assert.equal(taskSessionSettingsBlocker(detail)?.kind, "goal");
  snapshot.goal.status = "inactive";
  snapshot.activities.running = 1;
  assert.equal(taskSessionSettingsBlocker(detail)?.kind, "activity");
});
