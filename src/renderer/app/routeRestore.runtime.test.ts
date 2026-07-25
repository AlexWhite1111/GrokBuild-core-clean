import assert from "node:assert/strict";
import test from "node:test";
import type { TaskListItem } from "../../shared/contracts.js";
import { newTaskRoute } from "./routeRestore.js";

const task = (taskId: string, projectId: string, hasUserTurn: boolean): TaskListItem => ({
  taskId,
  projectId,
  sessionId: taskId,
  hasUserTurn,
  title: "New Task",
  status: "unloaded:idle",
  active: false,
  canStop: false,
  needsAttention: false,
  pinned: false,
  archived: false,
  agentState: "unloaded",
  naturalStatus: null,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
});

test("new task route reuses only an official empty Session in the active Project", () => {
  const empty = task("019f9a76-94a4-7403-89b0-cae47a88595d", "active", false);
  const used = task("019f9a6e-6e3d-7a02-9286-4982b5f939ef", "active", true);
  const other = task("019f9a65-fe68-79d2-ac2b-9a827939f405", "other", false);
  assert.equal(newTaskRoute([used, other, empty], "active"), `/tasks/${empty.taskId}`);
  assert.equal(newTaskRoute([used, other], "active"), "/new");
});
