import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { mergeTaskProjectionChange } from "./TaskSupervisor.js";

test("official streaming chunks publish ordered deltas from the first new message", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-frame-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  const notify = (text: string) => projection.applyNotification({
    kind: "acp",
    turnId: "turn-1",
    params: {
      sessionId: snapshot.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "official-message",
        content: { type: "text", text },
      },
    },
  });

  const first = notify("A");
  const initialFrame = projection.frame(first.projectionChange);
  const second = notify("B");
  const streamingFrame = projection.frame(second.projectionChange);

  assert.equal(first.projectionChange, "text");
  assert.equal(second.projectionChange, "text");
  assert.equal(initialFrame.kind, "text-delta");
  assert.equal(streamingFrame.kind, "text-delta");
  if (initialFrame.kind !== "text-delta" || streamingFrame.kind !== "text-delta") return;
  assert.equal(initialFrame.messages[0]?.kind, "replace");
  assert.equal(initialFrame.messages[0]?.kind === "replace"
    ? initialFrame.messages[0].message.text
    : null, "A");
  assert.equal(streamingFrame.messages[0]?.kind, "append");
  assert.equal(streamingFrame.messages[0]?.kind === "append"
    ? streamingFrame.messages[0].previousTextLength
    : null, 1);
  assert.equal(streamingFrame.messages[0]?.kind === "append"
    ? streamingFrame.messages[0].appendText
    : null, "B");
  assert.equal(streamingFrame.messageCount, 1);
  assert.equal(streamingFrame.messages[0]?.index, 0);
  assert.equal(streamingFrame.snapshot.revision, snapshot.revision);
  assert.equal("context" in initialFrame, false);
  assert.equal("context" in streamingFrame, false);
});

test("a long streaming answer transports only its new official tail after the first frame", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-tail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.commands.available = Array.from({ length: 200 }, (_, index) => ({
    name: `command-${index}`,
    description: `UNCHANGED_COMMAND_REGISTRY:${"z".repeat(200)}`,
    inputHint: null,
  }));
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  const notify = (text: string) => projection.applyNotification({
    kind: "acp",
    turnId: "turn-long",
    params: {
      sessionId: snapshot.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "official-long-message",
        content: { type: "text", text },
      },
    },
  });
  const prefix = `PREFIX_MARKER:${"x".repeat(128 * 1_024)}`;
  projection.frame(notify(prefix).projectionChange);

  const frame = projection.frame(notify("OFFICIAL_TAIL").projectionChange);
  const serialized = JSON.stringify(frame);

  assert.equal(frame.kind, "text-delta");
  if (frame.kind !== "text-delta") return;
  assert.equal(frame.messages[0]?.kind, "append");
  assert.equal(frame.messages[0]?.kind === "append"
    ? frame.messages[0].previousTextLength
    : null, prefix.length);
  assert.equal(frame.messages[0]?.kind === "append"
    ? frame.messages[0].appendText
    : null, "OFFICIAL_TAIL");
  assert.equal(serialized.includes("PREFIX_MARKER"), false);
  assert.equal(serialized.includes("UNCHANGED_COMMAND_REGISTRY"), false);
  assert.ok(serialized.length < 10_000, `${serialized.length} bytes`);
});

test("projection frame coalescing keeps all official notification mixes incremental", () => {
  assert.equal(mergeTaskProjectionChange(null, "delta"), "delta");
  assert.equal(mergeTaskProjectionChange("delta", "delta"), "delta");
  assert.equal(mergeTaskProjectionChange(null, "text"), "text");
  assert.equal(mergeTaskProjectionChange("text", "text"), "text");
  assert.equal(mergeTaskProjectionChange("text", "delta"), "delta");
  assert.equal(mergeTaskProjectionChange("delta", "text"), "delta");
  assert.equal(mergeTaskProjectionChange("delta"), "snapshot");
  assert.equal(mergeTaskProjectionChange("snapshot", "delta"), "snapshot");
});

test("live Web Search completion carries its own official query before history catches up", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-web-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const query = "沪科技版 九年级物理 PDF";
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );

  projection.applyNotification({
    kind: "acp",
    turnId: "turn-1",
    params: {
      sessionId: snapshot.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "ws-1",
        title: "Web search:",
        status: "completed",
        rawOutput: {
          action: { type: "search", query, sources: [] },
          id: "ws-1",
          status: "completed",
        },
      },
    },
  });

  assert.equal(projection.detail().events[0]?.payload.query, query);
});

