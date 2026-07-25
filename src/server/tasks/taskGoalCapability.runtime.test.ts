import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { TaskActor } from "./TaskActor.js";
import type { TaskActorOptions } from "./taskTypes.js";

test("initialize advertises Goal before the first conversation and later session updates replace it", async () => {
  const client = new CapabilityClient([{
    name: "goal",
    description: "Official Goal",
    input: { hint: "objective" },
  }]);
  const actor = new TaskActor(actorOptions(client));

  const snapshot = await actor.createSession();

  assert.deepEqual(client.prompts, []);
  assert.deepEqual(snapshot.commands.available, [{
    name: "goal",
    description: "Official Goal",
    inputHint: "objective",
  }]);

  client.emit("notification", {
    method: "session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "status", description: "Status" }],
      },
    },
  });
  assert.deepEqual(actor.snapshot.commands.available.map((command) => command.name), ["status"]);
  actor.stop();
});

test("resume without an initialize Goal advertisement clears stale availability", async () => {
  const client = new CapabilityClient();
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.taskId = "session-fixture";
  snapshot.sessionId = "session-fixture";
  snapshot.connection = "unloaded";
  snapshot.turn = "idle";
  snapshot.currentPromptExecutionId = null;
  snapshot.commands.available = [{ name: "goal", description: "Stale Goal", inputHint: null }];
  const actor = new TaskActor(actorOptions(client, {
    snapshot,
    messages: [],
    events: [],
    context: {} as never,
  }));

  const resumed = await actor.resume();

  assert.deepEqual(resumed.commands.available, []);
  await assert.rejects(actor.executeGoal("goal-status", "status"), /did not advertise \/goal/);
  assert.deepEqual(client.prompts, []);
  actor.stop();
});

class CapabilityClient extends EventEmitter {
  readonly prompts: string[] = [];

  constructor(private readonly availableCommands?: unknown[]) {
    super();
  }

  async start() {
    return {
      protocolVersion: 1,
      ...(this.availableCommands ? { _meta: { availableCommands: this.availableCommands } } : {}),
    };
  }

  async newSession() {
    return {
      sessionId: "session-fixture",
      configOptions: [],
      modes: { currentModeId: "normal" },
    };
  }

  async loadSession() {
    return {
      configOptions: [],
      modes: { currentModeId: "normal" },
    };
  }

  async setYoloMode(sessionId: string, enabled: boolean) {
    return { sessionId, yolo: enabled };
  }

  prompt(_sessionId: string, text: string) {
    this.prompts.push(text);
    return Promise.resolve({ stopReason: "end_turn" });
  }

  stop() {}
  async shutdown() {}
}

function actorOptions(
  client: CapabilityClient,
  existing?: TaskActorOptions["existing"],
): TaskActorOptions {
  return {
    taskId: existing?.snapshot.taskId || "task-fixture",
    projectId: "project-fixture",
    projectPath: "/tmp",
    grokBin: "/usr/bin/false",
    grokHome: "/tmp",
    grokHomeId: "native",
    state: {
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
      entries: () => [],
    } as never,
    taskStore: { readChildDetail: () => null } as never,
    publishNotification: () => undefined,
    workMode: "normal",
    permission: "ask",
    sandbox: "off",
    permissionCapabilities: {
      auto: { available: false },
      alwaysApprove: { available: true },
      acceptEdits: { available: false },
      dontAsk: { available: false },
    },
    existing,
    clientFactory: () => client as unknown as OfficialAcpClient,
  };
}
