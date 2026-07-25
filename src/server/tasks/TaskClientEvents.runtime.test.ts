import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { OfficialAcpClient, ReverseRequestEvent } from "../acp/OfficialAcpClient.js";
import { XAI_METHODS } from "../acp/XaiMethodRegistry.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { PromptEchoQueue } from "./PromptEchoQueue.js";
import { wireTaskClientEvents } from "./TaskClientEvents.js";
import type { TaskRuntimeContext } from "./TaskRuntimeContext.js";
import { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { createTaskRuntimeContext } from "./taskActorRuntimeContext.js";

test("child questions and Plan reviews enter the existing Gate queue", () => {
  const client = new EventEmitter();
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.sessionId = "parent-session";
  snapshot.permission.effective = "ask";
  const projection = {
    snapshot,
    addGate(gate: typeof snapshot.gates[number]) {
      snapshot.gates.push(gate);
    },
  } as unknown as TaskRuntimeProjection;
  wireClient(client, projection);

  for (const event of [
    {
      gateId: "child-question",
      requestId: 1,
      method: XAI_METHODS.askUserQuestion,
      params: {
        sessionId: "child-session",
        questions: [{ question: "Need input?" }],
      },
    },
    {
      gateId: "child-plan",
      requestId: 2,
      method: XAI_METHODS.exitPlanMode,
      params: {
        sessionId: "child-session",
        planContent: "# Child plan",
      },
    },
  ] satisfies ReverseRequestEvent[]) {
    client.emit("reverseRequest", event);
  }

  assert.deepEqual(snapshot.gates.map((gate) => gate.kind), ["question", "planReview"]);
  assert.deepEqual(snapshot.gates.map((gate) =>
    (gate.payload as Record<string, unknown>).sessionScope), ["child", "child"]);
});

test("terminal receipts match an exact active turn and never guess among several", () => {
  const activeTurns = new Map([
    ["turn-a", { completion: Promise.resolve(), requestId: "request-a" }],
    ["turn-b", { completion: Promise.resolve(), requestId: "request-b" }],
  ]);
  const projection = {
    turnForPrompt: (promptId?: string) => promptId === "native-b" ? "turn-b" : null,
  } as unknown as TaskRuntimeProjection;
  const context = createTaskRuntimeContext({
    client: new EventEmitter() as unknown as OfficialAcpClient,
    projection,
    projectPath: "/tmp",
    activeTurns,
    acceptedWaiters: new Map(),
    promptEchoes: new PromptEchoQueue(),
    latestTurnId: () => "turn-b",
    isStopped: () => false,
    refreshContextWindow: () => false,
    settleTurn: () => undefined,
    touch: () => undefined,
    change: () => undefined,
    disconnectMachine: () => undefined,
  });

  assert.equal(context.completionReceipt({ _meta: { requestId: "request-b" } }).turnId, "turn-b");
  assert.equal(context.completionReceipt({ promptId: "native-b" }).turnId, "turn-b");
  assert.equal(context.completionReceipt({}).turnId, null);

  activeTurns.delete("turn-b");
  assert.equal(context.completionReceipt({}).turnId, "turn-a");
});

test("the official underscore session update projects a live subagent", (t) => {
  const { client, projection } = liveProjection(t);
  client.emit("notification", {
    method: "_x.ai/session/update",
    params: {
      sessionId: "parent-session",
      update: {
        sessionUpdate: "subagent_spawned",
        subagent_id: "child-session",
        child_session_id: "child-session",
        description: "goal achievement skeptic",
      },
    },
  });

  assert.deepEqual(projection.detail().context.activeWork.map((item) => ({
    id: item.id,
    childSessionId: item.childSessionId,
    status: item.status,
    title: item.title,
  })), [{
    id: "child-session",
    childSessionId: "child-session",
    status: "running",
    title: "goal achievement skeptic",
  }]);
});

test("late chunks from one official prompt stay in one assistant message", (t) => {
  const { client, projection } = liveProjection(t);
  for (const text of ["收", "尾"]) {
    client.emit("notification", {
      method: "session/update",
      params: {
        sessionId: "parent-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
        _meta: {
          promptId: "interject-fallback",
          turnStartMs: 1_000,
          streamStartMs: 2_000,
        },
      },
    });
  }

  assert.deepEqual(projection.detail().messages.map((message) => message.text), ["收尾"]);
});

function liveProjection(t: { after(callback: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-live-projection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.sessionId = "parent-session";
  const projection = new TaskRuntimeProjection(
    snapshot,
    new JsonStateStore(path.join(root, "state.json")),
    {},
  );
  const client = new EventEmitter();
  wireClient(client, projection);
  return { client, projection };
}

function wireClient(client: EventEmitter, projection: TaskRuntimeProjection): void {
  wireTaskClientEvents({
    client: client as unknown as OfficialAcpClient,
    projection,
    projectPath: "/tmp",
    activeTurnId: () => null,
    latestTurnId: () => null,
    isStopped: () => false,
    claimUserEcho: () => undefined,
    promptReceiptsFromQueue: () => [],
    completionReceipt: () => ({ requestIds: [], turnId: null }),
    acceptPending: () => undefined,
    settleTurn: () => undefined,
    refreshContextWindow: () => false,
    touch: () => undefined,
    change: () => undefined,
    disconnect: () => undefined,
  });
}
