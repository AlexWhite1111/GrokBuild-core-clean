import type { TaskDetailProjection, TaskEventCursor, TaskEventEnvelope, TaskMessageBlock } from "../../shared/contracts.js";
import { sessionLifecycleSignal, type SessionLifecycleKind, type SessionLifecycleState } from "../../shared/sessionLifecycle.js";
import { projectTaskExecution, type CurrentTurnOutcome } from "../../shared/taskExecutionStatus.js";
import type { ProcessGlyphKind } from "../../ui/components/index.js";

type TurnOutcome = "running" | "completed" | "failed" | "stopped" | "unknown";
type GoalTerminalOutcome = "completed" | "cleared" | "cancelled" | "failed" | "interrupted" | "ended";
export interface GoalOutcomePresentation {
  outcome: GoalTerminalOutcome;
  objective: string | null;
  durationSeconds: number | null;
}

export interface ToolStepPresentation {
  id: string;
  label: string;
  name?: string;
  detail?: string;
  icon: ProcessGlyphKind;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  anchor: TaskEventEnvelope;
  latest: TaskEventEnvelope;
}

type AssistantSegment = { id: string; kind: "assistant"; message: TaskMessageBlock; final: boolean };
type ThoughtSegment = { id: string; kind: "thought"; message: TaskMessageBlock };
type ToolRunSegment = { id: string; kind: "toolRun"; steps: ToolStepPresentation[]; anchor: TaskEventEnvelope };
export interface SessionLifecycleSegment {
  id: string;
  kind: "sessionLifecycle";
  lifecycle: SessionLifecycleKind;
  status: SessionLifecycleState;
  detail?: string;
  anchor: TaskEventEnvelope;
  latest: TaskEventEnvelope;
}

type ProcessGroupItem = ThoughtSegment | ToolRunSegment | SessionLifecycleSegment;
export interface ProcessGroupSegment {
  id: string;
  kind: "processGroup";
  items: ProcessGroupItem[];
}
export type TurnSegment = AssistantSegment | ProcessGroupSegment | SessionLifecycleSegment;
type TurnUnit = AssistantSegment | ThoughtSegment | ToolRunSegment | SessionLifecycleSegment;

interface ModelPassPresentation {
  id: string;
  streamStartMs: number | null;
  interjection: boolean;
  segments: TurnSegment[];
  firstEvent?: TaskEventCursor;
}

interface NativeTurnPresentation {
  id: string;
  promptId: string | null;
  turnStartMs: number | null;
  modelPasses: ModelPassPresentation[];
}

