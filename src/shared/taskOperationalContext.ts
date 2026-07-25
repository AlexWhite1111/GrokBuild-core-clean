import type {
  ContextHistoryItem,
  TaskEventEnvelope,
  TaskOperationalContextSnapshot,
  TodoEntrySnapshot,
  TodoGroupEndReason,
  TodoGroupSnapshot,
  WorkItemKind,
  WorkItemSnapshot,
  WorkItemStatus,
} from "./contracts/task.js";

const TERMINAL_WORK = new Set<WorkItemStatus>(["completed", "failed", "cancelled"]);

/** Projects only structured ACP/XAI/supervisor evidence; message text is never inspected. */
export function projectTaskOperationalContext(events: TaskEventEnvelope[]): TaskOperationalContextSnapshot {
  const ordered = [...events].sort(compareEvent);
  const todos = projectTodoGroups(ordered);
  const work = splitWorkState(projectWorkItems(ordered));
  const history: ContextHistoryItem[] = [
    ...todos.archived.map((todo) => ({ id: `history:todo:${todo.groupId}`, turnId: todoTurnId(ordered, todo), kind: "todo" as const, occurredAt: todo.updatedAt, status: todo.endReason, todo })),
    ...work.terminal.map((item) => ({ id: `history:work:${item.id}`, turnId: workTurnId(ordered, item), kind: "work" as const, occurredAt: item.updatedAt, status: item.status, work: item })),
    ...projectLifecycleHistory(ordered),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return {
    currentTodo: todos.current,
    activeWork: work.active,
    history,
  };
}

export interface ProjectedTaskWorkState {
  active: WorkItemSnapshot[];
  unconfirmed: WorkItemSnapshot[];
  terminal: WorkItemSnapshot[];
}

/**
 * Canonical structured work projection shared by the live activity summary and
 * the renderer context. Unconfirmed work remains available for neutral status
 * reporting, but is excluded from active work and terminal history.
 */
export function projectTaskWorkState(events: TaskEventEnvelope[]): ProjectedTaskWorkState {
  const ordered = [...events].sort(compareEvent);
  return splitWorkState(projectWorkItems(ordered));
}

function splitWorkState(work: WorkItemSnapshot[]): ProjectedTaskWorkState {
  return {
    active: work.filter((item) => item.status !== "unconfirmed" && !TERMINAL_WORK.has(item.status)),
    unconfirmed: work.filter((item) => item.status === "unconfirmed"),
    terminal: work.filter((item) => TERMINAL_WORK.has(item.status)),
  };
}

function projectTodoGroups(events: TaskEventEnvelope[]): { current: TodoGroupSnapshot | null; archived: TodoGroupSnapshot[] } {
  const groups = new Map<string, TodoGroupSnapshot>();
  let currentId: string | null = null;
  for (const event of events) {
    if (event.method === "session/prompt:failed" || event.method === "task/connection:interrupted") {
      archiveCurrent(groups, currentId, event.method === "session/prompt:failed" ? "failed" : "interrupted", event.occurredAt);
      currentId = null;
      continue;
    }
    if (event.method === "session/prompt:completed" && currentId) {
      const stopReason = text(record(event.payload).stopReason)?.toLowerCase();
      archiveCurrent(groups, currentId, stopReason === "cancelled" || stopReason === "canceled" ? "cancelled" : "interrupted", event.occurredAt);
      currentId = null;
      continue;
    }
    if (event.method === "session/update:plan_removed") {
      archiveCurrent(groups, currentId, "interrupted", event.occurredAt);
      currentId = null;
      continue;
    }
    if (event.method !== "session/update:plan" && event.method !== "session/update:plan_update") continue;
    const payload = record(event.payload);
    if (!Array.isArray(payload.entries)) continue;
    const planId = text(payload.planId);
    const groupId = planId ? `plan:${planId}` : `epoch:${event.connectionEpoch}:${event.turnId || "detached"}`;
    if (currentId && currentId !== groupId) archiveCurrent(groups, currentId, "superseded", event.occurredAt);
    const previous = groups.get(groupId);
    const entries = payload.entries.flatMap((raw, index): TodoEntrySnapshot[] => {
      const entry = record(raw);
      const content = text(entry.content);
      if (!content) return [];
      return [{ id: text(entry.id) || text(entry.todoId) || `${groupId}:${index}`, content, status: todoStatus(text(entry.status)) }];
    });
    if (!entries.length) {
      if (previous) groups.set(groupId, { ...previous, entries: [], state: "archived", endReason: "completed", updatedAt: event.occurredAt });
      currentId = null;
      continue;
    }
    const endReason = todoEndReason(entries);
    const next: TodoGroupSnapshot = {
      groupId,
      planId,
      entries,
      state: endReason ? "archived" : "active",
      endReason,
      createdAt: previous?.createdAt || event.occurredAt,
      updatedAt: event.occurredAt,
    };
    groups.set(groupId, next);
    currentId = endReason ? null : groupId;
  }
  const current = currentId ? groups.get(currentId) || null : null;
  return { current, archived: [...groups.values()].filter((group) => group.state === "archived") };
}

function archiveCurrent(groups: Map<string, TodoGroupSnapshot>, id: string | null, reason: Exclude<TodoGroupEndReason, "completed" | null>, at: string): void {
  if (!id) return;
  const current = groups.get(id);
  if (!current || current.state === "archived") return;
  groups.set(id, { ...current, state: "archived", endReason: reason, updatedAt: at });
}

function todoEndReason(entries: TodoEntrySnapshot[]): TodoGroupEndReason {
  if (!entries.length) return null;
  if (entries.some((entry) => entry.status === "failed")) return "failed";
  if (entries.some((entry) => entry.status === "cancelled")) return "cancelled";
  return entries.every((entry) => entry.status === "completed") ? "completed" : null;
}

function projectWorkItems(events: TaskEventEnvelope[]): WorkItemSnapshot[] {
  const items = new Map<string, WorkItemSnapshot>();
  const toolToActivity = new Map<string, string>();
  const toolNames = new Map<string, string>();
  const toolTargets = new Map<string, string[]>();
  for (const event of events) {
    const payload = record(event.payload);
    if (applyStructuredWorkLifecycle(items, toolToActivity, event, payload)) continue;
    if (event.method.startsWith("child/session/update:")) {
      const childId = text(payload.sessionId);
      if (!childId) continue;
      const current = findCurrentAgent(items, childId);
      if (!current) continue;
      const title = compact(text(payload.title)) || compact(text(payload.message));
      items.set(current.id, {
        ...current,
        currentActivity: title || current.currentActivity,
        updatedAt: event.occurredAt,
      });
      continue;
    }
    if (event.method !== "session/update:tool_call" && event.method !== "session/update:tool_call_update") continue;
    const toolCallId = text(payload.toolCallId);
    const advertisedName = text(payload.toolName)?.toLowerCase() || null;
    if (toolCallId && advertisedName) toolNames.set(toolCallId, advertisedName);
    const toolName = advertisedName || (toolCallId ? toolNames.get(toolCallId) || null : null);
    if (toolName === "spawn_subagent") continue;
    const advertisedTargets = stringList(payload.activityIds);
    if (toolCallId && advertisedTargets.length) toolTargets.set(toolCallId, advertisedTargets);
    const activityIds = advertisedTargets.length ? advertisedTargets : toolCallId ? toolTargets.get(toolCallId) || [] : [];
    if (isControlTool(toolName)) {
      const results = Array.isArray(payload.activityResults) ? payload.activityResults.map(record) : [];
      for (const result of results) {
        const activityId = text(result.activityId);
        if (activityId && findCurrentAgent(items, activityId)) continue;
        updateWork(items, activityId, workStatus(text(result.status)), text(result.outputTail), event.occurredAt);
      }
      if (!results.length && (toolName === "kill_command_or_subagent" || toolName === "scheduler_delete") && text(payload.status)?.toLowerCase() === "completed") {
        activityIds.filter((id) => !findCurrentAgent(items, id))
          .forEach((id) => updateWork(items, id, "cancelled", text(payload.outputTail), event.occurredAt));
      }
      continue;
    }
    if (!toolCallId) continue;
    const kind = workKind(payload, toolName);
    if (kind === "agent") continue;
    const previousId = toolToActivity.get(toolCallId) || toolCallId;
    const activityId = activityIds[0] || toolToActivity.get(toolCallId) || null;
    const id = activityId || toolCallId;
    const current = items.get(id) || findCurrentWork(items, previousId) || items.get(previousId);
    if (!kind && !current) continue;
    if (activityId) toolToActivity.set(toolCallId, activityId);
    if (previousId !== id) items.delete(previousId);
    const resolvedKind = kind || current!.kind;
    let status = TERMINAL_WORK.has(current?.status || "pending")
      ? current!.status
      : workStatus(text(payload.status), current?.status, event.method === "session/update:tool_call" ? "pending" : "running");
    if (!TERMINAL_WORK.has(current?.status || "pending") && status === "completed") status = "running";
    const candidateTitle = compact(text(payload.title));
    items.set(id, {
      id,
      kind: resolvedKind,
      activityId,
      childSessionId: null,
      title: candidateTitle || current?.title || null,
      status,
      currentActivity: text(payload.message) || candidateTitle || current?.currentActivity || null,
      outputTail: text(payload.outputTail) || current?.outputTail || null,
      telemetry: current?.telemetry || null,
      startedAt: current?.startedAt || event.occurredAt,
      updatedAt: event.occurredAt,
    });
  }
  const latestLoad = [...events].sort(compareEvent).reverse().find((event) => event.method === "session/load");
  return [...items.values()].map((item) => {
    if (!latestLoad || TERMINAL_WORK.has(item.status)) return item;
    const confirmedAfterLoad = events.some((event) => compareEvent(event, latestLoad) > 0 && confirmsWorkItem(event, item));
    return confirmedAfterLoad ? item : { ...item, status: "unconfirmed" as const, currentActivity: null };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function confirmsWorkItem(event: TaskEventEnvelope, item: WorkItemSnapshot): boolean {
  const payload = record(event.payload);
  const runtimeIds = new Set([
    item.activityId,
    item.childSessionId,
    ...(item.kind === "agent" ? [] : [item.id]),
  ].filter((id): id is string => Boolean(id)));
  const toolName = text(payload.toolName)?.toLowerCase() || null;
  const controlTool = isControlTool(toolName);
  if (item.kind === "agent") {
    return (
      runtimeIds.has(text(payload.subagentId) || "")
      || runtimeIds.has(text(payload.childSessionId) || "")
    ) && isNativeWorkEvidence(event.method, payload);
  }
  const resultConfirms = Array.isArray(payload.activityResults) && payload.activityResults.some((value) => {
    const id = text(record(value).activityId);
    const status = text(record(value).status);
    return Boolean(id && status && runtimeIds.has(id));
  });
  // A control request merely names its target. Only a structured result for
  // that target is evidence; a failed `task not found` response is not liveness.
  if (controlTool) return resultConfirms;
  if (resultConfirms) return true;
  if (runtimeIds.has(text(payload.taskId) || "")) return isNativeWorkEvidence(event.method, payload);
  if (runtimeIds.has(text(payload.subagentId) || "") || runtimeIds.has(text(payload.childSessionId) || "")) return isNativeWorkEvidence(event.method, payload);
  if (runtimeIds.has(text(payload.sessionId) || "") && (event.method.startsWith("child/") || event.method.startsWith("x.ai/"))) return true;
  if (!event.method.startsWith("session/update:tool_call")) return false;
  const toolStatus = workStatus(text(payload.status));
  if (toolStatus === "failed" || toolStatus === "cancelled") return false;
  return stringList(payload.activityIds).some((id) => runtimeIds.has(id));
}

function isNativeWorkEvidence(method: string, payload: Record<string, unknown>): boolean {
  if (method === "x.ai/session_notification") {
    return ["subagent_spawned", "subagent_progress", "subagent_finished"].includes(text(payload.type) || "");
  }
  return method === "session/update:task_backgrounded"
    || method === "session/update:task_completed"
    || method === "session/update:monitor_event"
    || method === "session/update:scheduled_task_created"
    || method === "session/update:scheduled_task_fired"
    || method === "session/update:scheduled_task_deleted"
    || method === "session/update:subagent_spawned"
    || method === "session/update:subagent_progress"
    || method === "session/update:subagent_finished";
}

function applyStructuredWorkLifecycle(
  items: Map<string, WorkItemSnapshot>,
  toolToActivity: Map<string, string>,
  event: TaskEventEnvelope,
  payload: Record<string, unknown>,
): boolean {
  const kind = event.method === "x.ai/session_notification"
    ? text(payload.type)
    : event.method.startsWith("session/update:")
      ? event.method.slice("session/update:".length)
      : event.method;
  if (kind === "task/work:stop_requested") {
    const current = findWork(items, text(payload.workItemId) || "");
    if (current && !TERMINAL_WORK.has(current.status)) items.set(current.id, { ...current, currentActivity: "Stopping", updatedAt: event.occurredAt });
    return true;
  }
  if (kind === "task_backgrounded") {
    const taskId = text(payload.taskId);
    if (!taskId) return true;
    const toolCallId = text(payload.toolCallId);
    const current = findWork(items, taskId) || (toolCallId ? findWork(items, toolCallId) : undefined);
    const itemKind = workKind(payload, null) || current?.kind || "task";
    upsertStructuredWork(items, current, event, taskId, itemKind, {
      title: compact(text(payload.title)) || current?.title || null,
      status: "running",
      currentActivity: compact(text(payload.title)) || current?.currentActivity || null,
    });
    if (toolCallId) toolToActivity.set(toolCallId, taskId);
    return true;
  }
  if (kind === "task_completed" || kind === "monitor_event") {
    const taskId = text(payload.taskId);
    if (!taskId) return true;
    const current = findWork(items, taskId);
    const itemKind = workKind(payload, null) || current?.kind || (kind === "monitor_event" ? "monitor" : "task");
    upsertStructuredWork(items, current, event, taskId, itemKind, {
      title: current?.title || compact(text(payload.title)) || null,
      status: kind === "task_completed" ? workStatus(text(payload.status), current?.status, "completed") : workStatus(text(payload.status), current?.status, "running"),
      currentActivity: compact(text(payload.message)) || current?.currentActivity || null,
    });
    return true;
  }
  if (kind === "scheduled_task_created" || kind === "scheduled_task_fired" || kind === "scheduled_task_deleted") {
    const taskId = text(payload.taskId);
    if (!taskId) return true;
    const current = findWork(items, taskId);
    upsertStructuredWork(items, current, event, taskId, "loop", {
      title: current?.title || compact(text(payload.title)) || "Loop",
      status: kind === "scheduled_task_deleted" ? "cancelled" : "running",
      currentActivity: compact(text(payload.message)) || current?.currentActivity || null,
    });
    return true;
  }
  if (kind === "subagent_spawned" || kind === "subagent_progress" || kind === "subagent_finished") {
    const subagentId = text(payload.subagentId);
    const childSessionId = text(payload.childSessionId) || subagentId;
    if (!subagentId && !childSessionId) return true;
    const nativeId = childSessionId || subagentId!;
    const resumedFrom = kind === "subagent_spawned"
      ? text(record(payload.telemetry).resumedFrom) || text(payload.resumedFrom)
      : null;
    const resumeCandidate = resumedFrom ? findCurrentAgent(items, resumedFrom) : undefined;
    const current = findCurrentAgent(items, nativeId)
      || (subagentId ? findCurrentAgent(items, subagentId) : undefined)
      || resumeCandidate;
    const id = current?.id || nativeId;
    const candidateTitle = compact(text(payload.title));
    const stableTitle = kind === "subagent_spawned" && candidateTitle && !isAgentPlaceholder(candidateTitle)
      ? candidateTitle
      : stableAgentTitle(current?.title || null, candidateTitle) || "Subagent";
    upsertStructuredWork(items, current, event, id, "agent", {
      activityId: subagentId || nativeId,
      childSessionId: childSessionId || nativeId,
      title: stableTitle,
      status: kind === "subagent_finished" ? workStatus(text(payload.status), current?.status, "completed") : "running",
      currentActivity: compact(text(payload.message)) || candidateTitle || current?.currentActivity || null,
      outputTail: text(payload.outputTail) || current?.outputTail || null,
      telemetry: mergeWorkTelemetry(current?.telemetry || null, payload.telemetry),
    });
    return true;
  }
  return false;
}

function upsertStructuredWork(
  items: Map<string, WorkItemSnapshot>, current: WorkItemSnapshot | undefined,
  event: TaskEventEnvelope, id: string, kind: WorkItemKind,
  patch: Partial<Pick<WorkItemSnapshot, "activityId" | "childSessionId" | "title" | "status" | "currentActivity" | "outputTail" | "telemetry">>,
): void {
  const base: WorkItemSnapshot = current || {
    id, kind, activityId: id, childSessionId: kind === "agent" ? id : null,
    title: null, status: "running", currentActivity: null, outputTail: null, telemetry: null,
    startedAt: event.occurredAt, updatedAt: event.occurredAt,
  };
  replaceWork(items, current, {
    ...base, ...patch, id, kind,
    activityId: patch.activityId ?? id,
    childSessionId: patch.childSessionId !== undefined ? patch.childSessionId : kind === "agent" ? id : null,
    updatedAt: event.occurredAt,
  });
}

function replaceWork(items: Map<string, WorkItemSnapshot>, current: WorkItemSnapshot | undefined, next: WorkItemSnapshot): void {
  if (current && current.id !== next.id) items.delete(current.id);
  items.set(next.id, next);
}

function projectLifecycleHistory(events: TaskEventEnvelope[]): ContextHistoryItem[] {
  return events.flatMap((event): ContextHistoryItem[] => {
    if (event.method.startsWith("task/plan:")) {
      const decision = event.method.slice("task/plan:".length);
      return [{ id: `history:${event.eventId}`, turnId: event.turnId, kind: "plan", occurredAt: event.occurredAt, status: decision === "cancelled" ? "active" : "inactive", title: text(record(event.payload).title) || "Plan review" }];
    }
    return [];
  });
}

function todoTurnId(events: TaskEventEnvelope[], todo: TodoGroupSnapshot): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event.turnId || (event.method !== "session/update:plan" && event.method !== "session/update:plan_update")) continue;
    const payload = record(event.payload);
    const planId = text(payload.planId);
    const groupId = planId ? `plan:${planId}` : `epoch:${event.connectionEpoch}:${event.turnId || "detached"}`;
    if (groupId === todo.groupId) return event.turnId;
  }
  return null;
}

function workTurnId(events: TaskEventEnvelope[], item: WorkItemSnapshot): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event.turnId || event.method.startsWith("child/")) continue;
    if (confirmsWorkItem(event, item)) return event.turnId;
  }
  return null;
}

