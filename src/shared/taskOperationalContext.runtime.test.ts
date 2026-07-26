import assert from "node:assert/strict";
import test from "node:test";
import type { TaskEventEnvelope } from "./contracts.js";
import { projectTaskOperationalContext } from "./taskOperationalContext.js";

test("an ended turn preserves the last official Todo item statuses", () => {
  const context = projectTaskOperationalContext([
    event(1, "session/update:plan", {
      planId: "official-plan",
      entries: [
        { id: "done", content: "Done", status: "completed" },
        { id: "doing", content: "Doing", status: "in_progress" },
        { id: "next", content: "Next", status: "pending" },
      ],
    }),
    event(2, "session/prompt:completed", { stopReason: "end_turn" }),
  ]);

  assert.equal(context.currentTodo, null);
  const todo = context.history.find((item) => item.kind === "todo");
  assert.equal(todo?.kind, "todo");
  if (todo?.kind !== "todo") return;
  assert.equal(todo.todo.endReason, "interrupted");
  assert.deepEqual(todo.todo.entries.map((item) => item.status), [
    "completed",
    "inProgress",
    "pending",
  ]);
});

function event(sequence: number, method: string, payload: unknown): TaskEventEnvelope {
  return {
    eventId: `event-${sequence}`,
    taskId: "task",
    turnId: "turn",
    connectionEpoch: 1,
    sequence,
    source: "acp",
    method,
    occurredAt: `2026-07-20T00:00:0${sequence}.000Z`,
    payload,
  };
}