export interface GrokTurnPresentation {
  /** Local PromptExecution identity. It remains stable across Interject. */
  turnId: string;
  promptExecutionId: string;
  outcome: TurnOutcome;
  showStatus: boolean;
  nativeTurns: NativeTurnPresentation[];
  /** Flattened view retained for copy/theme extraction only. */
  segments: TurnSegment[];
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export type TimelineItem =
  | { id: string; at: string; kind: "user"; message: TaskMessageBlock }
  | { id: string; at: string; kind: "assistant"; turn: GrokTurnPresentation }
  | { id: string; at: string; kind: "goal"; event: TaskEventEnvelope; presentation: GoalOutcomePresentation }
  | { id: string; at: string; kind: "lifecycle"; segments: SessionLifecycleSegment[] };

interface ProtocolCoordinates {
  promptId: string | null;
  turnStartMs: number | null;
  streamStartMs: number | null;
}

interface ModelPassBucket extends ProtocolCoordinates {
  id: string;
  nativeTurnId: string;
  units: TurnUnit[];
}

interface ExecutionBucket {
  id: string;
  users: TaskMessageBlock[];
  passes: Map<string, ModelPassBucket>;
  start: TaskEventEnvelope | null;
  end: TaskEventEnvelope | null;
  terminals: TaskEventEnvelope[];
}

interface ProtocolMaps {
  executionByTurn: Map<string, string>;
  executionByNativeTurn: Map<string, string>;
}

function buildTurnTimeline(detail: TaskDetailProjection): TimelineItem[] {
  const taskExecution = projectTaskExecution(detail.snapshot);
  const orderedEvents = [...detail.events].sort(compareEvents);
  const maps = protocolMaps(detail.messages);
  const buckets = new Map<string, ExecutionBucket>();
  const bucket = (id: string): ExecutionBucket => {
    let value = buckets.get(id);
    if (!value) {
      value = { id, users: [], passes: new Map(), start: null, end: null, terminals: [] };
      buckets.set(id, value);
    }
    return value;
  };

  for (const message of detail.messages) {
    const executionId = message.protocol?.promptExecutionId || message.turnId;
    const target = bucket(executionId);
    if (message.role === "user") {
      target.users.push(message);
      continue;
    }
    const coordinates = messageCoordinates(message);
    addUnit(target, coordinates, {
      id: `message:${message.protocol?.messageId || message.blockId}:${message.blockId}`,
      kind: message.role,
      message,
      final: false,
    });
  }

  for (const step of projectToolSteps(orderedEvents, maps)) {
    const executionId = executionIdForEvent(step.anchor, maps);
    addUnit(bucket(executionId), eventCoordinates(step.anchor), {
      id: `tool:${step.id}:${step.anchor.connectionEpoch}:${step.anchor.sequence}`,
      kind: "toolRun",
      steps: [step],
      anchor: step.anchor,
    });
  }

  const idleLifecycles: SessionLifecycleSegment[] = [];
  for (const lifecycle of projectSessionLifecycles(orderedEvents)) {
    if (lifecycle.lifecycle === "connection") {
      idleLifecycles.push(lifecycle);
      continue;
    }
    const executionId = scopedExecutionId(lifecycle.anchor, maps) || scopedExecutionId(lifecycle.latest, maps);
    if (!executionId) idleLifecycles.push(lifecycle);
    else addUnit(bucket(executionId), eventCoordinates(lifecycle.anchor), lifecycle);
  }

  for (const event of orderedEvents) {
    const executionId = scopedExecutionId(event, maps);
    if (!executionId) continue;
    const startsExecution = event.method === "task/user_message"
      || event.method === "task/user_message_delivery" && record(event.payload).delivery === "accepted";
    const endsExecution = isTurnTerminal(event);
    if (!startsExecution && !endsExecution) continue;
    const target = bucket(executionId);
    if (startsExecution) {
      if (!target.start || compareEvents(event, target.start) < 0) target.start = event;
    }
    if (endsExecution) {
      target.terminals.push(event);
      if (!target.end || compareEvents(event, target.end) > 0) target.end = event;
    }
  }

  const executions = [...buckets.values()].sort(compareExecutions);
  const activeExecutionId = detail.snapshot.currentPromptExecutionId;
  const items: TimelineItem[] = [];
  for (const execution of executions) {
    const users = execution.users.sort(compareMessages);
    for (const message of users) {
      items.push({ id: `user:${execution.id}:${message.blockId}`, at: message.createdAt, kind: "user", message });
    }

    markFinalMessages(execution);
    const interjections = users.filter((message) => message.protocol?.interjection === true && message.firstEvent);
    const slices = slicePasses(execution, interjections);
    const outcome = executionOutcome(execution, activeExecutionId, taskExecution.currentTurnOutcome);
    const startedAt = execution.start?.occurredAt
      || users[0]?.createdAt
      || firstPassAt(execution)
      || execution.end?.occurredAt
      || detail.snapshot.createdAt;
    const endedAt = execution.end?.occurredAt || null;
    const durationMs = endedAt ? elapsed(startedAt, endedAt) : null;
    slices.forEach((nativeTurns, index) => {
      const segments = flattenSegments(nativeTurns);
      if (!segments.length) return;
      items.push({
        id: `assistant:${execution.id}:slice:${index}`,
        at: segmentAt(segments[0]),
        kind: "assistant",
        turn: {
          turnId: execution.id,
          promptExecutionId: execution.id,
          outcome,
          showStatus: index === 0,
          nativeTurns,
          segments,
          startedAt,
          endedAt,
          durationMs,
        },
      });
    });
  }

  for (const lifecycle of idleLifecycles) {
    items.push({ id: `lifecycle:${lifecycle.id}`, at: lifecycle.anchor.occurredAt, kind: "lifecycle", segments: [lifecycle] });
  }
  for (const goal of projectGoalOutcomes(orderedEvents)) {
    items.push({
      id: `goal:${goal.event.eventId}`,
      at: goal.event.occurredAt,
      kind: "goal",
      event: goal.event,
      presentation: goal.presentation,
    });
  }
  items.sort(compareTimelineItems);
  return mergeLifecycleClusters(items);
}

/**
 * Keep the expensive protocol grouping stable while the current message grows
 * to an existing block. The reconciler already preserves every unaffected
 * message by reference. Official structural events are compared by content so
 * JSON snapshots do not force the timeline to regroup on every text delta.
 */
export function createTurnTimelineProjector(onBuild: () => void = () => undefined): (detail: TaskDetailProjection) => TimelineItem[] {
  let structureKey: string | null = null;
  let executionKey: string | null = null;
  let eventKey: string | null = null;
  let timeline: TimelineItem[] | null = null;
  return (detail) => {
    const nextKey = messageStructureKey(detail.messages);
    const nextExecutionKey = JSON.stringify([
      projectTaskExecution(detail.snapshot),
      detail.snapshot.currentPromptExecutionId,
    ]);
    const nextEventKey = JSON.stringify(detail.events);
    if (!timeline || structureKey !== nextKey || executionKey !== nextExecutionKey || eventKey !== nextEventKey) {
      timeline = buildTurnTimeline(detail);
      structureKey = nextKey;
      executionKey = nextExecutionKey;
      eventKey = nextEventKey;
      onBuild();
      return timeline;
    }
    timeline = refreshTimelineMessages(timeline, detail.messages);
    return timeline;
  };
}

function messageStructureKey(messages: TaskMessageBlock[]): string {
  return JSON.stringify(messages.map((message) => [
    message.blockId,
    message.role,
    message.turnId,
    message.streaming,
    message.createdAt,
    message.sourceOrdinal,
    message.firstEvent,
    message.protocol,
  ]));
}

function refreshTimelineMessages(timeline: TimelineItem[], messages: TaskMessageBlock[]): TimelineItem[] {
  const latest = new Map(messages.map((message) => [message.blockId, message]));
  let changed = false;
  const next = timeline.map((item) => {
    if (item.kind === "user") {
      const message = latest.get(item.message.blockId) || item.message;
      if (message === item.message) return item;
      changed = true;
      return { ...item, message };
    }
    if (item.kind !== "assistant") return item;
    const turn = refreshTurnMessages(item.turn, latest);
    if (turn === item.turn) return item;
    changed = true;
    return { ...item, turn };
  });
  return changed ? next : timeline;
}

function refreshTurnMessages(turn: GrokTurnPresentation, latest: Map<string, TaskMessageBlock>): GrokTurnPresentation {
  const segments = refreshSegments(turn.segments, latest);
  let nativeChanged = false;
  const nativeTurns = turn.nativeTurns.map((nativeTurn) => {
    let passChanged = false;
    const modelPasses = nativeTurn.modelPasses.map((pass) => {
      const nextSegments = refreshSegments(pass.segments, latest);
      if (nextSegments === pass.segments) return pass;
      passChanged = true;
      return { ...pass, segments: nextSegments };
    });
    if (!passChanged) return nativeTurn;
    nativeChanged = true;
    return { ...nativeTurn, modelPasses };
  });
  return segments === turn.segments && !nativeChanged ? turn : { ...turn, segments, nativeTurns };
}

function refreshSegments<T extends TurnSegment[]>(segments: T, latest: Map<string, TaskMessageBlock>): T {
  let changed = false;
  const next = segments.map((segment) => {
    if (segment.kind === "assistant") {
      const message = latest.get(segment.message.blockId) || segment.message;
      if (message === segment.message) return segment;
      changed = true;
      return { ...segment, message };
    }
    if (segment.kind !== "processGroup") return segment;
    let itemsChanged = false;
    const items = segment.items.map((item) => {
      if (item.kind !== "thought") return item;
      const message = latest.get(item.message.blockId) || item.message;
      if (message === item.message) return item;
      itemsChanged = true;
      return { ...item, message };
    });
    if (!itemsChanged) return segment;
    changed = true;
    return { ...segment, items };
  });
  return (changed ? next : segments) as T;
}

function protocolMaps(messages: TaskMessageBlock[]): ProtocolMaps {
  const executionByTurn = new Map<string, string>();
  const executionByNativeTurn = new Map<string, string>();
  for (const message of messages) {
    const executionId = message.protocol?.promptExecutionId || message.turnId;
    executionByTurn.set(message.turnId, executionId);
    const coordinates = messageCoordinates(message);
    const native = nativeTurnId(coordinates);
    if (coordinates.promptId && coordinates.turnStartMs != null) executionByNativeTurn.set(native, executionId);
  }
  return { executionByTurn, executionByNativeTurn };
}

function addUnit(target: ExecutionBucket, coordinates: ProtocolCoordinates, unit: TurnUnit): void {
  const nativeId = nativeTurnId(coordinates);
  const passId = modelPassId(nativeId, coordinates.streamStartMs);
  let pass = target.passes.get(passId);
  if (!pass) {
    pass = { id: passId, nativeTurnId: nativeId, ...coordinates, units: [] };
    target.passes.set(passId, pass);
  }
  pass.units.push(unit);
}

function slicePasses(execution: ExecutionBucket, interjections: TaskMessageBlock[]): NativeTurnPresentation[][] {
  const cuts = interjections.map((message) => message.firstEvent!).sort(compareCursors);
  const slices: ModelPassBucket[][] = Array.from({ length: cuts.length + 1 }, () => []);
  const passes = [...execution.passes.values()].sort(comparePasses);
  for (const pass of passes) {
    const first = passFirstCursor(pass);
    let index = 0;
    while (first && index < cuts.length && compareCursors(first, cuts[index]) >= 0) index += 1;
    slices[index].push(pass);
  }
  return slices.filter((slice) => slice.length).map((slice, sliceIndex) => nativeTurnsFromPasses(slice, sliceIndex > 0));
}

function nativeTurnsFromPasses(passes: ModelPassBucket[], interjectionSlice: boolean): NativeTurnPresentation[] {
  const result: NativeTurnPresentation[] = [];
  const byId = new Map<string, NativeTurnPresentation>();
  passes.forEach((pass, index) => {
    let native = byId.get(pass.nativeTurnId);
    if (!native) {
      native = { id: pass.nativeTurnId, promptId: pass.promptId, turnStartMs: pass.turnStartMs, modelPasses: [] };
      byId.set(pass.nativeTurnId, native);
      result.push(native);
    }
    const firstEvent = passFirstCursor(pass);
    native.modelPasses.push({
      id: pass.id,
      streamStartMs: pass.streamStartMs,
      interjection: interjectionSlice && index === 0,
      segments: projectProcessGroups(pass.units.sort(compareUnits)),
      ...(firstEvent ? { firstEvent } : {}),
    });
  });
  return result;
}

function flattenSegments(nativeTurns: NativeTurnPresentation[]): TurnSegment[] {
  const result: TurnSegment[] = [];
  for (const segment of nativeTurns.flatMap((native) => native.modelPasses.flatMap((pass) => pass.segments))) {
    const previous = result.at(-1);
    if (segment.kind === "processGroup" && previous?.kind === "processGroup") previous.items.push(...segment.items);
    else result.push(segment);
  }
  return result;
}

function markFinalMessages(execution: ExecutionBucket): void {
  for (const terminal of execution.terminals.sort(compareEvents)) {
    const coordinates = eventCoordinates(terminal);
    const exactNative = coordinates.promptId && coordinates.turnStartMs != null
      ? nativeTurnId(coordinates)
      : null;
    const terminalCursor = cursor(terminal);
    const candidates = [...execution.passes.values()]
      .filter((pass) => !exactNative || pass.nativeTurnId === exactNative)
      .flatMap((pass) => pass.units)
      .filter((unit): unit is AssistantSegment => unit.kind === "assistant" && Boolean(unit.message.lastEvent))
      .filter((unit) => compareCursors(unit.message.lastEvent!, terminalCursor) < 0)
      .sort((left, right) => compareCursors(left.message.lastEvent!, right.message.lastEvent!));
    const final = candidates.at(-1);
    if (final) final.final = true;
  }
}

function projectToolSteps(events: TaskEventEnvelope[], maps: ProtocolMaps): ToolStepPresentation[] {
  const steps = new Map<string, ToolStepPresentation & { payload: Record<string, unknown> }>();
  const latestKeyByTool = new Map<string, string>();
  for (const event of events) {
    if (!isToolEvent(event)) continue;
    const payload = record(event.payload);
    if (text(payload.toolName)?.toLowerCase() === "update_goal") continue;
    const toolCallId = text(payload.toolCallId) || event.eventId;
    const coordinates = eventCoordinates(event);
    const explicitPass = coordinates.promptId && coordinates.turnStartMs != null
      ? modelPassId(nativeTurnId(coordinates), coordinates.streamStartMs)
      : null;
    const executionId = executionIdForEvent(event, maps);
    const existingKey = latestKeyByTool.get(`${executionId}:${toolCallId}`);
    const runKey = event.method.endsWith(":tool_call")
      ? `${executionId}:${toolCallId}:${explicitPass || `${event.connectionEpoch}:${event.sequence}`}`
      : existingKey || `${executionId}:${toolCallId}:${explicitPass || `${event.connectionEpoch}:${event.sequence}`}`;
    const current = steps.get(runKey);
    const merged = { ...(current?.payload || {}), ...payload };
    const anchor = current?.anchor || event;
    const latest = !current || compareEvents(current.latest, event) <= 0 ? event : current.latest;
    steps.set(runKey, {
      id: runKey,
      label: toolLabel(merged, latest),
      name: text(merged.toolName),
      detail: toolDetail(merged),
      icon: toolIcon(merged),
      status: toolStatus(payload, merged, latest, current?.status),
      anchor,
      latest,
      payload: merged,
    });
    latestKeyByTool.set(`${executionId}:${toolCallId}`, runKey);
  }
  return [...steps.values()].sort((left, right) => compareEvents(left.anchor, right.anchor));
}

function projectProcessGroups(units: TurnUnit[]): TurnSegment[] {
  const result: TurnSegment[] = [];
  let group: ProcessGroupSegment | null = null;
  for (const unit of units) {
    if (unit.kind === "assistant") {
      result.push(unit);
      group = null;
      continue;
    }
    if (!group) {
      group = { id: `process:${unit.id}`, kind: "processGroup", items: [] };
      result.push(group);
    }
    const previous = group.items.at(-1);
    if (unit.kind === "toolRun" && previous?.kind === "toolRun") previous.steps.push(...unit.steps);
    else group.items.push(unit);
  }
  return result;
}

function projectSessionLifecycles(events: TaskEventEnvelope[]): SessionLifecycleSegment[] {
  const result: SessionLifecycleSegment[] = [];
  const open = new Map<string, SessionLifecycleSegment>();
  let observedModel: string | null = null;
  for (const event of events) {
    const signal = sessionLifecycleSignal(event.method, event.payload);
    if (!signal) continue;
    if (signal.kind === "modelChange") {
      const model = text(record(event.payload).model);
      if (!model) continue;
      if (observedModel === null) {
        observedModel = model;
        continue;
      }
      if (observedModel === model) continue;
      observedModel = model;
    }
    const coordinates = eventCoordinates(event);
    const key = `${signal.kind}:${nativeTurnId(coordinates)}:${modelPassId(nativeTurnId(coordinates), coordinates.streamStartMs)}`;
    const detail = lifecycleDetail(event.payload);
    const current = open.get(key);
    if (current) {
      current.latest = event;
      current.status = signal.state;
      if (detail) current.detail = detail;
      if (signal.state !== "running") open.delete(key);
      continue;
    }
    const lifecycle: SessionLifecycleSegment = {
      id: `lifecycle:${event.eventId}`,
      kind: "sessionLifecycle",
      lifecycle: signal.kind,
      status: signal.state,
      ...(detail ? { detail } : {}),
      anchor: event,
      latest: event,
    };
    result.push(lifecycle);
    if (signal.state === "running") open.set(key, lifecycle);
  }
  return visibleSessionLifecycles(result);
}

function visibleSessionLifecycles(values: SessionLifecycleSegment[]): SessionLifecycleSegment[] {
  const latestUnscopedFailure = new Map<SessionLifecycleKind, SessionLifecycleSegment>();
  for (const value of values) {
    if (value.status === "failed" && !hasNativeLifecycleScope(value)) {
      latestUnscopedFailure.set(value.lifecycle, value);
    }
  }
  return values.filter((value) => {
    if (value.lifecycle === "memoryFlush" && value.status !== "failed") return false;
    if (value.lifecycle === "modelChange") return true;
    if (hasNativeLifecycleScope(value)) return true;
    return value.status === "failed" && latestUnscopedFailure.get(value.lifecycle) === value;
  });
}

function hasNativeLifecycleScope(value: SessionLifecycleSegment): boolean {
  return hasNativeEventScope(value.anchor) || hasNativeEventScope(value.latest);
}

function hasNativeEventScope(event: TaskEventEnvelope): boolean {
  const coordinates = eventCoordinates(event);
  return Boolean(coordinates.promptId && coordinates.turnStartMs != null);
}

function executionOutcome(execution: ExecutionBucket, activeExecutionId: string | null, currentTurnOutcome: CurrentTurnOutcome): TurnOutcome {
  const terminal = execution.end;
  if (terminal) {
    const payload = record(terminal.payload);
    const reason = text(payload.stopReason)?.toLowerCase() || "";
    if (terminal.method.includes("failed")) return "failed";
    if (terminal.method.includes("interrupted") || reason.includes("cancel") || reason.includes("interrupt")) return "stopped";
    return "completed";
  }
  if (execution.id === activeExecutionId) return currentTurnOutcome;
  return "unknown";
}

function projectGoalOutcomes(events: TaskEventEnvelope[]): Array<{ event: TaskEventEnvelope; presentation: GoalOutcomePresentation }> {
  const results: Array<{ event: TaskEventEnvelope; presentation: GoalOutcomePresentation }> = [];
  const objectives = new Map<string, string | null>();
  for (const event of events) {
    if (!event.method.startsWith("task/goal:")) continue;
    const payload = record(event.payload);
    const action = text(payload.action)?.toLowerCase();
    const status = text(payload.status)?.toLowerCase();
    const goalId = text(payload.goalId) || `turn:${event.turnId || "detached"}`;
    const objective = text(payload.objective) || objectives.get(goalId) || null;
    if (objective) objectives.set(goalId, objective);
    if (status !== "inactive" || (!event.method.endsWith(":structured") && !event.method.endsWith(":confirmed"))) continue;
    const lastOutcome = text(payload.lastOutcome)?.toLowerCase();
    const outcome: GoalTerminalOutcome = lastOutcome === "completed" ? "completed"
      : action === "clear" || lastOutcome === "cleared" ? "cleared"
        : lastOutcome === "cancelled" || lastOutcome === "failed" || lastOutcome === "interrupted" ? lastOutcome : "ended";
    const seconds = numeric(payload.timeUsedSeconds);
    results.push({ event, presentation: { outcome, objective, durationSeconds: seconds == null ? null : Math.max(0, seconds) } });
  }
  return results;
}

function scopedExecutionId(event: TaskEventEnvelope, maps: ProtocolMaps): string | null {
  const payload = record(event.payload);
  const local = text(payload.localTurnId);
  if (local) return local;
  const native = nativeTurnId(eventCoordinates(event));
  const mappedNative = maps.executionByNativeTurn.get(native);
  if (mappedNative) return mappedNative;
  if (event.turnId) return maps.executionByTurn.get(event.turnId) || event.turnId;
  return null;
}

function executionIdForEvent(event: TaskEventEnvelope, maps: ProtocolMaps): string {
  return scopedExecutionId(event, maps) || `session:${event.connectionEpoch}`;
}

function messageCoordinates(message: TaskMessageBlock): ProtocolCoordinates {
  return {
    promptId: message.protocol?.promptId || null,
    turnStartMs: message.protocol?.turnStartMs ?? null,
    streamStartMs: message.protocol?.streamStartMs ?? null,
  };
}

function eventCoordinates(event: TaskEventEnvelope): ProtocolCoordinates {
  const payload = record(event.payload);
  return {
    promptId: text(payload.promptId) || null,
    turnStartMs: integer(payload.turnStartMs),
    streamStartMs: integer(payload.streamStartMs),
  };
}

function nativeTurnId(value: ProtocolCoordinates): string {
  return value.promptId && value.turnStartMs != null
    ? `native:${value.promptId}:${value.turnStartMs}`
    : `native:unscoped:${value.promptId || "none"}:${value.turnStartMs ?? "none"}`;
}

function modelPassId(nativeId: string, streamStartMs: number | null): string {
  return `${nativeId}:pass:${streamStartMs ?? "unscoped"}`;
}

function toolStatus(latestPayload: Record<string, unknown>, merged: Record<string, unknown>, latest: TaskEventEnvelope, previous?: ToolStepPresentation["status"]): ToolStepPresentation["status"] {
  if (previous === "completed" || previous === "failed" || previous === "cancelled") return previous;
  const status = (text(latestPayload.status) || "").toLowerCase();
  const exact = exactStatus(status);
  if (exact) return exact;
  if (text(latestPayload.error) || text(latestPayload.exception)) return "failed";
  if (latest.method.endsWith(":tool_call")) return "running";
  if ((text(merged.kind) || "").toLowerCase() === "think" && latest.method.endsWith(":tool_call_update")) return "completed";
  return previous || "unknown";
}

function exactStatus(value?: string): ToolStepPresentation["status"] | undefined {
  if (value === "failed" || value === "error" || value === "denied" || value === "exception") return "failed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "completed" || value === "complete" || value === "success" || value === "done") return "completed";
  if (value === "pending" || value === "running" || value === "in_progress" || value === "started") return "running";
}

function toolLabel(payload: Record<string, unknown>, event: TaskEventEnvelope): string {
  return displayText(payload.title)
    || displayText(payload.toolName)?.replaceAll("_", " ")
    || displayText(event.method.replace("session/update:", ""))
    || "Working";
}

function toolDetail(payload: Record<string, unknown>): string | undefined {
  const value = text(payload.outputTail) || text(payload.message) || text(payload.reason) || text(payload.result);
  if (!value) return undefined;
  return payload.outputTruncated === true ? `\u2026\n${value}` : value;
}

const KIND_ICON: Record<string, ProcessGlyphKind> = {
  read: "read", edit: "edit", delete: "edit", move: "edit", search: "search",
  execute: "command", think: "thought", fetch: "web", switch_mode: "tools", other: "generic",
};
const TOOL_ICON: Record<string, ProcessGlyphKind> = {
  list_dir: "list", read_file: "read", grep: "search", search: "search", web_search: "web", web_fetch: "web", open_page: "web", open_page_with_find: "web",
  view_image: "image", image_gen: "image", image_edit: "image", video_gen: "image", run_terminal_command: "command", write: "edit", search_replace: "edit", apply_patch: "edit",
  spawn_subagent: "subagent", get_command_or_subagent_output: "wait", wait_commands_or_subagents: "wait", monitor: "monitor", kill_command_or_subagent: "stop",
  compact_conversation: "compact", memory_search: "memory", memory_get: "memory", ask_user_question: "question", enter_plan_mode: "plan", update_plan: "plan",
  search_tool: "extension", use_tool: "extension", git_diff: "git", worktree: "git",
};
const MEDIA_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".mp4", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a", ".aac"];

function toolIcon(payload: Record<string, unknown>): ProcessGlyphKind {
  const name = (text(payload.toolName) || "").toLowerCase();
  const kind = (text(payload.kind) || "").toLowerCase();
  const title = (text(payload.title) || "").toLowerCase();
  const activity = (text(payload.activityType) || "").toLowerCase();
  if (activity === "subagent" || activity === "background" || activity === "monitor") return activity === "subagent" ? "subagent" : activity === "monitor" ? "monitor" : "command";
  if (name === "read_file" && MEDIA_SUFFIXES.some((suffix) => title.includes(suffix))) return "image";
  return TOOL_ICON[name] || KIND_ICON[kind] || "generic";
}

function lifecycleDetail(payload: unknown): string | undefined {
  const value = record(payload);
  const attempt = numeric(value.attempt);
  const maxAttempts = numeric(value.maxAttempts);
  const detail = attempt != null ? `${attempt}${maxAttempts != null ? `/${maxAttempts}` : ""}`
    : text(value.model) || text(value.message) || text(value.reason) || text(value.result) || text(value.error) || text(value.exception);
  return detail?.slice(0, 500);
}

function isTurnTerminal(event: TaskEventEnvelope): boolean {
  return event.method === "session/prompt:completed"
    || event.method === "session/prompt:failed"
    || event.method === "session/prompt:interrupted";
}

function compareExecutions(left: ExecutionBucket, right: ExecutionBucket): number {
  return compareOrder(executionOrder(left), executionOrder(right));
}

function executionFirstCursor(value: ExecutionBucket): TaskEventCursor | undefined {
  const cursors = [
    ...value.users.map((message) => message.firstEvent),
    ...[...value.passes.values()].map(passFirstCursor),
    value.start ? cursor(value.start) : undefined,
  ].filter((entry): entry is TaskEventCursor => Boolean(entry));
  return cursors.sort(compareCursors)[0];
}

function comparePasses(left: ModelPassBucket, right: ModelPassBucket): number {
  return compareOrder(passOrder(left), passOrder(right));
}

function passFirstCursor(pass: ModelPassBucket): TaskEventCursor | undefined {
  return pass.units.map(unitCursor).filter((value): value is TaskEventCursor => Boolean(value)).sort(compareCursors)[0];
}

function compareUnits(left: TurnUnit, right: TurnUnit): number {
  return compareOrder(unitOrder(left), unitOrder(right)) || unitRank(left) - unitRank(right);
}

function compareMessages(left: TaskMessageBlock, right: TaskMessageBlock): number {
  return compareOrder(messageOrder(left), messageOrder(right));
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return compareOrder(timelineOrder(left), timelineOrder(right)) || timelineRank(left) - timelineRank(right);
}

interface PresentationOrder {
  sourceOrdinal: number | null;
  event: TaskEventCursor | null;
  at: string;
  id: string;
}

function compareOrder(left: PresentationOrder, right: PresentationOrder): number {
  const leftKind = left.sourceOrdinal != null ? 0 : left.event ? 1 : 2;
  const rightKind = right.sourceOrdinal != null ? 0 : right.event ? 1 : 2;
  if (leftKind !== rightKind) return leftKind - rightKind;
  if (leftKind === 0 && left.sourceOrdinal !== right.sourceOrdinal) return left.sourceOrdinal! - right.sourceOrdinal!;
  if (leftKind === 1) {
    const compared = compareCursors(left.event!, right.event!);
    if (compared) return compared;
  }
  return left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
}

function executionOrder(execution: ExecutionBucket): PresentationOrder {
  const sourceOrdinal = minimum([
    ...execution.users.map((message) => message.sourceOrdinal),
    ...[...execution.passes.values()].map(passFirstSourceOrdinal),
  ]);
  const at = execution.start?.occurredAt
    || execution.users[0]?.createdAt
    || firstPassAt(execution)
    || execution.end?.occurredAt
    || "";
  return { sourceOrdinal, event: executionFirstCursor(execution) || null, at, id: execution.id };
}

function passOrder(pass: ModelPassBucket): PresentationOrder {
  const first = pass.units.slice().sort((left, right) => compareOrder(unitOrder(left), unitOrder(right)))[0];
  return {
    sourceOrdinal: passFirstSourceOrdinal(pass),
    event: passFirstCursor(pass) || null,
    at: first ? segmentAt(first) : "",
    id: pass.id,
  };
}

function unitOrder(unit: TurnUnit): PresentationOrder {
  return {
    sourceOrdinal: unitSourceOrdinal(unit),
    event: unitCursor(unit) || null,
    at: segmentAt(unit),
    id: unit.id,
  };
}

function messageOrder(message: TaskMessageBlock): PresentationOrder {
  return {
    sourceOrdinal: message.sourceOrdinal ?? null,
    event: message.firstEvent || null,
    at: message.createdAt,
    id: message.blockId,
  };
}

function timelineOrder(item: TimelineItem): PresentationOrder {
  if (item.kind === "user") return messageOrder(item.message);
  if (item.kind === "assistant") {
    return {
      sourceOrdinal: minimum(item.turn.segments.map(segmentSourceOrdinal)),
      event: firstModelPass(item.turn.nativeTurns)?.firstEvent || null,
      at: item.at,
      id: item.id,
    };
  }
  if (item.kind === "goal") {
    return { sourceOrdinal: null, event: cursor(item.event), at: item.at, id: item.id };
  }
  return {
    sourceOrdinal: null,
    event: item.segments[0] ? cursor(item.segments[0].anchor) : null,
    at: item.at,
    id: item.id,
  };
}

function firstModelPass(nativeTurns: NativeTurnPresentation[]): ModelPassPresentation | undefined {
  return nativeTurns[0]?.modelPasses[0];
}

function passFirstSourceOrdinal(pass: ModelPassBucket): number | null {
  return minimum(pass.units.map(unitSourceOrdinal));
}

function unitSourceOrdinal(unit: TurnUnit): number | null {
  return unit.kind === "assistant" || unit.kind === "thought"
    ? unit.message.sourceOrdinal ?? null
    : null;
}

function segmentSourceOrdinal(segment: TurnSegment | ProcessGroupItem): number | null {
  if (segment.kind === "assistant" || segment.kind === "thought") return segment.message.sourceOrdinal ?? null;
  if (segment.kind === "processGroup") return minimum(segment.items.map(segmentSourceOrdinal));
  return null;
}

function minimum(values: Array<number | null | undefined>): number | null {
  let result: number | null = null;
  for (const value of values) if (value != null && (result == null || value < result)) result = value;
  return result;
}

function timelineRank(item: TimelineItem): number { return item.kind === "user" ? 0 : item.kind === "assistant" ? 1 : item.kind === "goal" ? 2 : 3; }
function unitRank(unit: TurnUnit): number { return unit.kind === "thought" ? 0 : unit.kind === "toolRun" ? 1 : unit.kind === "sessionLifecycle" ? 2 : 3; }
function compareEvents(left: TaskEventEnvelope, right: TaskEventEnvelope): number { return compareCursors(cursor(left), cursor(right)); }
function compareCursors(left: TaskEventCursor, right: TaskEventCursor): number { return left.connectionEpoch - right.connectionEpoch || left.sequence - right.sequence; }
function cursor(event: TaskEventEnvelope): TaskEventCursor { return { connectionEpoch: event.connectionEpoch, sequence: event.sequence }; }

function unitCursor(unit: TurnUnit): TaskEventCursor | undefined {
  return unit.kind === "assistant" || unit.kind === "thought" ? unit.message.firstEvent
    : unit.kind === "toolRun" ? cursor(unit.anchor) : cursor(unit.anchor);
}

function segmentAt(segment: TurnUnit | TurnSegment): string {
  return segment.kind === "assistant" || segment.kind === "thought" ? segment.message.createdAt
    : segment.kind === "toolRun" ? segment.anchor.occurredAt
      : segment.kind === "processGroup" ? segmentAt(segment.items[0]) : segment.anchor.occurredAt;
}

function firstPassAt(execution: ExecutionBucket): string | null {
  const pass = [...execution.passes.values()].sort(comparePasses)[0];
  const unit = pass?.units.sort(compareUnits)[0];
  return unit ? segmentAt(unit) : null;
}

function elapsed(start: string, end: string): number | null {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function mergeLifecycleClusters(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
    if (item.kind === "lifecycle" && previous?.kind === "lifecycle") previous.segments.push(...item.segments);
    else result.push(item);
  }
  return result;
}

function isToolEvent(event: TaskEventEnvelope): boolean {
  return event.method.includes("tool_call") || event.method.startsWith("x.ai/terminal") || event.method.includes("worktree");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function displayText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}
