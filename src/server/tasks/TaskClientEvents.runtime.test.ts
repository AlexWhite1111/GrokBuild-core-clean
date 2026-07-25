import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { OfficialAcpClient, ReverseRequestEvent } from "../acp/OfficialAcpClient.js";
import { XAI_METHODS } from "../acp/XaiMethodRegistry.js";
import { PromptEchoQueue } from "./PromptEchoQueue.js";
import { wireTaskClientEvents } from "./TaskClientEvents.js";
import type { TaskRuntimeContext } from "./TaskRuntimeContext.js";
import type { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
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
