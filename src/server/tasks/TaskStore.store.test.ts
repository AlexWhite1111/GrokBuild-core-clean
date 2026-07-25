import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectStore } from "../projects/ProjectStore.js";
import { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { TaskRuntimeProjection } from "./TaskRuntimeProjection.js";
import { TaskStore } from "./TaskStore.js";

test("TaskStore reads only official Grok session files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-official-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const sessionId = "019f0000-0000-7000-8000-000000000001";
  const sessionPath = path.join(grokHome, "sessions", encodeURIComponent(projectPath), sessionId);
  fs.mkdirSync(projectPath);
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(path.join(sessionPath, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: projectPath },
    generated_title: "Official task",
    agent_name: "grok-build-plan",
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:01:00.000Z",
    current_model_id: "grok-4.5",
    sandbox_profile: "workspace",
    reasoning_effort: "high",
  }));
  fs.writeFileSync(path.join(sessionPath, "chat_history.jsonl"), [
    JSON.stringify({ type: "user", content: "<system-reminder>hidden</system-reminder>" }),
    JSON.stringify({ type: "user", prompt_index: 0, content: "<user_query>唯一官方来源</user_query>" }),
    JSON.stringify({ type: "assistant", content: "完成" }),
    JSON.stringify({ type: "assistant", content: "补充" }),
    JSON.stringify({ type: "user", prompt_index: 1, content: "<user_query>继续</user_query>" }),
    JSON.stringify({ type: "assistant", content: "继续完成" }),
  ].join("\n"));

  const state = new JsonStateStore(path.join(root, "app-state.json"));
  const projects = new ProjectStore(state);
  const project = projects.addProject(projectPath);
  const store = new TaskStore(grokHome, "native", projects, state);
  const detail = store.readDetail(sessionId);

  assert.equal(detail?.snapshot.projectId, project.projectId);
  assert.equal(detail?.snapshot.workMode, "normal");
  assert.deepEqual(detail?.messages.map(({ role, text }) => [role, text]), [
    ["user", "唯一官方来源"],
    ["assistant", "完成"],
    ["assistant", "补充"],
    ["user", "继续"],
    ["assistant", "继续完成"],
  ]);
  assert.deepEqual(detail?.messages.map((message) => message.sourceOrdinal), [1, 2, 3, 4, 5]);
  assert.equal(detail?.messages[0]?.createdAt, "2026-07-24T00:00:00.000Z");
  assert.equal(detail?.messages[4]?.createdAt, "2026-07-24T00:00:00.000Z");
  assert.equal(detail?.messages[0]?.turnId, detail?.messages[2]?.turnId);
  assert.notEqual(detail?.messages[2]?.turnId, detail?.messages[3]?.turnId);
  assert.equal(store.list("官方来源")[0]?.taskId, sessionId);
  assert.equal(store.list()[0]?.archived, false);
  store.setArchived(sessionId, true);
  assert.equal(store.list().length, 0);
  assert.equal(store.list("官方来源", "archived")[0]?.archived, true);
  assert.equal(store.readDetail(sessionId)?.messages[0]?.text, "唯一官方来源");
  store.setArchived(sessionId, false);
  assert.equal(store.list()[0]?.taskId, sessionId);
  store.setPinned(sessionId, true);
  assert.equal(store.list()[0]?.pinned, true);
  store.rename(sessionId, "Renamed official task");
  assert.equal(JSON.parse(fs.readFileSync(path.join(sessionPath, "summary.json"), "utf8")).generated_title, "Renamed official task");
});

