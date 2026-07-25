import assert from "node:assert/strict";
import test from "node:test";
import type { TaskDetailProjection, TaskEventEnvelope } from "../../shared/contracts.js";
import { createTaskSnapshotFixture } from "../../shared/taskTestFixtures.js";
import { createTurnTimelineProjector } from "./turnPresentation.js";

test("pure text appends do not regroup the task timeline", () => {
  const initial = detailFixture();
  let builds = 0;
  const projector = createTurnTimelineProjector(() => { builds += 1; });

  let projected = projector(initial);
  const stableItems = projected.filter((item) => item.kind !== "assistant");
  const target = initial.messages.findLast((message) => message.role === "assistant")!;

  let detail = initial;
  for (let index = 0; index < 1_000; index += 1) {
    detail = {
      ...detail,
      snapshot: { ...detail.snapshot, revision: detail.snapshot.revision + 1 },
      messages: detail.messages.map((message) => message === target || message.blockId === target.blockId
        ? { ...message, text: `${message.text}x` }
        : message),
    };
    projected = projector(detail);
  }

  assert.equal(builds, 1);
  assert.equal(projected.filter((item) => item.kind !== "assistant").every((item, index) => item === stableItems[index]), true);
  const answer = projected.findLast((item) => item.kind === "assistant");
  assert.equal(answer?.kind === "assistant" && answer.turn.segments.some((segment) => segment.kind === "assistant" && segment.message.text.endsWith("x".repeat(1_000))), true);
});

test("unrelated scoped state updates do not steal the active prompt execution", () => {
  const detail = detailFixture();
  detail.events = [
    event(1, "task/user_message_delivery", "turn-1", { delivery: "accepted", localTurnId: "turn-1" }),
    event(3, "session/update:available_commands_update", "orphan-state-turn", { commands: [] }),
  ];

  const assistant = createTurnTimelineProjector()(detail).find((item) => item.kind === "assistant");

  assert.equal(assistant?.kind, "assistant");
  if (assistant?.kind !== "assistant") return;
  assert.equal(assistant.turn.promptExecutionId, "turn-1");
  assert.equal(assistant.turn.outcome, "running");
  assert.equal(assistant.turn.showStatus, true);
});

test("the active turn follows the shared task execution status", () => {
  const detail = detailFixture();
  const projector = createTurnTimelineProjector();
  const running = projector(detail).find((item) => item.kind === "assistant");
  detail.snapshot = { ...detail.snapshot, turn: "idle", revision: detail.snapshot.revision + 1 };
  const idle = projector(detail).find((item) => item.kind === "assistant");

  assert.equal(running?.kind === "assistant" && running.turn.outcome, "running");
  assert.equal(idle?.kind === "assistant" && idle.turn.outcome, "unknown");
});

test("consecutive Goal outcomes remain visible in the turn timeline", () => {
  const detail = detailFixture();
  detail.events = [
    event(3, "task/goal:structured", "turn-1", {
      goalId: "goal-1",
      status: "inactive",
      lastOutcome: "completed",
      objective: "First",
      timeUsedSeconds: 2,
    }),
    event(4, "task/goal:structured", "turn-1", {
      goalId: "goal-2",
      status: "inactive",
      lastOutcome: "completed",
      objective: "Second",
      timeUsedSeconds: 3,
    }),
  ];

  const outcomes = createTurnTimelineProjector()(detail)
    .filter((item) => item.kind === "goal");
  assert.deepEqual(outcomes.map((item) => item.presentation.objective), ["First", "Second"]);
});

test("a Goal outcome keeps its official event position without borrowing a message turn", () => {
  const detail = detailFixture();
  detail.messages.push(
    liveMessage("user-2", "user", "后来的一轮", "turn-2", 4, "2026-07-20T00:00:04.000Z"),
    liveMessage("answer-2", "assistant", "后来答案", "turn-2", 5, "2026-07-20T00:00:05.000Z"),
  );
  detail.events = [event(3, "task/goal:structured", "detached-goal-turn", {
    goalId: "goal-detached",
    status: "inactive",
    lastOutcome: "completed",
    objective: "Earlier Goal",
  })];

  const timeline = createTurnTimelineProjector()(detail);

  assert.deepEqual(timeline.map((item) => item.kind), [
    "user",
    "assistant",
    "goal",
    "user",
    "assistant",
  ]);
  const outcome = timeline.find((item) => item.kind === "goal");
  assert.equal(outcome?.kind === "goal" && outcome.event.turnId, "detached-goal-turn");
});

