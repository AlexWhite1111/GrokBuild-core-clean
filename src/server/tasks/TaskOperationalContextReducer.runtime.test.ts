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

test("command registry and ordinary tool metadata do not dirty Todo context", () => {
  const reducer = new TaskOperationalContextReducer();
  assert.equal(reducer.observe(event(1, "session/update:available_commands_update", {})), false);
  assert.equal(reducer.observe(event(2, "session/update:usage_update", { tokens: 100 })), false);
  assert.equal(reducer.observe(event(3, "session/update:tool_call", {
    toolCallId: "web-1",
    toolName: "web_fetch",
    status: "running",
  })), false);
  assert.equal(reducer.observe(event(4, "session/update:tool_call_update", {
    toolCallId: "web-1",
    status: "completed",
  })), false);
  assert.equal(reducer.semanticEventCount, 0);
  assert.equal(reducer.recomputeCount, 0);
});

test("work tool updates remain admitted after only the first packet carries metadata", () => {
  const reducer = new TaskOperationalContextReducer();
  assert.equal(reducer.observe(event(1, "session/update:tool_call", {
    toolCallId: "background-1",
    toolName: "run_terminal_command",
    activityType: "background",
    status: "running",
  })), true);
  assert.equal(reducer.observe(event(2, "session/update:tool_call_update", {
    toolCallId: "background-1",
    status: "completed",
  })), true);
  assert.equal(reducer.semanticEventCount, 2);
});

function event(sequence: number, method: string, payload: unknown): TaskEventEnvelope {
  return {
    eventId: `event-${sequence}`,
    taskId: "parent",
    turnId: null,
    connectionEpoch: 1,
    sequence,
    source: "acp",
    method,
    occurredAt: "2026-07-20T00:00:00.000Z",
    payload,
  };
}

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