test("TaskStore restores official work history through the runtime projection", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-official-updates-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const sessionId = "019f0000-0000-7000-8000-000000000002";
  const sessionPath = path.join(grokHome, "sessions", encodeURIComponent(projectPath), sessionId);
  const startedAt = Date.parse("2026-07-24T00:00:00.000Z");
  fs.mkdirSync(projectPath);
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(path.join(sessionPath, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: projectPath },
    generated_title: "Official process history",
    created_at: new Date(startedAt).toISOString(),
    updated_at: new Date(startedAt + 5_000).toISOString(),
  }));
  fs.writeFileSync(path.join(sessionPath, "chat_history.jsonl"), [
    JSON.stringify({ type: "user", prompt_index: 0, content: "<user_query>检查过程</user_query>" }),
    JSON.stringify({ type: "assistant", content: "完成" }),
  ].join("\n"));
  const updates = [
    officialUpdate(sessionId, startedAt, "user_message_chunk", {
      content: { type: "text", text: "检查过程" },
      _meta: { promptIndex: 0 },
    }),
    officialUpdate(sessionId, startedAt + 1_000, "agent_thought_chunk", {
      content: { type: "text", text: "先检查" },
    }, { promptId: "prompt-0", turnStartMs: startedAt, streamStartMs: startedAt + 900 }),
    officialUpdate(sessionId, startedAt + 2_000, "tool_call", {
      toolCallId: "tool-0",
      title: "读取文件",
      rawInput: { target_file: "test.ts" },
      _meta: { "x.ai/tool": { name: "read_file" } },
    }, { promptId: "prompt-0", turnStartMs: startedAt, streamStartMs: startedAt + 900 }),
    officialUpdate(sessionId, startedAt + 3_000, "tool_call_update", {
      toolCallId: "tool-0",
      title: "读取完成",
      status: "completed",
      _meta: { "x.ai/tool": { name: "read_file" } },
    }, { promptId: "prompt-0", turnStartMs: startedAt, streamStartMs: startedAt + 900 }),
    officialUpdate(sessionId, startedAt + 3_250, "current_mode_update", {
      currentModeId: "plan",
    }),
    officialUpdate(sessionId, startedAt + 3_500, "goal_updated", {
      goal_id: "goal-official",
      status: "active",
      objective: "只认官方 Goal 更新",
      elapsed_ms: 2_500,
    }, { promptId: "prompt-0", turnStartMs: startedAt, streamStartMs: startedAt + 900 }),
    officialUpdate(sessionId, startedAt + 4_000, "agent_message_chunk", {
      content: { type: "text", text: "完成" },
    }, { promptId: "prompt-0", turnStartMs: startedAt, streamStartMs: startedAt + 900 }),
    officialUpdate(sessionId, startedAt + 5_000, "turn_completed", {
      prompt_id: "prompt-0",
      stop_reason: "end_turn",
    }, {}, "_x.ai/session/update"),
  ];
  fs.writeFileSync(path.join(sessionPath, "updates.jsonl"), updates.join("\n"));

  const state = new JsonStateStore(path.join(root, "app-state.json"));
  const projects = new ProjectStore(state);
  projects.addProject(projectPath);
  const store = new TaskStore(grokHome, "native", projects, state);
  const detail = store.readDetail(sessionId);

  assert.deepEqual(detail?.messages.map(({ role, text }) => [role, text]), [
    ["user", "检查过程"],
    ["thought", "先检查"],
    ["assistant", "完成"],
  ]);
  assert.equal(new Set(detail?.messages.map((message) => message.turnId)).size, 1);
  assert.equal(detail?.messages[0]?.createdAt, new Date(startedAt).toISOString());
  assert.deepEqual(detail?.events.map((event) => event.method), [
    "session/update:tool_call",
    "session/update:tool_call_update",
    "session/update:current_mode_update",
    "session/update:goal_updated",
    "task/goal:structured",
    "session/prompt:completed",
  ]);
  assert.equal(detail?.events[5]?.occurredAt, new Date(startedAt + 5_000).toISOString());
  assert.equal(
    Date.parse(detail!.events[5].occurredAt) - Date.parse(detail!.messages[0].createdAt),
    5_000,
  );
  assert.equal(detail?.snapshot.workMode, "plan");
  assert.deepEqual(detail?.snapshot.goal, {
    status: "active",
    lastOutcome: null,
    objective: "只认官方 Goal 更新",
    timeUsedSeconds: 2.5,
    source: "native",
    updatedAt: detail?.snapshot.goal.updatedAt,
    telemetry: {
      goalId: "goal-official",
      phase: null,
      tokensUsed: 0,
      tokenBudget: null,
      tokenBaseline: 0,
      finishedSubagentTokens: 0,
      liveSubagentTokens: null,
      contextUsagePct: null,
      turnCount: null,
      toolCallCount: null,
      tokensByModel: [],
      totalDeliverables: 0,
      completedDeliverables: 0,
      workerRounds: 0,
      verifyRounds: 0,
      classifierRuns: 0,
      classifierMaxRuns: 0,
      verifyingCompletion: false,
      classifierVerdict: null,
      planning: false,
      lastEvent: null,
      lastEventDetail: null,
      lastEventAt: null,
    },
  });

  const runtime = new TaskRuntimeProjection(detail!.snapshot, state, { restored: detail! });
  runtime.beginSessionReplay();
  for (const line of updates) {
    runtime.applyNotification({ kind: "acp", params: JSON.parse(line).params, turnId: null });
  }
  runtime.endSessionReplay();
  assert.equal(runtime.detail().messages.length, detail?.messages.length);
  assert.equal(runtime.detail().events.length, detail?.events.length);
  assert.deepEqual(runtime.detail().context, detail?.context);
  assert.deepEqual(
    runtime.detail().events.map(({ method, occurredAt, payload }) => ({ method, occurredAt, payload })),
    detail?.events.map(({ method, occurredAt, payload }) => ({ method, occurredAt, payload })),
  );
  assert.equal(runtime.snapshot.goal.objective, "只认官方 Goal 更新");
  assert.equal(runtime.snapshot.goal.source, "native");
});

