import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import type { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { TaskActor } from "./TaskActor.js";
import { TaskPermissionRuntime } from "./TaskPermissionRuntime.js";

test("busy permission changes coalesce to the last verified mode", async () => {
  const idle = deferred<void>();
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.sessionId = "session-fixture";
  snapshot.permission = {
    effective: "ask",
    base: "ask",
    modes: [
      { mode: "ask", available: true, hotSwitch: true, effective: true, source: "session", reason: null },
      { mode: "alwaysApprove", available: true, hotSwitch: true, effective: false, source: "session", reason: null },
    ],
  };
  const yoloCalls: boolean[] = [];
  const commandRequests: string[] = [];
  const projection = {
    snapshot,
    beginCommand: (_turnId: string, requestId: string) => { commandRequests.push(requestId); },
    applySessionRosterReceipt: (state: { yolo: boolean }) => {
      snapshot.permission.effective = state.yolo ? "alwaysApprove" : "ask";
      return snapshot.permission.effective;
    },
    record: () => undefined,
    finishCommand: () => undefined,
    detail: () => ({ snapshot }),
  } as unknown as TaskRuntimeProjection;
  const client = {
    setYoloMode: async (_sessionId: string, enabled: boolean) => {
      yoloCalls.push(enabled);
      return { yolo: enabled };
    },
  } as unknown as OfficialAcpClient;
  let isIdle = false;
  const runtime = new TaskPermissionRuntime({
    client,
    projection,
    requested: "ask",
    capabilities: {
      auto: { available: false },
      alwaysApprove: { available: true },
      acceptEdits: { available: false },
      dontAsk: { available: false },
    },
    isIdle: () => isIdle,
    waitForIdle: () => idle.promise,
    isStopped: () => false,
    touch: () => undefined,
    change: () => undefined,
  });

  const first = runtime.setAlwaysApprove("request-1", "on");
  const second = runtime.setAlwaysApprove("request-2", "off");
  const last = runtime.setAlwaysApprove("request-3", "on");
  await settleMicrotasks();
  assert.deepEqual(yoloCalls, []);
  assert.equal(runtime.hasPending, true);

  isIdle = true;
  idle.resolve();
  const results = await Promise.all([first, second, last]);

  assert.deepEqual(yoloCalls, [true]);
  assert.deepEqual(commandRequests, ["request-3"]);
  assert.equal(results.every((result) => result.permission.effective === "alwaysApprove"), true);
  assert.equal(runtime.hasPending, false);
});

test("busy Goal actions dispatch through the official prompt queue without TASK_BUSY", async () => {
  const firstPrompt = deferred<unknown>();
  const pausePrompt = deferred<unknown>();
  const clearPrompt = deferred<unknown>();
  const calls: string[] = [];
  class FakeClient extends EventEmitter {
    async start() { return { protocolVersion: 1 }; }
    async newSession() {
      return {
        sessionId: "session-fixture",
        configOptions: [],
        modes: { currentModeId: "normal" },
      };
    }
    async setYoloMode(sessionId: string, enabled: boolean) {
      return { sessionId, yolo: enabled };
    }
    prompt(_sessionId: string, text: string) {
      calls.push(text);
      if (text === "first") return firstPrompt.promise;
      if (text === "/goal pause") return pausePrompt.promise;
      if (text === "/goal clear") return clearPrompt.promise;
      return Promise.resolve({ stopReason: "end_turn" });
    }
    stop() {}
    async shutdown() {}
  }
  const client = new FakeClient();
  const actor = new TaskActor({
    taskId: "task-fixture",
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
    clientFactory: () => client as unknown as OfficialAcpClient,
  });
  await actor.createSession();
  client.emit("notification", {
    method: "session/update",
    params: {
      sessionId: "session-fixture",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "goal", description: "Goal", inputHint: null }],
      },
    },
  });

  const running = actor.submit("request-first", "first");
  await settleMicrotasks();
  const pause = actor.executeGoal("goal-pause", "pause");
  const clear = actor.executeGoal("goal-clear", "clear");
  await settleMicrotasks();

  assert.deepEqual(calls, ["first", "/goal pause", "/goal clear"]);
  assert.deepEqual(actor.snapshot.queue.entries.map((entry) => entry.textPreview), ["/goal pause", "/goal clear"]);

  client.emit("notification", {
    method: "x.ai/queue/changed",
    params: {
      sessionId: "session-fixture",
      entries: [
        { id: "native-pause", text: "/goal pause", position: 0 },
        { id: "native-clear", text: "/goal clear", position: 1 },
      ],
    },
  });
  await Promise.all([pause, clear]);

  firstPrompt.resolve({ stopReason: "end_turn" });
  pausePrompt.resolve({ stopReason: "end_turn" });
  clearPrompt.resolve({ stopReason: "end_turn" });
  await running;
  await settleMicrotasks();
  actor.stop();
});