test("an identical command registry snapshot does not create another projection frame", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-commands-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  const params = {
    sessionId: snapshot.sessionId,
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{
        name: "search",
        description: "Search the official Session",
        input: { hint: "query" },
      }],
    },
  };

  const first = projection.applyNotification({ kind: "acp", turnId: null, params });
  const revision = snapshot.revision;
  const second = projection.applyNotification({
    kind: "acp",
    turnId: null,
    params: structuredClone(params),
  });

  assert.equal(first.projectionChanged, true);
  assert.equal(second.projectionChanged, false);
  assert.equal(snapshot.revision, revision);
  assert.equal(projection.detail().events.length, 1);
});

test("one refresh window can carry multiple changed message identities without a snapshot", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-mixed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  const notify = (type: "agent_message_chunk" | "agent_thought_chunk", messageId: string, text: string) =>
    projection.applyNotification({
      kind: "acp",
      turnId: "turn-1",
      params: {
        sessionId: snapshot.sessionId,
        update: {
          sessionUpdate: type,
          messageId,
          content: { type: "text", text },
        },
      },
    });

  const assistant = notify("agent_message_chunk", "assistant", "A");
  const thought = notify("agent_thought_chunk", "thought", "B");
  const merged = mergeTaskProjectionChange(
    assistant.projectionChange,
    thought.projectionChange,
  );
  const frame = projection.frame(merged === "snapshot" ? undefined : merged);

  assert.equal(frame.kind, "text-delta");
  if (frame.kind !== "text-delta") return;
  assert.equal(frame.messages.length, 2);
  assert.deepEqual(frame.messages.map((entry) =>
    entry.kind === "replace" ? entry.message.text : entry.appendText), ["A", "B"]);
});

test("repeated subagent phase updates coalesce to one latest event row in the same delta", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-subagent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  for (const output of ["phase-one", "phase-two"]) {
    projection.applyNotification({
      kind: "xai",
      method: "x.ai/session_notification",
      turnId: "turn-1",
      params: {
        sessionId: snapshot.sessionId,
        notification: {
          type: "subagent_progress",
          subagent_id: "child-1",
          child_session_id: "child-1",
          output,
        },
      },
    });
  }

  const frame = projection.frame("delta");
  assert.equal(frame.kind, "delta");
  if (frame.kind !== "delta") return;
  assert.equal(frame.events.length, 1);
  assert.equal(frame.eventCount, 1);
  assert.equal(JSON.stringify(frame.events[0]?.event.payload).includes("phase-two"), true);
  assert.equal(JSON.stringify(frame.context).includes("phase-two"), true);
});

test("a structural delta never serializes unchanged transcript or event history", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-projection-size-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  const messages = Array.from({ length: 120 }, (_, index) => ({
    blockId: `message-${index}`,
    role: "assistant" as const,
    text: `${index}:`.padEnd(1_024, "x"),
    turnId: `turn-${index}`,
    streaming: index === 119,
    createdAt: snapshot.createdAt,
  }));
  const events = Array.from({ length: 120 }, (_, index) => ({
    eventId: `event-${index}`,
    taskId: snapshot.taskId,
    turnId: `turn-${index}`,
    connectionEpoch: 1,
    sequence: index + 1,
    source: "acp" as const,
    method: "session/update:tool_call",
    occurredAt: snapshot.createdAt,
    payload: { output: `old-history-marker-${index}:`.padEnd(4_096, "y") },
  }));
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {
      restored: {
        snapshot,
        messages,
        events,
        context: { currentTodo: null, activeWork: [], history: [] },
      },
    },
  );

  const full = JSON.stringify(projection.frame());
  projection.record("xai", "x.ai/session_notification", "turn-current", {
    type: "subagent_progress",
    childSessionId: "child-current",
    output: "current-delta-marker",
  });
  projection.touch();
  const frame = projection.frame("delta");
  const current = JSON.stringify(frame);

  assert.equal(current.includes("message-0"), false);
  assert.equal(current.includes("old-history-marker-0"), false);
  assert.equal(current.includes("current-delta-marker"), true);
  assert.equal(frame.kind, "delta");
  if (frame.kind !== "delta") return;
  assert.equal(frame.messages.length, 0);
  assert.equal(frame.events.length, 1);
  assert.equal(frame.eventCount, 121);
  assert.ok(current.length < full.length / 50, `${current.length} versus ${full.length}`);
});
