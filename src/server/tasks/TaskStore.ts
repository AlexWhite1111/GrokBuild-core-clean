import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ReasoningEffort,
  SandboxProfile,
  TaskDetailProjection,
  TaskEventEnvelope,
  TaskListItem,
  TaskMessageBlock,
  TaskOperationalContextSnapshot,
  TaskSnapshot,
} from "../../shared/contracts.js";
import { projectTaskOperationalContext } from "../../shared/contracts.js";
import type { ProjectStore } from "../projects/ProjectStore.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import { TaskCommandProjection } from "./TaskCommandProjection.js";
import { readMeta, safeSessionUpdate } from "./taskEventSanitizers.js";
import { applyGoalSessionUpdate } from "./taskGoalProjection.js";
import { storedInlineMediaForSessionUpdate } from "./taskMediaProjection.js";
import { TaskRuntimeTranscript } from "./TaskRuntimeTranscript.js";

export interface TaskRow {
  task_id: string;
  project_id: string;
  session_id: string;
  title: string;
  state: string;
  revision: number;
  config_json: string;
  grok_home_id: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  summary_path: string;
}

export interface TaskStoreScope {
  kind: "parent" | "child";
  id: string;
}

export interface TaskStoredTimelineItem {
  itemId: string;
  itemKind: string;
  scope: TaskStoreScope;
  ordinal: number;
  event: TaskEventEnvelope;
}

type TaskVisibility = "active" | "archived" | "all";

/** Official ~/.grok session files are the sole durable task and transcript authority. */
export class TaskStore {
  constructor(
    private readonly grokHome: string,
    private readonly grokHomeId: string,
    private readonly projects: ProjectStore,
    private readonly state: JsonStateStore,
  ) {}

