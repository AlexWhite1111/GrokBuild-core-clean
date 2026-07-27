import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { TaskActor } from "./TaskActor.js";
import type { TaskProjectionChange } from "./TaskRuntimeProjection.js";

test("TaskActor preserves the lightweight text projection classification", async () => {
  class FakeClient extends EventEmitter {
    async start() { return { protocolVersion: 1 }; }
    async newSession() {
      return { sessionId: "session-fixture", configOptions: [], modes: { currentModeId: "normal" } };
    }
    async setYoloMode(sessionId: string, enabled: boolean) { return { sessionId, yolo: enabled }; }
    stop() {}
    async shutdown() {}
  }
  const client = new FakeClient();
  const actor = new TaskActor(testActorOptions(client as unknown as OfficialAcpClient));
  await actor.createSession();
  const changes: Array<TaskProjectionChange | undefined> = [];
  actor.on("change", (change?: TaskProjectionChange) => changes.push(change));

  client.emit("notification", {
    method: "session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-message",
        content: { type: "text", text: "official text" },
      },
    },
  });

  assert.deepEqual(changes, ["text"]);
  assert.equal(actor.detail.messages.at(-1)?.text, "official text");
  actor.stop();
});

function testActorOptions(client: OfficialAcpClient) {
  return {
    taskId: "task-fixture", projectId: "project-fixture", projectPath: "/tmp",
    grokBin: "/usr/bin/false", grokHome: "/tmp", grokHomeId: "native",
    state: { get: () => undefined, set: () => undefined, delete: () => undefined, entries: () => [] } as never,
    taskStore: { readChildDetail: () => null, readDetail: () => null } as never,
    publishNotification: () => undefined, workMode: "normal" as const, permission: "ask" as const, sandbox: "off" as const,
    permissionCapabilities: { auto: { available: false }, alwaysApprove: { available: false }, acceptEdits: { available: false }, dontAsk: { available: false } },
    clientFactory: () => client,
  };
}