function workKind(payload: Record<string, unknown>, toolName: string | null): WorkItemKind | null {
  const type = text(payload.activityType);
  if (type === "background") return "task";
  if (type === "monitor") return "monitor";
  if (type === "loop") return "loop";
  if (toolName === "monitor") return "monitor";
  if (toolName === "run_terminal_command" && payload.background === true) return "task";
  if (toolName === "scheduler_create" || toolName === "loop") return "loop";
  return null;
}

function todoStatus(value: string | null): TodoEntrySnapshot["status"] {
  const status = value?.toLowerCase().replaceAll("-", "_");
  if (status === "in_progress" || status === "running") return "inProgress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

function workStatus(value: string | null, previous: WorkItemStatus = "pending", fallback = previous): WorkItemStatus {
  const status = value?.toLowerCase().replaceAll("-", "_");
  if (status === "unconfirmed" || status === "unknown") return "unconfirmed";
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  if (status === "canceled") return "cancelled";
  if (status === "running" || status === "in_progress") return "running";
  if (status === "pending" || status === "starting" || status === "waiting") return "pending";
  return fallback;
}

function updateWork(items: Map<string, WorkItemSnapshot>, id: string | null, status: WorkItemStatus, output: string | null, at: string): void {
  if (!id) return;
  const current = findCurrentWork(items, id);
  if (current) items.set(current.id, { ...current, status, outputTail: output || current.outputTail, updatedAt: at });
}

function findWork(items: Map<string, WorkItemSnapshot>, id: string): WorkItemSnapshot | undefined {
  return items.get(id) || [...items.values()].find((item) => item.childSessionId === id || item.activityId === id);
}

/** Finds a live runtime identity without treating a stable conversation key as the current child session. */
function findCurrentWork(items: Map<string, WorkItemSnapshot>, id: string): WorkItemSnapshot | undefined {
  const direct = items.get(id);
  if (direct && (direct.kind !== "agent" || direct.childSessionId === id || direct.activityId === id)) return direct;
  return [...items.values()].find((item) => item.childSessionId === id || item.activityId === id);
}

function findCurrentAgent(items: Map<string, WorkItemSnapshot>, id: string): WorkItemSnapshot | undefined {
  const current = findCurrentWork(items, id);
  return current?.kind === "agent" ? current : undefined;
}
function isControlTool(name: string | null): boolean { return name === "get_command_or_subagent_output" || name === "wait_commands_or_subagents" || name === "kill_command_or_subagent" || name === "scheduler_delete"; }
function compareEvent(left: TaskEventEnvelope, right: TaskEventEnvelope): number { return left.connectionEpoch - right.connectionEpoch || left.sequence - right.sequence; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function compact(value: string | null): string | null { return value?.replace(/\s+/g, " ").trim() || null; }
function stableAgentTitle(current: string | null, candidate: string | null): string | null {
  if (!current) return candidate;
  if (isAgentPlaceholder(current) && candidate && !isAgentPlaceholder(candidate)) return candidate;
  return current;
}
function isAgentPlaceholder(value: string): boolean {
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "agent" || normalized === "subagent" || normalized === "spawnsubagent" || normalized === "子代理";
}
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.flatMap((entry) => text(entry) ? [text(entry)!] : []) : []; }

function mergeWorkTelemetry(current: WorkItemSnapshot["telemetry"], value: unknown): WorkItemSnapshot["telemetry"] {
  const next = record(value);
  if (!Object.keys(next).length) return current;
  const previous = current ? current as unknown as Record<string, unknown> : {};
  const numeric = (key: string): number | null => {
    const candidate = typeof next[key] === "number" && Number.isFinite(next[key]) ? next[key] as number : typeof previous[key] === "number" && Number.isFinite(previous[key]) ? previous[key] as number : null;
    return candidate == null ? null : Math.max(0, candidate);
  };
  const optionalText = (key: string): string | null => text(next[key]) || text(previous[key]);
  const tools = stringList(next.toolsUsed);
  return {
    agentType: optionalText("agentType"),
    role: optionalText("role"),
    modelId: optionalText("modelId"),
    contextSource: optionalText("contextSource"),
    capabilityMode: optionalText("capabilityMode"),
    resumedFrom: optionalText("resumedFrom"),
    contextNormalized: typeof next.contextNormalized === "boolean" ? next.contextNormalized : current?.contextNormalized ?? null,
    turnCount: numeric("turnCount"),
    toolCallCount: numeric("toolCallCount"),
    errorCount: numeric("errorCount"),
    contextUsagePct: numeric("contextUsagePct"),
    tokensUsed: numeric("tokensUsed"),
    durationMs: numeric("durationMs"),
    toolsUsed: tools.length ? tools : current?.toolsUsed || [],
    willWake: typeof next.willWake === "boolean" ? next.willWake : current?.willWake ?? null,
  };
}
