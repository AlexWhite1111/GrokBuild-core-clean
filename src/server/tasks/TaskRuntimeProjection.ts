import type {
  ChildSessionDetail,
  PendingGate,
  PlanReviewDraftIdentity,
  PlanReviewDraftSnapshot,
  TaskDetailProjection,
  TaskEventEnvelope,
  TaskEventSource,
  TaskMessageBlock,
  TaskOperationalContextSnapshot,
  TaskSnapshot,
} from "../../shared/contracts.js";
import {
  taskNotificationsFromEvents,
  type TaskNotificationIntent,
} from "../../shared/taskNotifications.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import type { SessionRosterState } from "../acp/sessionRosterContracts.js";
import type { PromptEchoIdentity } from "./PromptEchoQueue.js";
import { TaskCommandProjection } from "./TaskCommandProjection.js";
import { TaskSemanticProjection } from "./TaskSemanticProjection.js";
import { TaskRuntimeTranscript } from "./TaskRuntimeTranscript.js";
import type { TaskStoredTimelineItem, TaskStoreScope } from "./TaskStore.js";
import { canTransitionDelivery, promptFingerprint } from "./taskDelivery.js";
import { asRecord, readMeta, safeSessionUpdate, string } from "./taskEventSanitizers.js";
import { mediaForSessionUpdate, type ProjectionMediaContext } from "./taskMediaProjection.js";

const REPLAY_TURN_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
  "plan_update",
  "plan_removed",
  "current_mode_update",
  "turn_completed",
  "turn_failed",
  "retry_state",
  "goal_updated",
  "task_backgrounded",
  "task_completed",
  "monitor_event",
  "scheduled_task_created",
  "scheduled_task_fired",
  "scheduled_task_deleted",
  "subagent_spawned",
  "subagent_progress",
  "subagent_finished",
]);

const STATIC_TRANSCRIPT_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
]);

const TEXT_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
]);

export type TaskRuntimeNotification =
  | { kind: "acp"; params: unknown; turnId: string | null; userEcho?: PromptEchoIdentity }
  | { kind: "child-acp"; params: unknown }
  | { kind: "xai"; method: string; params: unknown; turnId: string | null }
  | { kind: "child-xai"; method: string; params: unknown };

export interface TaskRuntimeNotificationResult {
  acceptedRequestIds: string[];
  refreshContextWindow: boolean;
}

interface TaskRuntimeProjectionOptions {
  media?: ProjectionMediaContext;
  restored?: TaskDetailProjection;
  readChild?(sessionId: string): TaskDetailProjection | null;
  pinned?: boolean;
  notify?(taskId: string, notification: TaskNotificationIntent): void;
}

/**
 * Runtime projection of the official session stream.
 */
export class TaskRuntimeProjection {
  readonly snapshot: TaskSnapshot;
  readonly messages: TaskMessageBlock[];
  readonly #semantic: TaskSemanticProjection;
  readonly #commands = new TaskCommandProjection();
  readonly #transcript: TaskRuntimeTranscript;
  readonly #children = new Map<string, TaskRuntimeTranscript>();
  readonly #timeline = new Map<string, TaskStoredTimelineItem>();
  readonly #childTimeline = new Map<string, Map<string, TaskStoredTimelineItem>>();
  readonly #timelineOrdinals = new Map<string, number>();
  readonly #officialEventIds = new Set<string>();
  readonly #media?: ProjectionMediaContext;
  readonly #readChild?: TaskRuntimeProjectionOptions["readChild"];
  readonly #notify?: TaskRuntimeProjectionOptions["notify"];
  readonly #dispatchedFingerprints = new Map<string, string>();
  #context: TaskOperationalContextSnapshot;
  #sequence = 0;
  #connectionEpoch = 1;
  #restoredOfficialHistory: boolean;

