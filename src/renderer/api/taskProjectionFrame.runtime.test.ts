import assert from "node:assert/strict";
import test from "node:test";
import type { TaskDetailProjection, TaskProjectionFrame, WorkspaceProjection } from "../../shared/contracts.js";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { applyTaskDetailToWorkspace, applyTaskProjectionFrame } from "./taskProjectionFrame.js";

test("delta frames replace only changed projection rows and preserve unchanged history references", () => {
  const current = detailFixture();
  const firstMessage = current.messages[0];
  const events = current.events;
  const context = { currentTodo: null, activeWork: [], history: [] };
  const frame: TaskProjectionFrame = {
    kind: "delta",
    snapshot: {
      ...current.snapshot,
      revision: current.snapshot.revision + 1,
      updatedAt: "2026-07-20T00:00:01.000Z",
    },
    context,
    messageCount: 2,
    messages: [{ index: 1, message: { ...current.messages[1], text: "AB" } }],
    eventCount: 0,
    events: [],
  };

  const applied = applyTaskProjectionFrame(current, frame);

  assert.equal(applied.synchronized, true);
  assert.equal(applied.structural, false);
  assert.equal(applied.accepted, true);
  assert.equal(applied.detail?.messages[0], firstMessage);
  assert.notEqual(applied.detail?.messages[1], current.messages[1]);
  assert.equal(applied.detail?.messages[1]?.text, "AB");
  assert.equal(applied.detail?.events, events);
  assert.equal(applied.detail?.context, context);
  assert.equal(applied.detail?.snapshot, frame.snapshot);
});

test("a text-only delta preserves the existing operational context reference", () => {
  const current = detailFixture();
  const applied = applyTaskProjectionFrame(current, {
    kind: "delta",
    snapshot: {
      ...current.snapshot,
      revision: current.snapshot.revision + 1,
    },
    messageCount: current.messages.length,
    messages: [{
      index: 1,
      message: { ...current.messages[1], text: "AB" },
    }],
    eventCount: current.events.length,
    events: [],
  });

  assert.equal(applied.accepted, true);
  assert.equal(applied.detail?.context, current.context);
});

test("delta frames append complete new rows without retransmitting existing history", () => {
  const current = detailFixture();
  const message = {
    blockId: "assistant-2",
    role: "assistant" as const,
    text: "new",
    turnId: "turn-2",
    streaming: true,
    createdAt: current.snapshot.createdAt,
  };
  const event = {
    eventId: "event-1",
    taskId: current.snapshot.taskId,
    turnId: "turn-2",
    connectionEpoch: 1,
    sequence: 1,
    source: "xai" as const,
    method: "x.ai/session_notification",
    occurredAt: current.snapshot.createdAt,
    payload: { type: "subagent_progress" },
  };
  const applied = applyTaskProjectionFrame(current, {
    kind: "delta",
    snapshot: { ...current.snapshot, revision: current.snapshot.revision + 1 },
    context: current.context,
    messageCount: 3,
    messages: [{ index: 2, message }],
    eventCount: 1,
    events: [{ index: 0, event }],
  });

  assert.equal(applied.synchronized, true);
  assert.equal(applied.structural, true);
  assert.equal(applied.detail?.messages[0], current.messages[0]);
  assert.equal(applied.detail?.messages[2], message);
  assert.equal(applied.detail?.events[0], event);
});

test("delta frames reject gaps, identity drift and new epochs while stale frames never roll back", () => {
  const current = detailFixture();
  current.snapshot.revision = 5;
  const mismatched: TaskProjectionFrame = {
    kind: "delta",
    snapshot: {
      ...current.snapshot,
      revision: 6,
    },
    context: current.context,
    messageCount: 4,
    messages: [{ index: 3, message: { ...current.messages[1], blockId: "gap", text: "new" } }],
    eventCount: 0,
    events: [],
  };
  const stale: TaskProjectionFrame = {
    ...mismatched,
    snapshot: { ...mismatched.snapshot, revision: 4 },
  };

  const divergence = applyTaskProjectionFrame(current, mismatched);
  assert.equal(divergence.synchronized, false);
  assert.equal(divergence.accepted, false);
  assert.equal(divergence.detail, current);

  const newEpoch = applyTaskProjectionFrame(current, {
    ...mismatched,
    snapshot: { ...mismatched.snapshot, projectionEpoch: "runtime:new" },
    messageCount: 2,
    messages: [{ index: 1, message: { ...current.messages[1], text: "new" } }],
  });
  assert.equal(newEpoch.synchronized, false);
  assert.equal(newEpoch.detail, current);

  const identityDrift = applyTaskProjectionFrame(current, {
    ...mismatched,
    messageCount: 2,
    messages: [{ index: 1, message: { ...current.messages[1], blockId: "different" } }],
  });
  assert.equal(identityDrift.synchronized, false);
  assert.equal(identityDrift.detail, current);

  const ignored = applyTaskProjectionFrame(current, stale);
  assert.equal(ignored.synchronized, true);
  assert.equal(ignored.accepted, false);
  assert.equal(ignored.detail, current);
});

test("an accepted terminal snapshot synchronizes the matching sidebar task immediately", () => {
  const detail = detailFixture();
  detail.snapshot.turn = "idle";
  detail.snapshot.currentPromptExecutionId = null;
  detail.snapshot.revision = 2;
  detail.snapshot.updatedAt = "2026-07-20T00:00:02.000Z";
  const workspace = workspaceFixture();

  const next = applyTaskDetailToWorkspace(workspace, detail);
  const task = next?.tasks[0];

  assert.notEqual(next, workspace);
  assert.equal(next?.projects, workspace.projects);
  assert.equal(task?.active, false);
  assert.equal(task?.canStop, false);
  assert.equal(task?.agentState, "idle");
  assert.equal(task?.naturalStatus, "已就绪");
  assert.equal(task?.hasUserTurn, true);
  assert.equal(task?.updatedAt, detail.snapshot.updatedAt);
});

function detailFixture(): TaskDetailProjection {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  return {
    snapshot,
    messages: [
      {
        blockId: "user",
        role: "user",
        text: "prompt",
        turnId: "turn-1",
        streaming: false,
        createdAt: snapshot.createdAt,
      },
      {
        blockId: "assistant",
        role: "assistant",
        text: "A",
        turnId: "turn-1",
        streaming: true,
        createdAt: snapshot.createdAt,
      },
    ],
    events: [],
    context: { currentTodo: null, activeWork: [], history: [] },
  };
}

function workspaceFixture(): WorkspaceProjection {
  return {
    projects: [],
    tasks: [{
      taskId: "task-fixture",
      projectId: "project-fixture",
      sessionId: "session-parent",
      hasUserTurn: false,
      title: "性能审查",
      status: "ready:running",
      active: true,
      canStop: true,
      needsAttention: false,
      pinned: true,
      archived: false,
      agentState: "running",
      naturalStatus: "执行中",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    }],
    systemPromptPresets: [],
    supervisor: {
      activeAgents: 1,
      softLimit: 4,
      hardLimit: 8,
      maxAgents: 8,
      maxAllowed: 16,
      idleRetirementMinutes: 30,
      permissionModes: [],
    },
  };
}
