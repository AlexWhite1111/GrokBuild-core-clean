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

test("resume reapplies the last official session permission through the structured control", async () => {
  const client = new CapabilityClient(undefined, false);
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.taskId = "session-fixture";
  snapshot.sessionId = "session-fixture";
  snapshot.connection = "unloaded";
  snapshot.permission = {
    requested: "alwaysApprove",
    effective: "alwaysApprove",
    base: "ask",
    modes: [],
  };
  const actor = new TaskActor(actorOptions(client, {
    snapshot,
    messages: [],
    events: [],
    context: {} as never,
  }));

  const resumed = await actor.resume();

  assert.equal(client.yoloWrites, 1);
  assert.equal(resumed.permission.effective, "alwaysApprove");
  assert.equal(
    resumed.permission.modes.find((mode) => mode.mode === "alwaysApprove")?.effective,
    true,
  );
  actor.stop();
});

test("Goal command reconciles official Goal history when live ACP omits goal_updated", async () => {
  const client = new CapabilityClient([{
    name: "goal",
    description: "Official Goal",
    input: { hint: "objective" },
  }]);
  const official = createTaskSnapshotFixture("project-fixture");
  official.taskId = "session-fixture";
  official.sessionId = "session-fixture";
  official.goal = {
    status: "inactive",
    lastOutcome: "completed",
    objective: "Goal projection probe",
    timeUsedSeconds: 3,
    source: "native",
    updatedAt: "2026-07-25T00:00:03.000Z",
    telemetry: null,
  };
  const actor = new TaskActor(actorOptions(client, undefined, {
    readChildDetail: () => null,
    readDetail: () => ({
      snapshot: official,
      messages: [],
      context: { currentTodo: null, activeWork: [], history: [] },
      events: [{
        eventId: "official:session-fixture:1",
        taskId: "session-fixture",
        turnId: "official-turn",
        connectionEpoch: 1,
        sequence: 1,
        source: "acp",
        method: "task/goal:structured",
        occurredAt: "2026-07-25T00:00:03.000Z",
        payload: {
          goalId: "goal-probe",
          status: "inactive",
          lastOutcome: "completed",
          objective: "Goal projection probe",
          timeUsedSeconds: 3,
        },
      }],
    }),
  }));
  await actor.createSession();

  const completed = await actor.executeGoal(
    "3ed72d17-2fb4-4203-a161-8c4059a11f8b",
    "set",
    "Goal projection probe",
  );

  assert.equal(completed.goal.lastOutcome, "completed");
  assert.equal(completed.goal.objective, "Goal projection probe");
  assert.equal(actor.detail.events.some((event) => event.method === "task/goal:structured"), true);
  actor.stop();
});

test("an official Goal transition acknowledges its command without accepting telemetry noise", async () => {
  const completion = deferred<unknown>();
  class GoalReceiptClient extends CapabilityClient {
    override prompt(_sessionId: string, text: string) {
      this.prompts.push(text);
      return completion.promise;
    }
  }
  const client = new GoalReceiptClient([{
    name: "goal",
    description: "Official Goal",
    input: { hint: "objective" },
  }]);
  const actor = new TaskActor(actorOptions(client));
  await actor.createSession();
  client.emit("notification", {
    method: "x.ai/session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "goal_updated",
        goal_id: "goal-fast",
        objective: "Old Goal",
        status: "active",
      },
    },
  });

  const submitted = actor.executeGoal("goal-live-receipt", "set", "Fast Goal");
  let received = false;
  void submitted.then(() => { received = true; });
  await settleMicrotasks();
  client.emit("notification", {
    method: "x.ai/session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "goal_updated",
        goal_id: "goal-fast",
        objective: "Old Goal",
        status: "active",
        elapsed_ms: 1_000,
      },
    },
  });
  await settleMicrotasks();
  assert.equal(received, false);
  client.emit("notification", {
    method: "x.ai/session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "goal_updated",
        goal_id: "goal-fast",
        objective: "Fast Goal",
        status: "active",
      },
    },
  });

  const snapshot = await Promise.race([
    submitted,
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error("Goal receipt waited for the prompt timeout.")),
      100,
    )),
  ]);
  assert.equal(snapshot.goal.status, "active");
  assert.equal(snapshot.goal.objective, "Fast Goal");

  completion.resolve({ stopReason: "end_turn" });
  await settleMicrotasks();
  actor.stop();
});

test("an active Plan session can return to normal mode", async () => {
  const client = new CapabilityClient();
  const actor = new TaskActor(actorOptions(client));
  await actor.createSession();
  const modeActor = actor as unknown as {
    setWorkMode(mode: "normal" | "plan"): Promise<TaskSnapshot>;
  };

  const snapshot = await modeActor.setWorkMode("normal");

  assert.equal(snapshot.workMode, "normal");
  assert.deepEqual(client.modeWrites, ["normal"]);
  actor.stop();
});

class CapabilityClient extends EventEmitter {
  readonly prompts: string[] = [];
  readonly modeWrites: string[] = [];
  yoloWrites = 0;

  constructor(
    private readonly availableCommands?: unknown[],
    private yolo = false,
  ) {
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
    this.yoloWrites += 1;
    this.yolo = enabled;
    return { sessionId, yolo: this.yolo };
  }

  async readSessionRosterState(sessionId: string) {
    return { sessionId, yolo: this.yolo };
  }

  async setMode(_sessionId: string, mode: string) {
    this.modeWrites.push(mode);
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
  taskStore: Pick<TaskActorOptions["taskStore"], "readChildDetail" | "readDetail"> = {
    readChildDetail: () => null,
    readDetail: () => null,
  },
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
    taskStore: taskStore as TaskActorOptions["taskStore"],
    publishNotification: () => undefined,
    workMode: "normal",
    permission: existing?.snapshot.permission.requested || "ask",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