  constructor(
    snapshot: TaskSnapshot,
    state: JsonStateStore,
    options: TaskRuntimeProjectionOptions,
  ) {
    this.snapshot = snapshot;
    this.#media = options.media;
    this.#readChild = options.readChild;
    this.#notify = options.notify;
    const restored = options.restored;
    this.#restoredOfficialHistory = Boolean(
      restored?.events.length
      || restored?.messages.some((message) => Boolean(message.firstEvent)),
    );
    this.#semantic = new TaskSemanticProjection(snapshot, state, options.media);
    this.#semantic.restore(restored?.events || []);
    this.#transcript = new TaskRuntimeTranscript(
      snapshot,
      this.#commands,
      options.media,
      structuredClone(restored?.messages || []),
    );
    this.messages = this.#transcript.messages;
    this.#context = this.#semantic.context();
    const cursors = [
      ...(restored?.events || []).map((event) => ({ connectionEpoch: event.connectionEpoch, sequence: event.sequence })),
      ...(restored?.messages || []).flatMap((message) => [message.firstEvent, message.lastEvent].filter((value): value is NonNullable<typeof value> => Boolean(value))),
    ];
    this.#connectionEpoch = Math.max(1, ...cursors.map((cursor) => cursor.connectionEpoch));
    this.#sequence = Math.max(0, ...cursors.filter((cursor) => cursor.connectionEpoch === this.#connectionEpoch).map((cursor) => cursor.sequence));
    for (const event of restored?.events || []) {
      this.#officialEventIds.add(event.eventId);
      this.#upsertTimeline(event, false);
    }
  }

  /** Raw chunk events are never retained by the v2 runtime. */
  get rawEventCount(): number {
    return 0;
  }

  get pendingMessageRows(): number {
    return 0;
  }

  detail(): TaskDetailProjection {
    return {
      snapshot: structuredClone(this.snapshot),
      messages: structuredClone(this.messages),
      events: structuredClone([...this.#timeline.values()].sort(byOrdinal).map((entry) => entry.event)),
      context: structuredClone(this.#context),
    };
  }

  childDetail(sessionId: string): ChildSessionDetail {
    const transcript = this.#childTranscript(sessionId);
    const work = [...this.#context.activeWork, ...this.#context.history.flatMap((entry) => entry.kind === "work" ? [entry.work] : [])]
      .find((entry) => entry.childSessionId === sessionId || entry.id === sessionId);
    const timeline = this.#childTimeline.get(sessionId);
    const available = Boolean(transcript?.messages.length || timeline?.size);
    return {
      sessionId,
      status: work?.status || "unconfirmed",
      transcriptAvailable: available,
      detail: available ? {
        snapshot: {
          ...structuredClone(this.snapshot),
          sessionId,
          title: work?.title || "Subagent",
          gates: [],
          queue: { available: false, runningEntryId: null, entries: [] },
        },
        messages: structuredClone(transcript?.messages || []),
        events: structuredClone([...(timeline?.values() || [])].sort(byOrdinal).map((entry) => entry.event)),
        context: emptyContext(),
      } : null,
      reason: available ? null : "No structured child transcript is available yet.",
    };
  }

  beginSessionReplay(): void {
    this.#transcript.beginSessionReplay(this.#restoredOfficialHistory);
    this.#semantic.beginSessionReplay();
  }

  endSessionReplay(): void {
    this.#transcript.endSessionReplay();
    this.#semantic.endSessionReplay();
  }

  adoptOfficialSessionIdentity(sessionId: string): void {
    this.snapshot.sessionId = sessionId;
    if (this.snapshot.taskId === sessionId) return;
    this.snapshot.taskId = sessionId;
    for (const event of this.#semantic.events) event.taskId = sessionId;
    for (const entry of this.#timeline.values()) entry.event.taskId = sessionId;
    for (const timeline of this.#childTimeline.values()) {
      for (const entry of timeline.values()) entry.event.taskId = sessionId;
    }
  }

  addLocalUserMessage(
    text: string,
    turnId: string,
    requestId: string,
    paths: TaskMessageBlock["paths"] = [],
    composerDocument?: TaskMessageBlock["composerDocument"],
    interjection = false,
  ): void {
    const event = this.#transientEvent("supervisor", "task/user_message", turnId, {
      blockId: `user:${requestId}`,
      requestId,
      ...(interjection ? { interjection: true } : {}),
    });
    const before = this.#semantic.events.length;
    this.#semantic.addLocalUserMessage(text, turnId, requestId, paths, composerDocument, interjection);
    this.#discardNewSemanticTextEvents(before);
    this.#transcript.addLocalUser(text, turnId, requestId, paths, event, composerDocument, interjection);
  }

  setUserMessageDelivery(
    requestId: string,
    delivery: NonNullable<TaskMessageBlock["delivery"]>,
  ): void {
    const message = this.#transcript.messageForRequest(requestId);
    if (!message || !canTransitionDelivery(message.delivery, delivery)) return;
    const before = this.#semantic.events.length;
    this.#semantic.setUserMessageDelivery(requestId, delivery, message.turnId);
    const events = this.#captureSemanticEvents(before);
    message.delivery = delivery;
    this.#publish(events);
  }

  userMessageDelivery(requestId: string): TaskMessageBlock["delivery"] | undefined {
    return this.#transcript.messageForRequest(requestId)?.delivery;
  }

  turnForPrompt(promptId: string | undefined): string | null {
    return this.#semantic.turnForPrompt(promptId);
  }

  markUserMessageDispatched(requestId: string, turnId: string, transportText: string): void {
    this.#dispatchedFingerprints.set(promptFingerprint(transportText), requestId);
    const before = this.#semantic.events.length;
    this.#semantic.markUserMessageDispatched(requestId, turnId, transportText);
    const events = this.#captureSemanticEvents(before);
    this.#publish(events);
  }

  applyNotification(notification: TaskRuntimeNotification): TaskRuntimeNotificationResult {
    switch (notification.kind) {
      case "acp":
        return this.#applyAcp(notification.params, notification.turnId, notification.userEcho);
      case "child-acp":
        return this.#applyChildAcp(notification.params);
      case "xai":
        return this.#applyXai(notification.method, notification.params, notification.turnId);
      case "child-xai":
        return this.#applyChildXai(notification.method, notification.params);
    }
  }

  applyAcpNotification(params: unknown, turnId: string | null, userEcho?: PromptEchoIdentity): void {
    this.applyNotification({ kind: "acp", params, turnId, userEcho });
  }

  applyChildAcpNotification(params: unknown): void {
    this.applyNotification({ kind: "child-acp", params });
  }

  applyXaiNotification(method: string, params: unknown, turnId: string | null): string[] {
    return this.applyNotification({ kind: "xai", method, params, turnId }).acceptedRequestIds;
  }

  applyChildXaiNotification(method: string, params: unknown): void {
    this.applyNotification({ kind: "child-xai", method, params });
  }

  beginCommand(turnId: string, requestId: string, name: string, input = "", showOutput = false): void {
    this.#commands.begin(this.snapshot, turnId, requestId, name, input, showOutput);
    this.#semanticChange(() => this.#semantic.beginCommand(turnId, requestId, name, input, showOutput));
  }

  finishCommand(turnId: string, requestId: string, name: string, error?: string): void {
    this.#commands.finish(this.snapshot, turnId, requestId, name, error);
    this.#semanticChange(() => this.#semantic.finishCommand(turnId, requestId, name, error));
  }

  applySessionRosterReceipt(
    state: SessionRosterState,
    source: "x.ai/sessions/list" | "x.ai/sessions/changed",
    turnId: string | null = null,
  ): TaskSnapshot["permission"]["effective"] {
    let result = this.snapshot.permission.effective;
    this.#semanticChange(() => {
      result = this.#semantic.applySessionRosterReceipt(state, source, turnId);
    });
    return result;
  }

  reconcileOfficialGoal(detail: TaskDetailProjection): boolean {
    if (
      !this.snapshot.sessionId
      || detail.snapshot.sessionId !== this.snapshot.sessionId
    ) return false;
    const events = detail.events.filter((event) =>
      event.method === "session/update:goal_updated"
      || event.method === "task/goal:structured");
    if (!events.length) return false;
    let changed = JSON.stringify(this.snapshot.goal) !== JSON.stringify(detail.snapshot.goal);
    if (changed) this.snapshot.goal = structuredClone(detail.snapshot.goal);
    for (const event of events) {
      if (this.#officialEventIds.has(event.eventId)) continue;
      this.#officialEventIds.add(event.eventId);
      this.#upsertTimeline(event, true);
      changed = true;
    }
    return changed;
  }

  addGate(gate: PendingGate, protocolPayload?: unknown): void {
    this.#semanticChange(() => this.#semantic.addGate(gate, protocolPayload));
  }

  removeGate(gateId: string, outcome: "resolved" | "aborted" | "cancelled" = "resolved"): PendingGate | undefined {
    let removed: PendingGate | undefined;
    this.#semanticChange(() => {
      removed = this.#semantic.removeGate(gateId, outcome);
    });
    return removed;
  }

  clearGates(reason: "cancelled" | "disconnected" | "stopped", sessionScope?: "parent" | "child"): PendingGate[] {
    let gates: PendingGate[] = [];
    this.#semanticChange(() => {
      gates = this.#semantic.clearGates(reason, sessionScope);
    });
    return gates;
  }

  planReviewDraft(identity: PlanReviewDraftIdentity): PlanReviewDraftSnapshot {
    return this.#semantic.planReviewDraft(identity);
  }

  savePlanReviewDraft(identity: PlanReviewDraftIdentity, draft: string | null): PlanReviewDraftSnapshot {
    return this.#semantic.savePlanReviewDraft(identity, draft);
  }

  clearPlanReviewState(): void {
    this.#semantic.clearPlanReviewState();
    this.#semantic.touch();
  }

  finishQueueEntry(requestId: string, outcome: "removed" | "failed"): void {
    this.#semanticChange(() => this.#semantic.finishQueueEntry(requestId, outcome));
  }

  record(
    source: TaskEventSource,
    method: string,
    turnId: string | null,
    payload: unknown,
    protocolPayload?: unknown,
  ): TaskEventEnvelope {
    const before = this.#semantic.events.length;
    const event = this.#semantic.record(source, method, turnId, payload, protocolPayload);
    if (turnId && /^session\/prompt:(?:completed|failed|interrupted)$/.test(method)) {
      this.#transcript.closeTurn(turnId);
    }
    const events = this.#captureSemanticEvents(before);
    this.#publish(events);
    return events.at(-1)?.event || event;
  }

  touch(): void {
    this.#semantic.touch();
  }

  advanceConnectionEpoch(): void {
    this.#connectionEpoch += 1;
    this.#sequence = 0;
    this.#semantic.advanceConnectionEpoch();
  }

  #applyAcp(params: unknown, turnId: string | null, userEcho?: PromptEchoIdentity): TaskRuntimeNotificationResult {
    const record = asRecord(params);
    const update = asRecord(record.update);
    const updateType = string(update.sessionUpdate) || "unknown";
    const safePayload = safeSessionUpdate(update, readMeta(record));
    const replay = this.#transcript.isReplayUpdate(updateType, REPLAY_TURN_UPDATES);
    const effectiveTurn = replay
      ? this.#transcript.turnForReplay(updateType, this.#connectionEpoch, safePayload)
      : userEcho?.turnId || turnId || string(safePayload.turnId)
        || delayedExecutionId(this.#connectionEpoch, safePayload, this.#sequence + 1);
    if (this.#transcript.suppressesReplayUpdate(
      updateType,
      REPLAY_TURN_UPDATES,
      STATIC_TRANSCRIPT_UPDATES,
    )) return result();
    const structuredMedia = mediaForSessionUpdate(this.#media, this.snapshot.taskId, updateType, update);
    if (structuredMedia.length) safePayload.media = structuredMedia;
    const event = this.#transientEvent("acp", `session/update:${updateType}`, effectiveTurn, safePayload);
    const live = Boolean(turnId);

    if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") {
      this.#transcript.appendAgent(
        updateType === "agent_message_chunk" ? "assistant" : "thought",
        update,
        effectiveTurn,
        live,
        event,
        updateType === "agent_message_chunk" ? structuredMedia : [],
        userEcho?.turnId || turnId || effectiveTurn,
      );
      this.#semantic.touch();
      return result();
    }

    if (updateType === "user_message_chunk") {
      this.#transcript.closeSegment(effectiveTurn);
      this.#transcript.appendRemoteUser(
        update,
        effectiveTurn,
        live,
        event,
        userEcho,
        userEcho?.turnId || turnId || effectiveTurn,
      );
      const fingerprint = string(safePayload.promptFingerprint);
      const requestId = fingerprint ? this.#dispatchedFingerprints.get(fingerprint) : undefined;
      if (requestId && ["pending", "unknown"].includes(this.userMessageDelivery(requestId) || "")) {
        this.setUserMessageDelivery(requestId, "accepted");
      }
      this.#semantic.touch();
      return result({ acceptedRequestIds: userEcho ? [userEcho.requestId] : [] });
    }

    if (updateType === "tool_call" || updateType === "tool_call_update") {
      this.#transcript.closeSegment(effectiveTurn);
    }
    const before = this.#semantic.events.length;
    this.#semantic.applyAcpNotification(params, turnId, userEcho, effectiveTurn);
    const events = this.#captureSemanticEvents(before);
    if (structuredMedia.length) {
      this.#transcript.appendAgent(
        "assistant",
        {
          ...update,
          messageId: `tool-media:${string(update.toolCallId) || this.#sequence}`,
          content: {},
        },
        effectiveTurn,
        live && !["completed", "failed"].includes(string(update.status) || ""),
        event,
        structuredMedia,
        userEcho?.turnId || turnId || effectiveTurn,
      );
    }
    this.#publish(events);
    return result({ refreshContextWindow: updateType === "turn_completed" });
  }

  #applyChildAcp(params: unknown): TaskRuntimeNotificationResult {
    const value = asRecord(params);
    const sessionId = string(value.sessionId);
    const update = asRecord(value.update);
    const updateType = string(update.sessionUpdate) || "unknown";
    if (!sessionId) return result();
    const safePayload = safeSessionUpdate(update, readMeta(value));
    const turnId = string(readMeta(value).turnId) || string(readMeta(update).turnId) || `child:${sessionId}:turn`;
    const event = this.#transientEvent("acp", `child/session/update:${updateType}`, turnId, { sessionId, ...safePayload });
    const transcript = this.#childTranscript(sessionId);
    if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") {
      const media = mediaForSessionUpdate(this.#media, this.snapshot.taskId, updateType, update);
      transcript.appendAgent(
        updateType === "agent_message_chunk" ? "assistant" : "thought",
        update,
        turnId,
        true,
        event,
        updateType === "agent_message_chunk" ? media : [],
      );
      this.#semantic.touch();
    } else if (updateType === "user_message_chunk") {
      transcript.appendRemoteUser(update, turnId, true, event);
      const before = this.#semantic.events.length;
      this.#semantic.applyChildAcpNotification(params);
      this.#captureSemanticEvents(before);
    } else {
      const before = this.#semantic.events.length;
      this.#semantic.applyChildAcpNotification(params);
      this.#captureSemanticEvents(before);
    }
    this.#refreshContext();
    return result();
  }

  #applyXai(method: string, params: unknown, turnId: string | null): TaskRuntimeNotificationResult {
    const before = this.#semantic.events.length;
    const accepted = this.#semantic.applyXaiNotification(method, params, turnId);
    const events = this.#captureSemanticEvents(before);
    this.#publish(events);
    return result({ acceptedRequestIds: accepted });
  }

  #applyChildXai(method: string, params: unknown): TaskRuntimeNotificationResult {
    const sessionId = string(asRecord(params).sessionId);
    const before = this.#semantic.events.length;
    this.#semantic.applyChildXaiNotification(method, params);
    const events = this.#captureSemanticEvents(before);
    const type = string(asRecord(params).type);
    const settled = method === "x.ai/session_notification" && (type === "turn_completed" || type === "turn_failed");
    const transcript = sessionId ? this.#children.get(sessionId) : undefined;
    if (settled && transcript) {
      for (const message of transcript.messages) {
        if (message.streaming) message.streaming = false;
      }
    }
    this.#publish(events);
    return result();
  }

  #semanticChange(operation: () => void): void {
    const before = this.#semantic.events.length;
    operation();
    const events = this.#captureSemanticEvents(before);
    this.#publish(events);
  }

  #captureSemanticEvents(start: number): TaskStoredTimelineItem[] {
    const produced = this.#semantic.events.slice(start);
    const items: TaskStoredTimelineItem[] = [];
    for (const event of produced) {
      const updateKind = event.method
        .replace(/^child\//, "")
        .replace(/^session\/update:/, "");
      if (TEXT_UPDATES.has(updateKind) || event.method === "task/user_message") continue;
      const item = this.#upsertTimeline(event, true);
      if (item) items.push(item);
    }
    this.#refreshContext();
    return items;
  }

  #discardNewSemanticTextEvents(start: number): void {
    this.#captureSemanticEvents(start);
  }

  #refreshContext(): void {
    this.#context = this.#semantic.context();
  }

  #upsertTimeline(event: TaskEventEnvelope, remapCursor: boolean): TaskStoredTimelineItem | null {
    const scope = eventScope(event);
    if (scope.kind === "child" && !scope.id) return null;
    const itemId = scopedTimelineId(scope, timelineIdentity(event));
    const target = scope.kind === "parent"
      ? this.#timeline
      : this.#childTimelineFor(scope.id);
    const existing = target.get(itemId);
    const ordinal = existing?.ordinal ?? this.#nextTimelineOrdinal(scope);
    const cursor = remapCursor ? this.#nextCursor() : {
      connectionEpoch: event.connectionEpoch,
      sequence: event.sequence,
    };
    const projected: TaskEventEnvelope = {
      ...structuredClone(event),
      eventId: itemId,
      connectionEpoch: cursor.connectionEpoch,
      sequence: cursor.sequence,
      occurredAt: eventOccurredAt(event.payload, event.occurredAt),
    };
    const item: TaskStoredTimelineItem = {
      itemId,
      itemKind: timelineKind(event),
      scope,
      ordinal,
      event: projected,
    };
    target.set(itemId, item);
    return item;
  }

  #publish(events: readonly TaskStoredTimelineItem[]): void {
    const notifications = taskNotificationsFromEvents(events
      .filter((entry) => entry.scope.kind === "parent")
      .map((entry) => entry.event));
    for (const notification of notifications) {
      this.#notify?.(this.snapshot.taskId, notification);
    }
  }

  #transientEvent(source: TaskEventSource, method: string, turnId: string | null, payload: unknown): TaskEventEnvelope {
    const cursor = this.#nextCursor();
    return {
      eventId: `runtime:${this.snapshot.taskId}:${cursor.connectionEpoch}:${cursor.sequence}`,
      taskId: this.snapshot.taskId,
      turnId,
      connectionEpoch: cursor.connectionEpoch,
      sequence: cursor.sequence,
      source,
      method,
      occurredAt: eventOccurredAt(payload, new Date().toISOString()),
      payload,
    };
  }

  #nextCursor(): { connectionEpoch: number; sequence: number } {
    return { connectionEpoch: this.#connectionEpoch, sequence: ++this.#sequence };
  }

  #childTranscript(sessionId: string): TaskRuntimeTranscript {
    let transcript = this.#children.get(sessionId);
    if (!transcript) {
      const restored = this.#readChild?.(sessionId);
      transcript = new TaskRuntimeTranscript(
        this.snapshot,
        new TaskCommandProjection(),
        this.#media,
        structuredClone(restored?.messages || []),
      );
      this.#children.set(sessionId, transcript);
      for (const event of restored?.events || []) this.#upsertTimeline(event, false);
    }
    return transcript;
  }

  #childTimelineFor(sessionId: string): Map<string, TaskStoredTimelineItem> {
    let timeline = this.#childTimeline.get(sessionId);
    if (!timeline) {
      timeline = new Map();
      this.#childTimeline.set(sessionId, timeline);
    }
    return timeline;
  }

  #nextTimelineOrdinal(scope: TaskStoreScope): number {
    const key = `${scope.kind}:${scope.id}`;
    const next = (this.#timelineOrdinals.get(key) || 0) + 1;
    this.#timelineOrdinals.set(key, next);
    return next;
  }
}