  list(query = "", visibility: TaskVisibility = "active"): TaskListItem[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.rows().filter((row) =>
      visibility === "all" || this.isArchived(row.session_id) === (visibility === "archived"));
    if (!terms.length) return rows.map((row) => rowListItem(row, this.isArchived(row.session_id)));
    return rows.flatMap((row) => {
      const detail = this.#detail(row);
      if (!detail) return [];
      const haystack = `${row.title}\n${detail.messages.filter((message) => message.role === "user").map((message) => message.text).join("\n")}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term))
        ? [listItem(detail.snapshot, row.pinned === 1, this.isArchived(row.session_id))]
        : [];
    });
  }

  rows(): TaskRow[] {
    const sessionsRoot = path.join(this.grokHome, "sessions");
    const rows: TaskRow[] = [];
    for (const workspace of safeDirectories(sessionsRoot)) {
      for (const session of safeDirectories(path.join(sessionsRoot, workspace))) {
        const summaryPath = path.join(sessionsRoot, workspace, session, "summary.json");
        const summary = readObject(summaryPath, 1_048_576);
        const info = object(summary?.info);
        if (!summary || summary.session_kind === "subagent" || info?.session_kind === "subagent") continue;
        const sessionId = text(info?.id) === session ? session : session;
        const cwd = text(info?.cwd) || decodeWorkspace(workspace);
        const projectId = this.projects.projectIdForCanonicalPath(cwd);
        if (!projectId) continue;
        const createdAt = timestamp(summary.created_at, fileTime(summaryPath));
        const updatedAt = timestamp(summary.updated_at ?? summary.last_active_at, createdAt);
        const title = text(summary.generated_title) || text(summary.session_summary) || "Untitled Grok session";
        rows.push({
          task_id: sessionId,
          project_id: projectId,
          session_id: sessionId,
          title,
          state: "unloaded:idle",
          revision: 0,
          config_json: "{}",
          grok_home_id: this.grokHomeId,
          pinned: this.#pinned(sessionId) ? 1 : 0,
          created_at: new Date(createdAt).toISOString(),
          updated_at: new Date(Math.max(createdAt, updatedAt)).toISOString(),
          summary_path: summaryPath,
        });
      }
    }
    return rows.sort((left, right) => right.pinned - left.pinned || right.updated_at.localeCompare(left.updated_at));
  }

  row(taskId: string): TaskRow | undefined {
    return this.rows().find((row) => row.task_id === taskId || row.session_id === taskId);
  }

  readDetail(taskId: string): TaskDetailProjection | null {
    const row = this.row(taskId);
    return row ? this.#detail(row) : null;
  }

  #detail(row: TaskRow): TaskDetailProjection {
    const summary = readObject(row.summary_path, 1_048_576) || {};
    const snapshot = snapshotFrom(row, summary);
    const officialHistory = projectOfficialHistory(row, snapshot);
    if (officialHistory) return officialHistory;
    return {
      snapshot,
      messages: transcript(row),
      events: [],
      context: emptyContext(),
    };
  }

  readChildDetail(_taskId: string, sessionId: string): TaskDetailProjection | null {
    const parent = this.row(_taskId);
    if (!parent) return null;
    const summaryPath = path.join(path.dirname(path.dirname(parent.summary_path)), sessionId, "summary.json");
    const summary = readObject(summaryPath, 1_048_576);
    const info = object(summary?.info);
    if (!summary || (summary.session_kind !== "subagent" && info?.session_kind !== "subagent")) return null;
    if (text(info?.id) && text(info?.id) !== sessionId) return null;
    const createdAt = timestamp(summary.created_at, fileTime(summaryPath));
    const updatedAt = timestamp(summary.updated_at ?? summary.last_active_at, createdAt);
    return this.#detail({
      task_id: sessionId,
      project_id: parent.project_id,
      session_id: sessionId,
      title: text(summary.generated_title) || text(summary.session_summary) || "Subagent",
      state: "unloaded:idle",
      revision: 0,
      config_json: "{}",
      grok_home_id: parent.grok_home_id,
      pinned: 0,
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(Math.max(createdAt, updatedAt)).toISOString(),
      summary_path: summaryPath,
    });
  }

  setPinned(taskId: string, pinned: boolean): void {
    this.state.set(`task.pin.${taskId}`, pinned);
  }

  setArchived(taskId: string, archived: boolean): void {
    if (archived) this.state.set(`task.archive.${taskId}`, true);
    else this.state.delete(`task.archive.${taskId}`);
  }

  isArchived(taskId: string): boolean {
    return this.state.get<boolean>(`task.archive.${taskId}`) === true;
  }

  rename(taskId: string, title: string): void {
    const row = this.row(taskId);
    if (!row) throw new Error(`Cannot rename missing official session ${taskId}.`);
    const summary = readObject(row.summary_path, 1_048_576);
    if (!summary) throw new Error(`Cannot read official session ${taskId}.`);
    summary.generated_title = title;
    atomicJsonWrite(row.summary_path, summary);
  }

  deleteTask(taskId: string): void {
    this.state.delete(`task.pin.${taskId}`);
    this.state.delete(`task.archive.${taskId}`);
  }

  nextForkOrdinal(parentTaskId: string): number {
    const key = `task.forkOrdinal.${parentTaskId}`;
    return this.state.update<number>(key, (value) => Math.max(0, value || 0) + 1) || 1;
  }

  mediaReferencesByTask(): Map<string, ReadonlySet<string>> {
    return new Map(this.rows().map((row) => {
      const detail = this.readDetail(row.task_id);
      const mediaIds = new Set<string>();
      for (const message of detail?.messages || []) {
        for (const media of message.media || []) mediaIds.add(media.mediaId);
      }
      for (const event of detail?.events || []) {
        const payload = object(event.payload);
        if (!Array.isArray(payload?.media)) continue;
        for (const value of payload.media) {
          const mediaId = text(object(value)?.mediaId);
          if (mediaId) mediaIds.add(mediaId);
        }
      }
      return [row.task_id, mediaIds] as const;
    }));
  }

  #pinned(taskId: string): boolean {
    return this.state.get<boolean>(`task.pin.${taskId}`) === true;
  }

  rewindAndReset(taskId: string): TaskSnapshot {
    const detail = this.readDetail(taskId);
    if (!detail) throw new Error(`Cannot reload missing official session ${taskId}.`);
    return detail.snapshot;
  }
}

function snapshotFrom(row: TaskRow, summary: Record<string, unknown>): TaskSnapshot {
  const effort = reasoningEffort(summary.reasoning_effort);
  const sandbox = sandboxProfile(summary.sandbox_profile);
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    grokHomeId: row.grok_home_id,
    sessionId: row.session_id,
    title: row.title,
    connection: "unloaded",
    turn: "idle",
    currentPromptExecutionId: null,
    workMode: "normal",
    permission: { requested: "ask", effective: "ask", base: "ask", modes: [] },
    sandbox: {
      requested: sandbox,
      effective: sandbox,
      locked: true,
      mechanism: "none",
      verified: sandbox === "off",
      source: "task-create",
    },
    systemPrompt: null,
    plan: { document: null },
    goal: { status: "unknown", lastOutcome: null, objective: null, timeUsedSeconds: 0, source: "none", updatedAt: null, telemetry: null },
    contextWindow: null,
    gates: [],
    queue: { available: false, runningEntryId: null, entries: [] },
    activities: { batchId: null, running: 0, unconfirmed: 0, waiting: 0, failed: 0, completed: 0, newestActivityAt: null },
    modelId: text(summary.current_model_id) || null,
    effort,
    configOptions: [],
    commands: { available: [], execution: null },
    error: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectionEpoch: `stored:${row.session_id}:${row.updated_at}`,
    revision: 0,
  };
}

function projectOfficialHistory(
  row: TaskRow,
  snapshot: TaskSnapshot,
): TaskDetailProjection | null {
  const file = path.join(path.dirname(row.summary_path), "updates.jsonl");
  let source = "";
  try {
    if (fs.statSync(file).size > 64 * 1024 * 1024) return null;
    source = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const transcriptProjection = new TaskRuntimeTranscript(
    snapshot,
    new TaskCommandProjection(),
  );
  const events: TaskEventEnvelope[] = [];
  let eventSequence = 0;
  let updates = 0;
  for (const line of source.split(/\r?\n/)) {
    let record: Record<string, unknown> | null = null;
    try { record = object(JSON.parse(line)); } catch { /* skip damaged live tail */ }
    const rawParams = object(record?.params);
    const params = rawParams ? withOfficialTimestamp(rawParams, record?.timestamp) : null;
    const update = object(params?.update);
    const updateType = text(update?.sessionUpdate);
    if (!params || !update || !updateType) continue;
    if (updateType === "current_mode_update") {
      const mode = text(update.currentModeId) || text(update.modeId);
      if (mode === "normal" || mode === "plan") snapshot.workMode = mode;
    }
    const payload = safeSessionUpdate(update, readMeta(params));
    const structuredMedia = storedInlineMediaForSessionUpdate(row.task_id, updateType, update);
    if (structuredMedia.length) payload.media = structuredMedia;
    const previousGoal = updateType === "goal_updated" ? {
      status: snapshot.goal.status,
      lastOutcome: snapshot.goal.lastOutcome,
      objective: snapshot.goal.objective,
    } : null;
    const goalApplied = updateType === "goal_updated"
      ? applyGoalSessionUpdate(snapshot.goal, object(payload.goal) || {}, new Date(eventOccurredAt(payload, row.created_at)))
      : false;
    const turnId = transcriptProjection.turnForReplay(updateType, 1, payload);
    const event: TaskEventEnvelope = {
      eventId: `official:${row.session_id}:${eventSequence + 1}`,
      taskId: row.task_id,
      turnId,
      connectionEpoch: 1,
      sequence: ++eventSequence,
      source: "acp",
      method: updateType === "turn_completed"
        ? "session/prompt:completed"
        : updateType === "turn_failed"
          ? "session/prompt:failed"
          : `session/update:${updateType}`,
      occurredAt: eventOccurredAt(payload, row.created_at),
      payload,
    };
    if (updateType === "user_message_chunk") {
      transcriptProjection.appendRemoteUser(update, turnId, false, event);
    } else if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") {
      transcriptProjection.appendAgent(
        updateType === "agent_message_chunk" ? "assistant" : "thought",
        update,
        turnId,
        false,
        event,
        updateType === "agent_message_chunk" ? structuredMedia : [],
      );
    } else {
      if (updateType === "tool_call" || updateType === "tool_call_update") {
        transcriptProjection.closeSegment(turnId);
        if (structuredMedia.length) {
          transcriptProjection.appendAgent(
            "assistant",
            {
              ...update,
              messageId: `tool-media:${text(update.toolCallId) || event.sequence}`,
              content: {},
            },
            turnId,
            false,
            event,
            structuredMedia,
          );
        }
      }
      events.push(event);
      if (goalApplied && previousGoal && (
        previousGoal.status !== snapshot.goal.status
        || previousGoal.lastOutcome !== snapshot.goal.lastOutcome
        || previousGoal.objective !== snapshot.goal.objective
      )) {
        events.push({
          ...event,
          eventId: `official:${row.session_id}:${eventSequence + 1}`,
          sequence: ++eventSequence,
          method: "task/goal:structured",
          payload: {
            goalId: snapshot.goal.telemetry?.goalId || null,
            status: snapshot.goal.status,
            lastOutcome: snapshot.goal.lastOutcome,
            objective: snapshot.goal.objective,
            timeUsedSeconds: snapshot.goal.timeUsedSeconds,
          },
        });
      }
      if (updateType === "turn_completed" || updateType === "turn_failed") {
        transcriptProjection.closeTurn(turnId);
      }
    }
    updates += 1;
  }
  if (!updates) return null;
  return {
    snapshot,
    messages: transcriptProjection.messages,
    events,
    context: projectTaskOperationalContext(events),
  };
}

function withOfficialTimestamp(
  params: Record<string, unknown>,
  timestampValue: unknown,
): Record<string, unknown> {
  const meta = object(params._meta) || {};
  if (Number.isSafeInteger(meta.agentTimestampMs)) return params;
  const timestamp = typeof timestampValue === "number" && Number.isFinite(timestampValue)
    ? timestampValue < 10_000_000_000 ? Math.round(timestampValue * 1_000) : Math.round(timestampValue)
    : null;
  return timestamp == null
    ? params
    : { ...params, _meta: { ...meta, agentTimestampMs: timestamp } };
}

function eventOccurredAt(payload: Record<string, unknown>, fallback: string): string {
  const timestamp = payload.agentTimestampMs;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) return fallback;
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

function transcript(row: TaskRow): TaskMessageBlock[] {
  const file = path.join(path.dirname(row.summary_path), "chat_history.jsonl");
  let source = "";
  try {
    if (fs.statSync(file).size > 32 * 1024 * 1024) return [];
    source = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const result: TaskMessageBlock[] = [];
  let activePromptExecutionId = `official:${row.session_id}:prompt:initial`;
  let fallbackPromptIndex = 0;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    let record: Record<string, unknown> | null = null;
    try { record = object(JSON.parse(line)); } catch { /* skip damaged live tail */ }
    if (!record) continue;
    const role = record.type === "assistant" ? "assistant" : record.type === "user" && record.synthetic_reason === undefined ? "user" : null;
    const content = role === "user" ? userText(record.content) : role === "assistant" ? contentText(record.content) : "";
    if (!role || !content) continue;
    if (role === "user") {
      const promptIndex = nonnegativeInteger(record.prompt_index) ?? fallbackPromptIndex;
      fallbackPromptIndex = Math.max(fallbackPromptIndex + 1, promptIndex + 1);
      activePromptExecutionId = `official:${row.session_id}:prompt:${promptIndex}`;
    }
    result.push({
      blockId: `official:${row.session_id}:${index}`,
      role,
      text: content,
      turnId: activePromptExecutionId,
      streaming: false,
      createdAt: row.created_at,
      sourceOrdinal: index,
    });
  }
  return result;
}

function userText(content: unknown): string {
  const source = contentText(content);
  const matches = [...source.matchAll(/<user_query\s*>([\s\S]*?)<\/user_query\s*>/gi)]
    .map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
  if (matches.length) return matches.join("\n\n");
  const value = source.trim();
  return /^<(?:user_info|system-reminder)\b/i.test(value) ? "" : value;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const value = object(part);
    return value && (value.type === undefined || value.type === "text") && typeof value.text === "string" ? [value.text] : [];
  }).join("\n").trim();
}

function listItem(snapshot: TaskSnapshot, pinned: boolean, archived: boolean): TaskListItem {
  return {
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    status: "unloaded:idle",
    active: false,
    canStop: false,
    needsAttention: false,
    pinned,
    archived,
    agentState: "unloaded",
    naturalStatus: null,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function rowListItem(row: TaskRow, archived: boolean): TaskListItem {
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    title: row.title,
    status: row.state,
    active: false,
    canStop: false,
    needsAttention: false,
    pinned: row.pinned === 1,
    archived,
    agentState: "unloaded",
    naturalStatus: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emptyContext(): TaskOperationalContextSnapshot {
  return { currentTodo: null, activeWork: [], history: [] };
}

function safeDirectories(directory: string): string[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readObject(file: string, maxBytes: number): Record<string, unknown> | null {
  try {
    if (fs.statSync(file).size > maxBytes) return null;
    return object(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function fileTime(file: string): number {
  try { return fs.statSync(file).birthtimeMs; } catch { return Date.now(); }
}

function decodeWorkspace(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function reasoningEffort(value: unknown): ReasoningEffort | null {
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(text(value))
    ? text(value) as ReasoningEffort
    : null;
}

function sandboxProfile(value: unknown): SandboxProfile {
  const normalized = text(value) === "read-only" ? "readOnly" : text(value);
  return ["off", "workspace", "readOnly", "strict", "custom"].includes(normalized)
    ? normalized as SandboxProfile
    : "workspace";
}

function atomicJsonWrite(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