test("official history order stays before the explicitly identified live turn", () => {
  const historicalAt = "2026-07-24T11:00:54.000Z";
  const liveAt = "2026-07-24T11:30:42.000Z";
  const detail: TaskDetailProjection = {
    snapshot: {
      ...createTaskSnapshotFixture("project-fixture"),
      currentPromptExecutionId: "live-turn",
    },
    messages: [
      historyMessage("h-user-0", "user", "你好", "history-0", 5, historicalAt),
      historyMessage("h-answer-0", "assistant", "你好！", "history-0", 7, historicalAt),
      historyMessage("h-user-1", "user", "PDF", "history-1", 10, historicalAt),
      historyMessage("h-answer-1", "assistant", "PDF 完成", "history-1", 12, historicalAt),
      historyMessage("h-user-2", "user", "3", "history-2", 34, historicalAt),
      historyMessage("h-answer-2", "assistant", "第三项", "history-2", 36, historicalAt),
      liveMessage("live-user", "user", "2", "live-turn", 1, liveAt),
      liveMessage("live-answer", "assistant", "第二项", "live-turn", 2, liveAt),
    ],
    events: [],
    context: { currentTodo: null, activeWork: [], history: [] },
  };

  const timeline = createTurnTimelineProjector()(detail);
  assert.deepEqual(timeline.map(timelineText), [
    "user:你好",
    "assistant:你好！",
    "user:PDF",
    "assistant:PDF 完成",
    "user:3",
    "assistant:第三项",
    "user:2",
    "assistant:第二项",
  ]);

  const historical = timeline.find((item) => item.kind === "assistant" && item.turn.promptExecutionId === "history-0");
  const live = timeline.find((item) => item.kind === "assistant" && item.turn.promptExecutionId === "live-turn");
  assert.equal(historical?.kind === "assistant" && historical.turn.outcome, "unknown");
  assert.equal(live?.kind === "assistant" && live.turn.outcome, "running");
  assert.equal(live?.kind === "assistant" && live.turn.startedAt, liveAt);

  detail.snapshot = {
    ...detail.snapshot,
    turn: "idle",
    currentPromptExecutionId: null,
    revision: detail.snapshot.revision + 1,
  };
  detail.events = [event(3, "session/prompt:completed", "live-turn", { stopReason: "end_turn" })];
  detail.events[0].occurredAt = "2026-07-24T11:30:47.000Z";
  const completed = createTurnTimelineProjector()(detail)
    .find((item) => item.kind === "assistant" && item.turn.promptExecutionId === "live-turn");
  assert.equal(completed?.kind === "assistant" && completed.turn.outcome, "completed");
  assert.equal(completed?.kind === "assistant" && completed.turn.durationMs, 5_000);
});

function detailFixture(): TaskDetailProjection {
  const createdAt = "2026-07-20T00:00:00.000Z";
  return {
    snapshot: createTaskSnapshotFixture("project-fixture"),
    messages: [
      {
        blockId: "user-1",
        role: "user",
        text: "请审查性能",
        turnId: "turn-1",
        streaming: false,
        createdAt,
        firstEvent: { connectionEpoch: 1, sequence: 1 },
        lastEvent: { connectionEpoch: 1, sequence: 1 },
        protocol: { promptExecutionId: "turn-1", messageId: "user-1" },
      },
      {
        blockId: "answer-1",
        role: "assistant",
        text: "当前答案",
        turnId: "turn-1",
        streaming: true,
        createdAt,
        firstEvent: { connectionEpoch: 1, sequence: 2 },
        lastEvent: { connectionEpoch: 1, sequence: 2 },
        protocol: { promptExecutionId: "turn-1", messageId: "answer-1" },
      },
    ],
    events: [],
    context: { currentTodo: null, activeWork: [], history: [] },
  };
}

function historyMessage(
  blockId: string,
  role: "user" | "assistant",
  text: string,
  turnId: string,
  sourceOrdinal: number,
  createdAt: string,
): TaskDetailProjection["messages"][number] {
  return { blockId, role, text, turnId, sourceOrdinal, streaming: false, createdAt };
}

function liveMessage(
  blockId: string,
  role: "user" | "assistant",
  text: string,
  turnId: string,
  sequence: number,
  createdAt: string,
): TaskDetailProjection["messages"][number] {
  const firstEvent = { connectionEpoch: 1, sequence };
  return {
    blockId,
    role,
    text,
    turnId,
    streaming: role === "assistant",
    createdAt,
    firstEvent,
    lastEvent: firstEvent,
    protocol: { promptExecutionId: turnId, messageId: blockId },
  };
}

function timelineText(item: ReturnType<ReturnType<typeof createTurnTimelineProjector>>[number]): string {
  if (item.kind === "user") return `user:${item.message.text}`;
  if (item.kind === "lifecycle") return "lifecycle";
  if (item.kind === "goal") return `goal:${item.presentation.outcome}`;
  const text = item.turn.segments.flatMap((segment) =>
    segment.kind === "assistant" ? [segment.message.text] : []).join("|");
  return `assistant:${text}`;
}

function event(sequence: number, method: string, turnId: string, payload: Record<string, unknown>): TaskEventEnvelope {
  return {
    eventId: `event-${sequence}`,
    taskId: "task-fixture",
    turnId,
    connectionEpoch: 1,
    sequence,
    source: "acp",
    method,
    occurredAt: `2026-07-20T00:00:0${sequence}.000Z`,
    payload,
  };
}