test("unloaded projection restores Todo, partial tools, and official child sessions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-official-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const parentId = "019f0000-0000-7000-8000-000000000010";
  const childId = "019f0000-0000-7000-8000-000000000011";
  const workspacePath = path.join(grokHome, "sessions", encodeURIComponent(projectPath));
  const parentPath = path.join(workspacePath, parentId);
  const childPath = path.join(workspacePath, childId);
  const startedAt = Date.parse("2026-07-25T00:00:00.000Z");
  fs.mkdirSync(projectPath);
  fs.mkdirSync(parentPath, { recursive: true });
  fs.mkdirSync(childPath, { recursive: true });
  fs.writeFileSync(path.join(parentPath, "summary.json"), JSON.stringify({
    info: { id: parentId, cwd: projectPath },
    generated_title: "Parent",
    created_at: new Date(startedAt).toISOString(),
  }));
  fs.writeFileSync(path.join(parentPath, "chat_history.jsonl"), "");
  fs.writeFileSync(path.join(parentPath, "updates.jsonl"), [
    officialUpdate(parentId, startedAt, "plan", {
      planId: "plan-1",
      entries: [{ id: "todo-1", content: "Persist me", status: "in_progress" }],
    }),
    officialUpdate(parentId, startedAt + 1_000, "tool_call", {
      toolCallId: "tool-1",
      title: "Research dependency",
      rawInput: { prompt: "Investigate" },
      _meta: { "x.ai/tool": { name: "spawn_subagent" } },
    }),
    officialUpdate(parentId, startedAt + 2_000, "tool_call_update", {
      toolCallId: "tool-1",
      status: "completed",
    }),
  ].join("\n"));
  fs.writeFileSync(path.join(childPath, "summary.json"), JSON.stringify({
    info: { id: childId, cwd: projectPath, session_kind: "subagent" },
    session_kind: "subagent",
    generated_title: "Child",
    created_at: new Date(startedAt).toISOString(),
  }));
  fs.writeFileSync(path.join(childPath, "chat_history.jsonl"), [
    JSON.stringify({ type: "user", prompt_index: 0, content: "<user_query>child prompt</user_query>" }),
    JSON.stringify({ type: "assistant", content: "child answer" }),
  ].join("\n"));

  const state = new JsonStateStore(path.join(root, "app-state.json"));
  const projects = new ProjectStore(state);
  projects.addProject(projectPath);
  const store = new TaskStore(grokHome, "native", projects, state);
  const parent = store.readDetail(parentId);
  const tools = parent?.events.filter((event) => event.method.includes("tool_call")) || [];

  assert.equal(parent?.context.currentTodo?.entries[0]?.content, "Persist me");
  assert.equal(tools.length, 2);
  assert.equal((tools[0]?.payload as Record<string, unknown>).toolName, "spawn_subagent");
  assert.equal((tools[0]?.payload as Record<string, unknown>).title, "Research dependency");
  assert.equal((tools[1]?.payload as Record<string, unknown>).toolName, undefined);
  assert.deepEqual(store.readChildDetail(parentId, childId)?.messages.map(({ role, text }) => [role, text]), [
    ["user", "child prompt"],
    ["assistant", "child answer"],
  ]);
  assert.equal(store.list().some((task) => task.taskId === childId), false);
});

