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
  TaskProjectionFrame,
  TaskProjectionMessagePatch,
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
import { asRecord, normalizeOfficialSessionUpdate, readMeta, string } from "./taskEventSanitizers.js";
import { mediaForSessionUpdate, type ProjectionMediaContext } from "./taskMediaProjection.js";
import { isSessionTextUpdate } from "./taskTextUpdates.js";

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

export type TaskRuntimeNotification =
  | { kind: "acp"; params: unknown; turnId: string | null; userEcho?: PromptEchoIdentity }
  | { kind: "child-acp"; params: unknown }
  | { kind: "xai"; method: string; params: unknown; turnId: string | null }
  | { kind: "child-xai"; method: string; params: unknown };

export interface TaskRuntimeNotificationResult {
  acceptedRequestIds: string[];
  refreshContextWindow: boolean;
  projectionChange: TaskProjectionChange;
  projectionChanged: boolean;
}

export type TaskProjectionChange = "delta" | "text";

type ChangedMessageIdentity = {
  turnId: string;
  blockId: string;
  append: {
    previousTextLength: number;
    text: string;
  } | null;
};

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
  readonly #timeline = new Map<string, TaskStoredTimelineItem>();
  readonly #timelineIndices = new Map<string, number>();
  readonly #timelineOrdinals = new Map<string, number>();
  readonly #changedMessages = new Map<string, ChangedMessageIdentity>();
  readonly #changedTimelineIds = new Set<string>();
  readonly #officialEventIds = new Set<string>();
  readonly #media?: ProjectionMediaContext;
  readonly #readChild?: TaskRuntimeProjectionOptions["readChild"];
  readonly #notify?: TaskRuntimeProjectionOptions["notify"];
  readonly #dispatchedFingerprints = new Map<string, string>();
  #context: TaskOperationalContextSnapshot;
  #contextChanged = false;
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
    this.#clearFrameChanges();
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

  frame(change?: TaskProjectionChange): TaskProjectionFrame {
    if (change === "delta" || change === "text") {
      const messages: TaskProjectionMessagePatch[] = [...this.#changedMessages.values()].flatMap(
        (identity): TaskProjectionMessagePatch[] => {
          const index = this.messages.findIndex((message) =>
            message.turnId === identity.turnId && message.blockId === identity.blockId);
          if (index < 0) return [];
          const message = this.messages[index];
          if (
            identity.append
            && message.text.length === identity.append.previousTextLength + identity.append.text.length
          ) {
            const { text: _text, ...metadata } = message;
            return [{
              index,
              kind: "append" as const,
              previousTextLength: identity.append.previousTextLength,
              appendText: identity.append.text,
              message: structuredClone(metadata),
            }];
          }
          return [{
            index,
            kind: "replace" as const,
            message: structuredClone(message),
          }];
        },
      ).sort((left, right) => left.index - right.index);
      const events = [...this.#changedTimelineIds].flatMap((itemId) => {
        const index = this.#timelineIndices.get(itemId);
        const item = this.#timeline.get(itemId);
        return index === undefined || !item
          ? []
          : [{ index, event: structuredClone(item.event) }];
      }).sort((left, right) => left.index - right.index);
      const rows = {
        messageCount: this.messages.length,
        messages,
        eventCount: this.#timeline.size,
        events,
      };
      const frame: TaskProjectionFrame = change === "text" && !this.#contextChanged
        ? {
            kind: "text-delta",
            snapshot: {
              taskId: this.snapshot.taskId,
              projectionEpoch: this.snapshot.projectionEpoch,
              revision: this.snapshot.revision,
              updatedAt: this.snapshot.updatedAt,
            },
            ...rows,
          }
        : {
            kind: "delta",
            snapshot: structuredClone(this.snapshot),
            ...(this.#contextChanged ? { context: structuredClone(this.#context) } : {}),
            ...rows,
          };
      this.#clearFrameChanges();
      return frame;
    }
    const frame: TaskProjectionFrame = { kind: "snapshot", detail: this.detail() };
    this.#clearFrameChanges();
    return frame;
  }

  childDetail(sessionId: string): ChildSessionDetail {
    const detail = this.#readChild?.(sessionId) || null;
    const work = [...this.#context.activeWork, ...this.#context.history.flatMap((entry) => entry.kind === "work" ? [entry.work] : [])]
      .find((entry) => entry.childSessionId === sessionId || entry.id === sessionId);
    return {
      sessionId,
      status: work?.status || "unconfirmed",
      transcriptAvailable: Boolean(detail),
      detail,
      reason: detail ? null : "No structured child transcript is available yet.",
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
    this.#markMessage({ turnId, blockId: `user:${requestId}` });
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
    this.#markMessage(message);
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
    const originalUpdate = asRecord(record.update);
    // Live ACP packets are already the authoritative Session stream. In
    // particular, completed Web Search packets carry action.query themselves;
    // consulting on-disk history here would synchronously rescan every Session
    // on the hottest notification path.
    const normalized = normalizeOfficialSessionUpdate(
      originalUpdate,
      readMeta(record),
    );
    const { update, updateType, payload: safePayload } = normalized;
    const enrichedParams = update === originalUpdate ? params : { ...record, update };
    const replay = this.#transcript.isReplayUpdate(updateType, REPLAY_TURN_UPDATES);
    const effectiveTurn = replay
      ? this.#transcript.turnForReplay(updateType, this.#connectionEpoch, safePayload)
      : userEcho?.turnId || turnId || string(safePayload.turnId)
        || delayedExecutionId(this.#connectionEpoch, safePayload, this.#sequence + 1);
    if (this.#transcript.suppressesReplayUpdate(
      updateType,
      REPLAY_TURN_UPDATES,
      STATIC_TRANSCRIPT_UPDATES,
    )) return result({ projectionChanged: false });
    const structuredMedia = mediaForSessionUpdate(this.#media, this.snapshot.taskId, updateType, update);
    if (structuredMedia.length) safePayload.media = structuredMedia;
    const event = this.#transientEvent("acp", `session/update:${updateType}`, effectiveTurn, safePayload);
    const live = Boolean(turnId);

    if (updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") {
      const append = this.#transcript.appendAgent(
        updateType === "agent_message_chunk" ? "assistant" : "thought",
        update,
        effectiveTurn,
        live,
        event,
        updateType === "agent_message_chunk" ? structuredMedia : [],
        userEcho?.turnId || turnId || effectiveTurn,
      );
      this.#markMessage(append);
      this.#semantic.touch();
      return result({ projectionChange: "text" });
    }

    if (updateType === "user_message_chunk") {
      this.#transcript.closeSegment(effectiveTurn);
      const append = this.#transcript.appendRemoteUser(
        update,
        effectiveTurn,
        live,
        event,
        userEcho,
        userEcho?.turnId || turnId || effectiveTurn,
      );
      this.#markMessage(append);
      const fingerprint = string(safePayload.promptFingerprint);
      const requestId = fingerprint ? this.#dispatchedFingerprints.get(fingerprint) : undefined;
      if (requestId && ["pending", "unknown"].includes(this.userMessageDelivery(requestId) || "")) {
        this.setUserMessageDelivery(requestId, "accepted");
      }
      this.#semantic.touch();
      return result({
        acceptedRequestIds: userEcho ? [userEcho.requestId] : [],
        projectionChange: "text",
      });
    }

    if (updateType === "tool_call" || updateType === "tool_call_update") {
      this.#transcript.closeSegment(effectiveTurn);
    }
    const before = this.#semantic.events.length;
    const semanticChanged = this.#semantic.applyNormalizedAcpNotification(
      enrichedParams,
      update,
      updateType,
      safePayload,
      turnId,
      userEcho,
    );
    if (!semanticChanged) return result({ projectionChanged: false });
    const events = this.#captureSemanticEvents(before);
    const acceptedRequestIds = updateType === "goal_updated"
      && events.some(({ event }) => event.method === "task/goal:structured")
      && this.snapshot.commands.execution?.name === "goal"
      && this.snapshot.commands.execution.state === "pending"
      ? [this.snapshot.commands.execution.requestId]
      : [];
    if (structuredMedia.length) {
      const append = this.#transcript.appendAgent(
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
      this.#markMessage(append);
    }
    this.#publish(events);
    return result({
      acceptedRequestIds,
      refreshContextWindow: updateType === "turn_completed",
    });
  }

  #applyChildAcp(params: unknown): TaskRuntimeNotificationResult {
    const before = this.#semantic.events.length;
    this.#semantic.applyChildAcpNotification(params);
    this.#captureSemanticEvents(before);
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
    const before = this.#semantic.events.length;
    this.#semantic.applyChildXaiNotification(method, params);
    const events = this.#captureSemanticEvents(before);
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
      if (isSessionTextUpdate(updateKind) || event.method === "task/user_message") continue;
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
    const next = this.#semantic.context();
    if (next === this.#context) return;
    this.#context = next;
    this.#contextChanged = true;
  }

  #upsertTimeline(event: TaskEventEnvelope, remapCursor: boolean): TaskStoredTimelineItem | null {
    const scope = eventScope(event);
    if (scope.kind === "child") return null;
    const itemId = scopedTimelineId(scope, timelineIdentity(event));
    const target = this.#timeline;
    const existing = target.get(itemId);
    const ordinal = existing?.ordinal ?? this.#nextTimelineOrdinal(scope);
    if (!existing) this.#timelineIndices.set(itemId, target.size);
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
    this.#changedTimelineIds.add(itemId);
    return item;
  }

  #markMessage(identity: {
    turnId: string;
    blockId: string;
    created?: boolean;
    appendedText?: string;
  } | null | undefined): void {
    if (!identity) return;
    const key = `${identity.turnId}\u0000${identity.blockId}`;
    const current = this.#changedMessages.get(key);
    const appendOnly = identity.created === false && identity.appendedText !== undefined;
    if (!appendOnly || current?.append === null) {
      this.#changedMessages.set(key, {
        turnId: identity.turnId,
        blockId: identity.blockId,
        append: null,
      });
      return;
    }
    if (current?.append) {
      current.append.text += identity.appendedText!;
      return;
    }
    const message = this.messages.find((candidate) =>
      candidate.turnId === identity.turnId && candidate.blockId === identity.blockId);
    const previousTextLength = message
      ? message.text.length - identity.appendedText!.length
      : -1;
    this.#changedMessages.set(key, {
      turnId: identity.turnId,
      blockId: identity.blockId,
      append: previousTextLength >= 0
        ? { previousTextLength, text: identity.appendedText! }
        : null,
    });
  }

  #clearFrameChanges(): void {
    this.#changedMessages.clear();
    this.#changedTimelineIds.clear();
    this.#contextChanged = false;
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
    projectionChange: "delta",
    projectionChanged: true,
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
