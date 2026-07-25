import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskEventEnvelope } from "./contracts.js";
import { taskNotificationsFromEvents } from "./taskNotifications.js";

describe("desktop task notification evidence", () => {
  it("projects a native completion once per turn", () => {
    const notifications = taskNotificationsFromEvents([
      event("session/prompt:completed", { stopReason: "end_turn" }),
      event("session/prompt:completed", { stopReason: "end_turn" }, "event-repeat"),
    ]);
    assert.deepEqual(notifications, [{
      notificationId: `task:${TASK_ID}:turn:${TURN_ID}:settled`,
      kind: "completed",
    }]);
  });

  it("projects cancellation, failure, and disconnect as interrupted", () => {
    for (const input of [
      event("session/prompt:completed", { stopReason: "cancelled" }),
      event("session/prompt:failed", { code: "PROMPT_FAILED" }),
      event("task/connection:interrupted", { code: "ACP_DISCONNECTED" }),
    ]) {
      assert.deepEqual(taskNotificationsFromEvents([input]), [{
        notificationId: `task:${TASK_ID}:turn:${TURN_ID}:settled`,
        kind: "interrupted",
      }]);
    }
  });

  it("projects each new native Gate as waiting for the user", () => {
    assert.deepEqual(taskNotificationsFromEvents([
      event("gate/question", { gateId: GATE_ID, kind: "question" }),
    ]), [{
      notificationId: `task:${TASK_ID}:gate:${GATE_ID}`,
      kind: "waiting",
    }]);
  });

  it("ignores process, replay, and gate-resolution events", () => {
    assert.deepEqual(taskNotificationsFromEvents([
      event("session/update:agent_thought_chunk", {}),
      event("x.ai/session_notification", { type: "turn_completed" }),
      event("gate/question/resolved", { gateId: GATE_ID }),
      event("task/connection:restored", {}),
    ]), []);
  });
});

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const GATE_ID = "gate-native-question";

function event(method: string, payload: unknown, eventId = "event-native"): TaskEventEnvelope {
  return {
    eventId,
    taskId: TASK_ID,
    turnId: TURN_ID,
    connectionEpoch: 1,
    sequence: 1,
    source: method.startsWith("x.ai/") ? "xai" : method.startsWith("task/") ? "supervisor" : "acp",
    method,
    occurredAt: "2026-07-20T00:00:00.000Z",
    payload,
  };
}