test("official inline media keeps its cache reference and attachment after restart", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-official-media-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, "project");
  const grokHome = path.join(root, ".grok");
  const cachePath = path.join(root, "media-cache");
  const sessionId = "019f0000-0000-7000-8000-000000000020";
  const sessionPath = path.join(grokHome, "sessions", encodeURIComponent(projectPath), sessionId);
  const startedAt = Date.parse("2026-07-25T00:00:00.000Z");
  const bytes = Buffer.from("official-inline-media");
  const content = {
    type: "image",
    mimeType: "image/png",
    data: bytes.toString("base64"),
    uri: "inline.png",
  };
  fs.mkdirSync(projectPath);
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(path.join(sessionPath, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: projectPath },
    generated_title: "Inline media",
    created_at: new Date(startedAt).toISOString(),
  }));
  fs.writeFileSync(path.join(sessionPath, "updates.jsonl"), officialUpdate(
    sessionId,
    startedAt,
    "agent_message_chunk",
    { content },
  ));

  const liveMedia = new MediaArtifactStore({
    cacheDirectory: cachePath,
    maintenanceIntervalMs: false,
  });
  const attachment = liveMedia.registerAcpContent(sessionId, projectPath, content)[0];
  assert.ok(attachment);
  liveMedia.close();

  const state = new JsonStateStore(path.join(root, "state.json"));
  const projects = new ProjectStore(state);
  projects.addProject(projectPath);
  const store = new TaskStore(grokHome, "native", projects, state);
  const detail = store.readDetail(sessionId);
  assert.equal(detail?.messages[0]?.media?.[0]?.mediaId, attachment.mediaId);
  assert.equal(store.mediaReferencesByTask().get(sessionId)?.has(attachment.mediaId), true);

  const recoveredMedia = new MediaArtifactStore({
    cacheDirectory: cachePath,
    maintenanceIntervalMs: false,
  });
  const reconciled = recoveredMedia.reconcilePersisted(store.mediaReferencesByTask());
  assert.equal(reconciled.retainedArtifacts, 1);
  const payload = recoveredMedia.resolveLease(
    recoveredMedia.lease(sessionId, attachment.mediaId).ticket,
  );
  assert.ok(payload.canonicalPath);
  assert.deepEqual(fs.readFileSync(payload.canonicalPath), bytes);
  recoveredMedia.close();
});

function officialUpdate(
  sessionId: string,
  timestamp: number,
  sessionUpdate: string,
  update: Record<string, unknown>,
  meta: Record<string, unknown> = {},
  method = "session/update",
): string {
  return JSON.stringify({
    timestamp: Math.floor(timestamp / 1_000),
    method,
    params: {
      sessionId,
      update: { sessionUpdate, ...update },
      _meta: {
        eventId: `event-${timestamp}-${sessionUpdate}`,
        agentTimestampMs: timestamp,
        ...meta,
      },
    },
  });
}
