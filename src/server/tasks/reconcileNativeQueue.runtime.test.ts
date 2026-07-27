import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { reconcileNativeQueue } from "./reconcileNativeQueue.js";

test("an explicit unrelated native request never claims a local pending prompt", () => {
  const snapshot = queueSnapshot();
  const accepted = reconcileNativeQueue(snapshot, {
    entries: [
      { id: "native-external", requestId: "external-request", text: "external" },
      { id: "native-local-1", text: "first" },
    ],
  }, new Map());

  assert.deepEqual(accepted, ["local-request-1"]);
  assert.deepEqual(
    snapshot.queue.entries.map((entry) => [entry.entryId, entry.requestId]),
    [
      ["native-external", "external-request"],
      ["native-local-1", "local-request-1"],
      [null, "local-request-2"],
    ],
  );
});

test("an explicit local request is removed from positional fallback correlation", () => {
  const snapshot = queueSnapshot();
  const accepted = reconcileNativeQueue(snapshot, {
    entries: [
      { id: "native-local-1", requestId: "local-request-1", text: "first" },
      { id: "native-local-2", text: "second" },
    ],
  }, new Map());

  assert.deepEqual(new Set(accepted), new Set(["local-request-1", "local-request-2"]));
  assert.deepEqual(
    snapshot.queue.entries.map((entry) => [entry.entryId, entry.requestId]),
    [
      ["native-local-1", "local-request-1"],
      ["native-local-2", "local-request-2"],
    ],
  );
});

function queueSnapshot() {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.queue = {
    available: true,
    runningEntryId: null,
    entries: [
      {
        entryId: null,
        requestId: "local-request-1",
        textPreview: "first",
        version: null,
        position: 0,
        createdAt: "2026-07-20T00:00:00.000Z",
      },
      {
        entryId: null,
        requestId: "local-request-2",
        textPreview: "second",
        version: null,
        position: 1,
        createdAt: "2026-07-20T00:00:01.000Z",
      },
    ],
  };
  snapshot.activities.waiting = 2;
  return snapshot;
}