test("a busy Plan waits for the official turn, then sets mode before its prompt", async () => {
  const firstPrompt = deferred<unknown>();
  const calls: string[] = [];
  class FakeClient extends EventEmitter {
    async start() { return { protocolVersion: 1 }; }
    async newSession() {
      return {
        sessionId: "session-fixture",
        configOptions: [],
        modes: { currentModeId: "normal" },
      };
    }
    async setYoloMode(sessionId: string, enabled: boolean) {
      return { sessionId, yolo: enabled };
    }
    async setMode(_sessionId: string, mode: string) {
      calls.push(`mode:${mode}`);
    }
    prompt(_sessionId: string, text: string) {
      calls.push(`prompt:${text}`);
      return text === "first" ? firstPrompt.promise : Promise.resolve({ stopReason: "end_turn" });
    }
    stop() {}
    async shutdown() {}
  }
  const client = new FakeClient();
  const state = {
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
    entries: () => [],
  };
  const actor = new TaskActor({
    taskId: "task-fixture",
    projectId: "project-fixture",
    projectPath: "/tmp",
    grokBin: "/usr/bin/false",
    grokHome: "/tmp",
    grokHomeId: "native",
    state: state as never,
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
    clientFactory: () => client as unknown as OfficialAcpClient,
  });
  await actor.createSession();
  const running = actor.submit("request-first", "first");
  await settleMicrotasks();
  const plan = actor.submit("request-plan", "plan work", [], "plan work", "plan");
  await settleMicrotasks();
  assert.deepEqual(calls, ["prompt:first"]);

  const completed = {
    method: "x.ai/session_notification",
    params: {
      sessionId: "session-fixture",
      update: { sessionUpdate: "turn_completed", stopReason: "end_turn" },
    },
  };
  client.emit("notification", completed);
  client.emit("notification", completed);
  assert.equal(actor.detail.events.filter((event) => event.method === "session/prompt:completed").length, 1);
  await running;
  await settleMicrotasks();
  assert.deepEqual(calls, ["prompt:first", "mode:plan", "prompt:plan work"]);

  firstPrompt.resolve({ stopReason: "end_turn" });
  await plan;

  assert.deepEqual(calls, ["prompt:first", "mode:plan", "prompt:plan work"]);
  assert.equal(actor.snapshot.workMode, "plan");
  actor.stop();
});

test("a queued next prompt waits for its pending Permission preflight", async () => {
  const firstPrompt = deferred<unknown>();
  const calls: string[] = [];
  class FakeClient extends EventEmitter {
    async start() { return { protocolVersion: 1 }; }
    async newSession() {
      return {
        sessionId: "session-fixture",
        configOptions: [],
        modes: { currentModeId: "normal" },
      };
    }
    async setYoloMode(sessionId: string, enabled: boolean) {
      calls.push(`permission:${enabled}`);
      return { sessionId, yolo: enabled };
    }
    prompt(_sessionId: string, text: string) {
      calls.push(`prompt:${text}`);
      return text === "first" ? firstPrompt.promise : Promise.resolve({ stopReason: "end_turn" });
    }
    stop() {}
    async shutdown() {}
  }
  const client = new FakeClient();
  const actor = new TaskActor({
    taskId: "task-fixture",
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
    clientFactory: () => client as unknown as OfficialAcpClient,
  });
  await actor.createSession();
  calls.length = 0;
  const running = actor.submit("request-first", "first");
  await settleMicrotasks();
  const permission = actor.executeCommand("request-permission", "always-approve", "on");
  const next = actor.enqueue("request-next", "next");
  await settleMicrotasks();
  assert.deepEqual(calls, ["prompt:first"]);

  firstPrompt.resolve({ stopReason: "end_turn" });
  await Promise.all([running, permission, next]);

  assert.deepEqual(calls, ["prompt:first", "permission:true", "prompt:next"]);
  assert.equal(actor.snapshot.permission.effective, "alwaysApprove");
  actor.stop();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