function result(overrides: Partial<TaskRuntimeNotificationResult> = {}): TaskRuntimeNotificationResult {
  return {
    acceptedRequestIds: [],
    refreshContextWindow: false,
    ...overrides,
  };
}

function eventOccurredAt(payload: unknown, fallback: string): string {
  const timestamp = asRecord(payload).agentTimestampMs;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) return fallback;
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

function delayedExecutionId(connectionEpoch: number, payload: Record<string, unknown>, sequence: number): string {
  const promptId = string(payload.promptId);
  const turnStartMs = payload.turnStartMs;
  return promptId && typeof turnStartMs === "number" && Number.isSafeInteger(turnStartMs)
    ? `native:${connectionEpoch}:${promptId}:${turnStartMs}`
    : `turn_${sequence}`;
}

function emptyContext(): TaskOperationalContextSnapshot {
  return { currentTodo: null, activeWork: [], history: [] };
}

function eventScope(event: TaskEventEnvelope): TaskStoreScope {
  if (!event.method.startsWith("child/")) return { kind: "parent", id: "parent" };
  return { kind: "child", id: string(asRecord(event.payload).sessionId) || event.turnId?.replace(/^child:/, "").replace(/:turn$/, "") || "unknown" };
}

function timelineIdentity(event: TaskEventEnvelope): string {
  const payload = asRecord(event.payload);
  const toolCallId = string(payload.toolCallId);
  if ((event.method.includes("tool_call") || event.method.includes("tool-call")) && toolCallId) {
    return `tool:${toolCallId}:${event.connectionEpoch}:${event.sequence}`;
  }
  const gateId = string(payload.gateId);
  if (event.method.startsWith("gate/") && gateId) {
    return /^gate\/(?:question|permission|planReview)$/.test(event.method)
      ? `gate:${gateId}:opened`
      : `gate:${gateId}:${event.method.split("/").at(-1)}`;
  }
  if (event.method === "task/goal:structured") {
    return `goal:${string(payload.goalId) || event.turnId || "unknown"}:${event.connectionEpoch}:${event.sequence}`;
  }
  if (event.method.endsWith("x.ai/queue/changed") || event.method === "x.ai/queue/changed") return "queue:state";
  if (event.method.endsWith("x.ai/session_notification") || event.method === "x.ai/session_notification") {
    return `session:${string(payload.type) || "event"}:${string(payload.promptId) || event.turnId || event.sequence}`;
  }
  const activityId = string(payload.childSessionId) || string(payload.subagentId) || string(payload.taskId);
  if (activityId && /subagent|task_backgrounded|task_completed|monitor|scheduled/.test(event.method)) {
    return `activity:${activityId}:${string(payload.sessionUpdate) || event.method}`;
  }
  const requestId = string(payload.requestId);
  if (requestId && event.method.startsWith("queue/")) return `queue:${requestId}:${event.method}`;
  return `event:${event.method}:${event.connectionEpoch}:${event.sequence}`;
}

function timelineKind(event: TaskEventEnvelope): string {
  if (event.method.includes("tool_call")) return "tool";
  if (event.method.startsWith("gate/")) return "gate";
  if (event.method.includes("goal")) return "goal";
  if (event.method.includes("queue")) return "queue";
  if (event.method.includes("session_notification") || event.method.startsWith("session/prompt:")) return "settlement";
  return "semantic";
}

function scopedTimelineId(scope: TaskStoreScope, identity: string): string {
  return `${scope.kind}:${scope.id}:${identity}`;
}

function byOrdinal(left: TaskStoredTimelineItem, right: TaskStoredTimelineItem): number {
  return left.ordinal - right.ordinal;
}
