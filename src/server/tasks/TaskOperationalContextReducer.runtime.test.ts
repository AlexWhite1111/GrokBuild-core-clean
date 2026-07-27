import assert from "node:assert/strict";
import test from "node:test";
import type { TaskEventEnvelope } from "../../shared/contracts.js";
import { TaskOperationalContextReducer } from "./TaskOperationalContextReducer.js";

test("child transcript chunks never enter or recompute parent operational context", () => {
  const reducer = new TaskOperationalContextReducer();
  for (let sequence = 1; sequence <= 2_000; sequence += 1) {
    assert.equal(reducer.observe(childChunk(sequence)), false);
  }

  assert.equal(reducer.semanticEventCount, 0);
  assert.equal(reducer.recomputeCount, 0);
  assert.deepEqual(reducer.snapshot(), {
    currentTodo: null,
    activeWork: [],
    history: [],
  });
  assert.equal(reducer.recomputeCount, 0);
});

function childChunk(sequence: number): TaskEventEnvelope {
  return {
    eventId: `child-chunk-${sequence}`,
    taskId: "parent",
    turnId: "child:session-child:turn",
    connectionEpoch: 1,
    sequence,
    source: "acp",
    method: "child/session/update:agent_message_chunk",
    occurredAt: "2026-07-20T00:00:00.000Z",
    payload: {
      sessionId: "session-child",
      text: "x",
    },
  };
}
