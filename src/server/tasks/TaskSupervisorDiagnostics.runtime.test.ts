import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { projectTaskDiagnostics } from "./TaskSupervisor.js";

test("protocol diagnostics are derived from official projected events", () => {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const diagnostics = projectTaskDiagnostics([{
    snapshot,
    messages: [],
    context: { currentTodo: null, activeWork: [], history: [] },
    events: [0, 1].map((sequence) => ({
      eventId: `unknown-${sequence}`,
      taskId: snapshot.taskId,
      turnId: null,
      connectionEpoch: 1,
      sequence,
      source: "acp" as const,
      method: "session/update:unknown",
      occurredAt: `2026-07-25T00:00:0${sequence}.000Z`,
      payload: { sessionUpdate: "unknown" },
    })),
  }]);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.count, 2);
  assert.equal(diagnostics[0]?.summary, "Unknown protocol event");
  assert.equal(diagnostics[0]?.lastSeenAt, "2026-07-25T00:00:01.000Z");
});
