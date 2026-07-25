import assert from "node:assert/strict";
import test from "node:test";
import type { TaskCreate, TaskSnapshot } from "../../shared/contracts.js";
import { TaskActivationCoordinator } from "./TaskActivationCoordinator.js";
import type { TaskActor } from "./TaskActor.js";
import type { TaskStore } from "./TaskStore.js";
import type { RuntimePermissionCapabilities, TaskActorOptions } from "./taskTypes.js";

test("creating a task publishes the official session without dispatching a prompt", async () => {
  const actors = new Map<string, TaskActor>();
  let publishes = 0;
  let submits = 0;
  const snapshot = {
    taskId: "provisional",
    sessionId: null,
    connection: "connecting",
  } as unknown as TaskSnapshot;
  const actor = {
    get snapshot() { return snapshot; },
    async createSession() {
      snapshot.taskId = "019f935f-88da-79f3-9813-54855bde7d07";
      snapshot.sessionId = snapshot.taskId;
      snapshot.connection = "ready";
      return snapshot;
    },
    async submit() {
      submits += 1;
      return snapshot;
    },
    stop() {},
  } as unknown as TaskActor;
  const coordinator = coordinatorFor(actors, actor, () => { publishes += 1; });

  const result = await coordinator.create(newTask());

  assert.equal(result.taskId, "019f935f-88da-79f3-9813-54855bde7d07");
  assert.equal(result.sessionId, result.taskId);
  assert.equal(actors.get(result.taskId), actor);
  assert.equal(actors.has("provisional"), false);
  assert.equal(publishes, 1);
  assert.equal(submits, 0);
});

test("shared activation still deduplicates concurrent resume calls", async () => {
  const actors = new Map<string, TaskActor>();
  const ready = deferred<void>();
  let resumes = 0;
  const snapshot = {
    taskId: "019f935f-88da-79f3-9813-54855bde7d07",
    sessionId: "019f935f-88da-79f3-9813-54855bde7d07",
    connection: "unloaded",
  } as unknown as TaskSnapshot;
  const actor = {
    get snapshot() { return snapshot; },
    async resume() {
      resumes += 1;
      await ready.promise;
      snapshot.connection = "ready";
      return snapshot;
    },
    stop() {},
  } as unknown as TaskActor;
  actors.set(snapshot.taskId, actor);
  const coordinator = coordinatorFor(actors, actor);

  const first = coordinator.activate(snapshot.taskId);
  const second = coordinator.activate(snapshot.taskId);
  assert.equal(first, second);
  ready.resolve();
  assert.equal(await first, actor);
  assert.equal(await second, actor);
  assert.equal(resumes, 1);
});

function coordinatorFor(
  actors: Map<string, TaskActor>,
  actor: TaskActor,
  publishCreatedTask: () => void = () => undefined,
) {
  return new TaskActivationCoordinator({
    actors,
    store: {} as TaskStore,
    actorFactory: (options: TaskActorOptions) => {
      (actor.snapshot as TaskSnapshot).taskId = options.taskId;
      return actor;
    },
    permissionCapabilities: availablePermissions,
    ensureTaskCreationAllowed: async () => undefined,
    ensureCapacity: () => undefined,
    taskRow: () => { throw new Error("not used"); },
    actorRuntime: () => ({}) as ReturnType<TaskActivationCoordinatorTestRuntime>,
    attach: (value) => actors.set(value.snapshot.taskId, value),
    publishCreatedTask,
  });
}

type TaskActivationCoordinatorTestRuntime = () => Omit<
  TaskActorOptions,
  "taskId" | "projectId" | "workMode" | "permission" | "sandbox"
>;

function newTask(): TaskCreate {
  return {
    requestId: "3ed72d17-2fb4-4203-a161-8c4059a11f8b",
    projectId: "project-fixture",
    workMode: "normal",
    permission: "ask",
    sandbox: "workspace",
    systemPrompt: null,
  };
}

function availablePermissions(): RuntimePermissionCapabilities {
  return {
    auto: { available: true },
    alwaysApprove: { available: true },
    acceptEdits: { available: true },
    dontAsk: { available: true },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
