import assert from "node:assert/strict";
import test from "node:test";
import type {
  TaskDetailProjection,
  TaskMessageBlock,
  TaskSnapshot,
} from "../../shared/contracts.js";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import type { TaskActor } from "./TaskActor.js";
import type { TaskActivationCoordinator } from "./TaskActivationCoordinator.js";
import { TaskHistoryCoordinator } from "./TaskHistoryCoordinator.js";
import type { TaskRow, TaskStore } from "./TaskStore.js";

test("changing an empty task replaces its setup session without a visible Fork", async () => {
  const source = actor("source-session", []);
  const child = actor("child-session", []);
  const calls = harness(source, child, 1);
  const coordinator = new TaskHistoryCoordinator(calls.options);

  const result = await coordinator.fork("source-session", {
    requestId: "request-empty",
    systemPrompt: {
      presetId: "sol",
      title: "Sol",
      rules: "",
      systemPrompt: "You are Sol.",
    },
  });

  assert.equal(result.taskId, "child-session");
  assert.equal(calls.branchContinuation, "");
  assert.equal(child.snapshot.title, "New Task");
  assert.deepEqual(calls.archived, [["source-session", true]]);
  assert.deepEqual(calls.pinned, [
    ["source-session", false],
    ["child-session", true],
  ]);
  assert.equal(calls.forkOrdinals, 0);
  assert.equal(source.stopped, true);
  assert.deepEqual(calls.published.map(([event]) => event), [
    "task.retired",
    "task.created",
    "workspace.changed",
  ]);
});

test("changing a committed task keeps the source and creates a normal Fork", async () => {
  const source = actor("source-session", [
    message("user", "请继续"),
    message("assistant", "好的"),
  ]);
  const child = actor("child-session", []);
  const calls = harness(source, child, 0);
  const coordinator = new TaskHistoryCoordinator(calls.options);

  await coordinator.fork("source-session", {
    requestId: "request-committed",
    sandbox: "strict",
  });

  assert.match(calls.branchContinuation, /USER:\n请继续/);
  assert.match(calls.branchContinuation, /ASSISTANT:\n好的/);
  assert.equal(child.snapshot.title, "New Task · Fork 1");
  assert.deepEqual(calls.archived, []);
  assert.equal(calls.forkOrdinals, 1);
  assert.equal(source.stopped, false);
});

function harness(
  source: FakeActor,
  child: FakeActor,
  sourcePinned: 0 | 1,
) {
  const archived: Array<[string, boolean]> = [];
  const pinned: Array<[string, boolean]> = [];
  const published: Array<[string, unknown]> = [];
  let branchContinuation = "";
  let forkOrdinals = 0;
  const actors = new Map<string, TaskActor>([
    [source.snapshot.taskId, source as unknown as TaskActor],
  ]);
  const store = {
    setArchived(taskId: string, value: boolean) { archived.push([taskId, value]); },
    setPinned(taskId: string, value: boolean) { pinned.push([taskId, value]); },
    rename() {},
    nextForkOrdinal() { forkOrdinals += 1; return forkOrdinals; },
  } as unknown as TaskStore;
  const activation = {
    async intentActor() { return source as unknown as TaskActor; },
    async createSessionBranch(_taskId: string, _input: unknown, continuation: string) {
      branchContinuation = continuation;
      return child as unknown as TaskActor;
    },
    async activate() { return child as unknown as TaskActor; },
    forgetTask() {},
  } as unknown as TaskActivationCoordinator;
  const row: TaskRow = {
    task_id: source.snapshot.taskId,
    project_id: source.snapshot.projectId,
    session_id: source.snapshot.taskId,
    title: "New Task",
    state: "ready:idle",
    revision: 0,
    config_json: "{}",
    grok_home_id: "native",
    pinned: sourcePinned,
    created_at: source.snapshot.createdAt,
    updated_at: source.snapshot.updatedAt,
    summary_path: "",
    has_user_turn: source.hasUserMessages,
  };
  return {
    archived,
    pinned,
    published,
    get branchContinuation() { return branchContinuation; },
    get forkOrdinals() { return forkOrdinals; },
    options: {
      store,
      actors,
      activation,
      taskRow: () => row,
      workspace: () => ({ projects: [], tasks: [] }) as never,
      publish: (
        event: "task.retired" | "task.created" | "workspace.changed",
        payload: unknown,
      ) => { published.push([event, payload]); },
    },
  };
}

interface FakeActor {
  snapshot: TaskSnapshot;
  detail: TaskDetailProjection;
  hasUserMessages: boolean;
  stopped: boolean;
  assertForkReady(): void;
  stop(): void;
  rename(title: string): TaskSnapshot;
  forkNativeSession(): Promise<{ newSessionId: string }>;
}

function actor(taskId: string, messages: TaskMessageBlock[]): FakeActor {
  const snapshot = createTaskSnapshotFixture("project-fixture");
  snapshot.taskId = taskId;
  snapshot.sessionId = taskId;
  snapshot.title = "New Task";
  snapshot.turn = "idle";
  snapshot.currentPromptExecutionId = null;
  const value: FakeActor = {
    snapshot,
    detail: {
      snapshot,
      messages,
      events: [],
      context: { currentTodo: null, activeWork: [], history: [] },
    },
    hasUserMessages: messages.some((item) => item.role === "user"),
    stopped: false,
    assertForkReady() {},
    stop() { value.stopped = true; },
    rename(title: string) {
      snapshot.title = title;
      value.detail.snapshot.title = title;
      return snapshot;
    },
    async forkNativeSession() { return { newSessionId: "native-child" }; },
  };
  return value;
}

function message(
  role: TaskMessageBlock["role"],
  text: string,
): TaskMessageBlock {
  return {
    blockId: `${role}:${text}`,
    role,
    text,
    turnId: "turn-1",
    streaming: false,
    createdAt: "2026-07-26T00:00:00.000Z",
  };
}
