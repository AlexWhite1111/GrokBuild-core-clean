import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GateDecision, PlanReviewPendingGate, TaskSnapshot } from "../../shared/contracts.js";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { XAI_METHODS } from "../acp/XaiMethodRegistry.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { PlanReviewState, planContentHash } from "./PlanReviewState.js";
import type { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { decideTaskGate, toGate } from "./taskGates.js";

test("Plan decisions resolve the native Gate with only official outcomes", () => {
  const cases = [
    { decision: "approved", expected: { outcome: "approved" } },
    { decision: "cancelled", expected: { outcome: "cancelled" } },
    {
      decision: "cancelled",
      feedback: "Please discuss the rollout order.",
      expected: { outcome: "cancelled", feedback: "Please discuss the rollout order." },
    },
    { decision: "abandoned", expected: { outcome: "abandoned" } },
  ] as const;

  for (const example of cases) {
    const { client, projection, responses } = planRuntime();
    decideTaskGate(client, projection, planDecision(example.decision, example.feedback), () => undefined);
    assert.deepEqual(responses, [{ gateId: "plan-gate", response: example.expected }]);
    assert.equal(projection.snapshot.gates.length, 0);
  }
});

test("Plan decisions reject invented outcomes and skip actions", () => {
  for (const decision of [
    planDecision("changes_requested"),
    { ...planDecision("cancelled"), action: "skip" as const },
  ]) {
    const { client, projection, responses } = planRuntime();
    assert.throws(
      () => decideTaskGate(client, projection, decision, () => undefined),
      /official outcome|approved, cancelled, or abandoned/,
    );
    assert.equal(responses.length, 0);
    assert.equal(projection.snapshot.gates.length, 1);
  }
});

test("Plan review identity includes the Gate and hashes the complete native document", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-plan-draft-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = "a".repeat(500_000);
  const first = toGate({
    gateId: "gate-a",
    requestId: 1,
    method: XAI_METHODS.exitPlanMode,
    params: { planContent: `${prefix}A`, sessionId: "child-session" },
  }, "/tmp", "turn-a", undefined, { sessionScope: "child" }) as PlanReviewPendingGate;
  const second = toGate({
    gateId: "gate-b",
    requestId: 2,
    method: XAI_METHODS.exitPlanMode,
    params: { planContent: `${prefix}B`, sessionId: "child-session" },
  }, "/tmp", "turn-b", undefined, { sessionScope: "child" }) as PlanReviewPendingGate;
  const firstPayload = first.payload as Record<string, unknown>;
  const secondPayload = second.payload as Record<string, unknown>;

  assert.equal(firstPayload.content, secondPayload.content);
  assert.equal(firstPayload.baseHash, planContentHash(`${prefix}A`));
  assert.equal(secondPayload.baseHash, planContentHash(`${prefix}B`));
  assert.notEqual(firstPayload.baseHash, secondPayload.baseHash);
  assert.equal(firstPayload.sessionScope, "child");

  const drafts = new PlanReviewState(new JsonStateStore(path.join(root, "state.json")));
  const sharedHash = "a".repeat(64);
  drafts.save("task", { gateId: "gate-a", baseHash: sharedHash }, "Draft A");
  drafts.save("task", { gateId: "gate-b", baseHash: sharedHash }, "Draft B");
  assert.equal(drafts.read("task", { gateId: "gate-a", baseHash: sharedHash }).draft, "Draft A");
  assert.equal(drafts.read("task", { gateId: "gate-b", baseHash: sharedHash }).draft, "Draft B");
});

function planDecision(decision: string, feedback?: string): GateDecision {
  return {
    requestId: crypto.randomUUID(),
    gateId: "plan-gate",
    action: "submit",
    value: { decision, ...(feedback === undefined ? {} : { feedback }) },
  };
}

function planRuntime(): {
  client: OfficialAcpClient;
  projection: TaskRuntimeProjection;
  responses: Array<{ gateId: string; response: unknown }>;
} {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.plan.document = {
    content: "# Plan",
    fileName: "plan.md",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
  snapshot.gates = [planGate()];
  const responses: Array<{ gateId: string; response: unknown }> = [];
  const client = {
    resolveGate(gateId: string, response: unknown) {
      responses.push({ gateId, response });
    },
  } as unknown as OfficialAcpClient;
  const projection = {
    snapshot,
    removeGate(gateId: string) {
      const index = snapshot.gates.findIndex((gate) => gate.gateId === gateId);
      return index < 0 ? undefined : snapshot.gates.splice(index, 1)[0];
    },
    record() {},
    detail: () => ({ snapshot }),
  } as unknown as TaskRuntimeProjection;
  return { client, projection, responses };
}

function planGate(): PlanReviewPendingGate {
  return {
    gateId: "plan-gate",
    kind: "planReview",
    title: "Review plan",
    risk: "medium",
    payload: {
      content: "# Plan",
      baseHash: "a".repeat(64),
      fileName: "plan.md",
      truncated: false,
    },
    receivedAt: "2026-07-25T00:00:00.000Z",
    turnId: "turn-plan",
    position: 1,
    total: 1,
  };
}
