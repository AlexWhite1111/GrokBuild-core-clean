import { randomUUID } from "node:crypto";
import {
  projectTaskWorkState,
  ReasoningEffortSchema,
  type PendingGate,
  type PlanReviewDraftIdentity,
  type PlanReviewDraftSnapshot,
  type PlanReviewPendingGate,
  type TaskEventEnvelope,
  type TaskEventSource,
  type TaskMessageBlock,
  type TaskOperationalContextSnapshot,
  type TaskSnapshot,
} from "../../shared/contracts.js";
import { isSessionLifecycleEvent } from "../../shared/sessionLifecycle.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import {
  asRecord,
  readMeta,
  safeSessionUpdate,
  sanitizeXai,
  string,
} from "./taskEventSanitizers.js";
import { applyTaskConfigOptions } from "./taskConfigOptions.js";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { PromptEchoIdentity } from "./PromptEchoQueue.js";
import { reconcileNativeQueue } from "./reconcileNativeQueue.js";
import { applyAvailableCommands } from "./taskProtocolRegistry.js";
import {
  mediaForSessionUpdate,
  type ProjectionMediaContext,
} from "./taskMediaProjection.js";
import { TaskCommandProjection } from "./TaskCommandProjection.js";
import { applyGoalSessionUpdate } from "./taskGoalProjection.js";
import type { SessionRosterState } from "../acp/sessionRosterContracts.js";
import {
  applyVerifiedPermissionState,
  basePermissionMode,
} from "./taskPermissionState.js";
import { promptFingerprint } from "./taskDelivery.js";
import { AppProblem } from "../security/problemResponse.js";
import {
  PlanReviewState,
  planContentHash,
  planGateIdentity,
} from "./PlanReviewState.js";
import {
  hasNativeTurnSignal,
  nativeTurnSignal,
  TaskTurnIdentity,
} from "./TaskTurnIdentity.js";
import { TaskOperationalContextReducer } from "./TaskOperationalContextReducer.js";
const FALLBACK_MESSAGE_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
]);

interface ToolTurnIdentity {
  turnId: string;
  localTurnId?: string;
}

export class TaskSemanticProjection {
  readonly events: TaskEventEnvelope[] = [];
  #sequence = 0;
  #connectionEpoch = 1;
  readonly #nativeQueueRequestIds = new Map<string, string>();
  readonly #commands = new TaskCommandProjection();
  readonly #turnIdentity = new TaskTurnIdentity();
  readonly #contextReducer = new TaskOperationalContextReducer();
  readonly #turnByToolCall = new Map<string, ToolTurnIdentity>();
  readonly #permissionBase: ReturnType<typeof basePermissionMode>;
  readonly #planReview: PlanReviewState;

  constructor(
    readonly snapshot: TaskSnapshot,
    state: JsonStateStore,
    private readonly media?: ProjectionMediaContext,
  ) {
    this.#permissionBase = snapshot.permission.base || basePermissionMode(snapshot.permission.requested);
    this.snapshot.permission.base = this.#permissionBase;
    this.snapshot.goal ||= {
      status: "unknown",
      lastOutcome: null,
      objective: null,
      timeUsedSeconds: 0,
      source: "none",
      updatedAt: null,
      telemetry: null,
    };
    this.snapshot.goal.lastOutcome ??= null;
    this.snapshot.goal.timeUsedSeconds ??= 0;
    this.snapshot.goal.source ||= "none";
    this.snapshot.goal.telemetry ??= null;
    this.snapshot.contextWindow ??= null;
    this.snapshot.activities.unconfirmed ??= 0;
    this.snapshot.plan = {
      document: this.snapshot.plan?.document || null,
    };
    this.#planReview = new PlanReviewState(state);
  }

  context(): TaskOperationalContextSnapshot {
    return this.#contextReducer.snapshot();
  }

  turnForPrompt(promptId: string | undefined): string | null {
    return this.#turnIdentity.latestForPrompt(promptId);
  }

  restore(events: readonly TaskEventEnvelope[]): void {
    const restored = structuredClone(events);
    this.events.splice(0, this.events.length, ...restored);
    this.#connectionEpoch = Math.max(1, ...restored.map((event) => event.connectionEpoch));
    this.#sequence = Math.max(
      0,
      ...restored
        .filter((event) => event.connectionEpoch === this.#connectionEpoch)
        .map((event) => event.sequence),
    );
    this.#contextReducer.restore(restored);
    this.#syncActivities();
    this.#turnByToolCall.clear();
    for (const event of restored) {
      const payload = asRecord(event.payload);
      const toolCallId = string(payload.toolCallId);
      if (toolCallId && event.turnId && event.method.includes("tool_call")) {
        this.#turnByToolCall.set(toolCallId, {
          turnId: event.turnId,
          ...(string(payload.localTurnId) ? { localTurnId: string(payload.localTurnId) } : {}),
        });
      }
    }
  }

  beginSessionReplay(): void {}

  endSessionReplay(): void {}

  addLocalUserMessage(
    text: string,
    turnId: string,
    requestId: string,
    paths: TaskMessageBlock["paths"] = [],
    composerDocument?: TaskMessageBlock["composerDocument"],
    interjection = false,
  ): void {
    if (interjection) this.#turnIdentity.markInterjection(turnId);
    else this.#turnIdentity.ensureBase(turnId);
    this.record("supervisor", "task/user_message", turnId, {
      blockId: `user:${requestId}`,
      requestId,
      text,
      paths,
      composerDocument,
      ...(interjection ? { interjection: true } : {}),
    });
  }
  setUserMessageDelivery(
    requestId: string,
    delivery: NonNullable<TaskMessageBlock["delivery"]>,
    turnId: string | null = null,
  ): void {
    this.record("supervisor", "task/user_message_delivery", turnId, {
      requestId,
      delivery,
    });
    this.touch();
  }

  markUserMessageDispatched(
    requestId: string,
    turnId: string,
    transportText: string,
  ): void {
    this.record("supervisor", "task/user_message_dispatched", turnId, {
      requestId,
      promptFingerprint: promptFingerprint(transportText),
    });
    this.touch();
  }
  applyAcpNotification(
    params: unknown,
    turnId: string | null,
    userEcho?: PromptEchoIdentity,
    effectiveTurnOverride?: string | null,
  ): void {
    this.#applyAcpNotification(params, turnId, userEcho, effectiveTurnOverride);
  }

  #applyAcpNotification(
    params: unknown,
    turnId: string | null,
    userEcho?: PromptEchoIdentity,
    effectiveTurnOverride?: string | null,
  ): void {
    const record = asRecord(params);
    const update = asRecord(record.update);
    const transportMeta = readMeta(record);
    const updateType = string(update.sessionUpdate) || "unknown";
    const safePayload = safeSessionUpdate(update, transportMeta);
    const replay = effectiveTurnOverride?.startsWith("replay:") === true;
    const signal = nativeTurnSignal(safePayload);
    const metaTurn = string(safePayload.turnId);
    const commandTurn = userEcho?.turnId || turnId;
    const toolCallId = updateType === "tool_call" || updateType === "tool_call_update"
      ? string(safePayload.toolCallId)
      : undefined;
    const knownToolTurn = toolCallId ? this.#turnByToolCall.get(toolCallId) : undefined;
    const toolTurn = updateType === "tool_call_update"
      ? knownToolTurn
      : updateType === "tool_call" && !commandTurn && !metaTurn && !hasNativeTurnSignal(signal)
        ? knownToolTurn
        : undefined;
    const detached =
      !userEcho?.turnId &&
      !turnId &&
      !metaTurn &&
      !hasNativeTurnSignal(signal) &&
      !replay &&
      !toolTurn &&
      !FALLBACK_MESSAGE_UPDATES.has(updateType);
    const resolution = replay || toolTurn || effectiveTurnOverride !== undefined
      ? null
      : this.#turnIdentity.resolve(
          this.#connectionEpoch,
          signal,
          commandTurn || null,
        );
    const effectiveTurn = effectiveTurnOverride !== undefined
      ? effectiveTurnOverride
      : detached
      ? null
      : toolTurn?.turnId || resolution?.turnId || commandTurn || metaTurn
          || (FALLBACK_MESSAGE_UPDATES.has(updateType) ? `turn_${this.#sequence + 1}` : null);
    const localTurnId = toolTurn?.localTurnId || commandTurn;
    if (localTurnId) safePayload.localTurnId = localTurnId;
    if (replay) safePayload.replay = true;
    const structuredMedia = mediaForSessionUpdate(
      this.media,
      this.snapshot.taskId,
      updateType,
      update,
    );
    if (structuredMedia.length) safePayload.media = structuredMedia;
    this.record(
      "acp",
      `session/update:${updateType}`,
      effectiveTurn,
      safePayload,
      params,
    );
    if (toolCallId && effectiveTurn && (!toolTurn || updateType === "tool_call")) {
      this.#turnByToolCall.set(toolCallId, {
        turnId: effectiveTurn,
        ...(localTurnId ? { localTurnId } : {}),
      });
    }
    switch (updateType) {
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "user_message_chunk":
        // Transcript bytes are owned exclusively by TaskRuntimeTranscript.
        break;
      case "plan":
      case "plan_update":
      case "plan_removed":
        // ACP plan updates are Todo snapshots, not Plan Mode lifecycle state.
        break;
      case "current_mode_update": {
        const mode = string(update.currentModeId) || string(update.modeId);
        if (mode === "normal" || mode === "plan") this.snapshot.workMode = mode;
        break;
      }
      case "goal_updated": {
        const previous = {
          status: this.snapshot.goal.status,
          lastOutcome: this.snapshot.goal.lastOutcome,
          objective: this.snapshot.goal.objective,
        };
        const goalUpdate = asRecord(safePayload.goal);
        const applied = applyGoalSessionUpdate(this.snapshot.goal, goalUpdate);
        if (applied && typeof goalUpdate.status === "string" && this.snapshot.error?.code.startsWith("GOAL_"))
          this.snapshot.error = null;
        if (applied && (previous.status !== this.snapshot.goal.status || previous.lastOutcome !== this.snapshot.goal.lastOutcome || previous.objective !== this.snapshot.goal.objective)) {
          this.record("acp", "task/goal:structured", effectiveTurn, {
            goalId: this.snapshot.goal.telemetry?.goalId || null,
            status: this.snapshot.goal.status,
            lastOutcome: this.snapshot.goal.lastOutcome,
            objective: this.snapshot.goal.objective,
            timeUsedSeconds: this.snapshot.goal.timeUsedSeconds,
          });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update":
        break;
      case "config_option_update":
        applyTaskConfigOptions(
          this.snapshot,
          Array.isArray(update.configOptions)
            ? (update.configOptions as SessionConfigOption[])
            : [],
        );
        break;
      case "available_commands_update":
        applyAvailableCommands(this.snapshot, update.availableCommands);
        break;
      case "session_info_update":
      case "usage_update":
      case "task_backgrounded":
      case "task_completed":
      case "monitor_event":
      case "scheduled_task_created":
      case "scheduled_task_fired":
      case "scheduled_task_deleted":
      case "subagent_spawned":
      case "subagent_progress":
      case "subagent_finished":
        break;
      default:
        break;
    }
    this.touch();
  }

  applyChildAcpNotification(params: unknown): void {
    this.#persistAtomically(() => this.#applyChildAcpNotification(params));
  }

  #applyChildAcpNotification(params: unknown): void {
    const value = asRecord(params);
    const sessionId = string(value.sessionId);
    const update = asRecord(value.update);
    const updateType = string(update.sessionUpdate) || "unknown";
    const transportMeta = readMeta(value);
    const turnId =
      string(transportMeta.turnId) || string(readMeta(update).turnId) ||
      (sessionId ? `child:${sessionId}:turn` : null);
    const safePayload = safeSessionUpdate(update, transportMeta);
    const structuredMedia = mediaForSessionUpdate(
      this.media,
      this.snapshot.taskId,
      updateType,
      update,
    );
    if (structuredMedia.length) safePayload.media = structuredMedia;
    const childPayload = {
      sessionId,
      ...safePayload,
    };
    this.#recordChild("acp", `child/session/update:${updateType}`, turnId, childPayload, params);
    this.touch();
  }

  applyChildXaiNotification(method: string, params: unknown): void {
    this.#persistAtomically(() => this.#applyChildXaiNotification(method, params));
  }

  #applyChildXaiNotification(method: string, params: unknown): void {
    const payload = sanitizeXai(method, params);
    const sessionId = string(asRecord(payload).sessionId);
    this.#recordChild(
      "xai",
      `child/${method}`,
      sessionId ? `child:${sessionId}:turn` : null,
      payload,
      params,
    );
    this.touch();
  }

  beginCommand(
    turnId: string,
    requestId: string,
    name: string,
    input = "",
    showOutput = false,
  ): void {
    this.#turnIdentity.ensureBase(turnId);
    this.#commands.begin(
      this.snapshot,
      turnId,
      requestId,
      name,
      input,
      showOutput,
    );
    this.record("supervisor", "task/command:pending", turnId, {
      requestId,
      name,
    });
    this.touch();
  }

  finishCommand(
    turnId: string,
    requestId: string,
    name: string,
    error?: string,
  ): void {
    const outcome = this.#commands.finish(
      this.snapshot,
      turnId,
      requestId,
      name,
      error,
    );
    this.record("acp", `task/command:${outcome.state}`, turnId, {
      requestId,
      name,
      ...(outcome.message ? { message: outcome.message } : {}),
    });
    this.touch();
  }

  applySessionRosterReceipt(
    state: SessionRosterState,
    source: "x.ai/sessions/list" | "x.ai/sessions/changed",
    turnId: string | null = null,
  ): TaskSnapshot["permission"]["effective"] {
    if (!this.snapshot.sessionId || state.sessionId !== this.snapshot.sessionId) {
      throw new Error("Session-roster receipt does not belong to this task session.");
    }
    if (Object.hasOwn(state, "modelId")) {
      this.snapshot.modelId = state.modelId ?? null;
    }
    if (Object.hasOwn(state, "reasoningEffort")) {
      if (state.reasoningEffort == null) this.snapshot.effort = null;
      else {
        const effort = ReasoningEffortSchema.safeParse(state.reasoningEffort);
        if (effort.success) this.snapshot.effort = effort.data;
      }
    }
    let effective = this.snapshot.permission.effective;
    if (typeof state.yolo === "boolean") {
      effective = applyVerifiedPermissionState(
        this.snapshot,
        { ...state, yolo: state.yolo },
        this.#permissionBase,
      );
      if (this.snapshot.error?.code.startsWith("PERMISSION_")) {
        this.snapshot.error = null;
      }
    }
    this.record("xai", "task/session-roster:verified", turnId, {
      source,
      sessionId: state.sessionId,
      ...(typeof state.yolo === "boolean" ? { yolo: state.yolo } : {}),
      ...(Object.hasOwn(state, "autoMode") ? { autoMode: state.autoMode } : {}),
      ...(Object.hasOwn(state, "modelId") ? { modelId: state.modelId } : {}),
      ...(Object.hasOwn(state, "reasoningEffort") ? { reasoningEffort: state.reasoningEffort } : {}),
      effective,
    });
    this.touch();
    return effective;
  }

  applyXaiNotification(
    method: string,
    params: unknown,
    turnId: string | null,
  ): string[] {
    return this.#persistAtomically(() => this.#applyXaiNotification(method, params, turnId));
  }

  #applyXaiNotification(
    method: string,
    params: unknown,
    turnId: string | null,
  ): string[] {
    const payload = sanitizeXai(method, params);
    const payloadRecord = asRecord(payload);
    const type = string(payloadRecord.type);
    const promptTurn = this.#turnIdentity.latestForPrompt(string(payloadRecord.promptId));
    const familyTurn = this.#turnIdentity.latestForBase(turnId);
    const sessionLifecycle = method === "x.ai/session_notification"
      && isSessionLifecycleEvent(method, payload);
    const presentationTurn = method === "x.ai/session_notification"
      ? sessionLifecycle
        ? promptTurn || null
        : promptTurn || familyTurn || this.#turnIdentity.latest() || turnId
      : turnId;
    this.record("xai", method, presentationTurn, payload, params);
    const ownSession =
      string(asRecord(payload).sessionId) === this.snapshot.sessionId;
    const completedPromptId = string(payloadRecord.promptId);
    if (
      ownSession
      && completedPromptId
      && this.snapshot.queue.runningEntryId === completedPromptId
      && (
        method === "x.ai/session/prompt_complete"
        || (method === "x.ai/session_notification" && (type === "turn_completed" || type === "turn_failed"))
      )
    ) {
      this.snapshot.queue.runningEntryId = null;
    }
    if (method === "x.ai/session_notification" && ownSession && (type === "model_changed" || type === "model_auto_switched")) {
      const modelId = string(payloadRecord.model);
      if (modelId && /^[A-Za-z0-9._:/-]{1,256}$/.test(modelId)) this.snapshot.modelId = modelId;
    }
    const accepted =
      method === "x.ai/queue/changed" && ownSession
          ? reconcileNativeQueue(
            this.snapshot,
            params,
            this.#nativeQueueRequestIds,
          )
        : [];
    if (method === "x.ai/sessions/changed") {
      const upserted = asRecord(payload).upserted;
      const own = Array.isArray(upserted)
        ? upserted.map(asRecord).find(
          (entry) => string(entry.sessionId) === this.snapshot.sessionId,
        )
        : undefined;
      if (own) {
        this.applySessionRosterReceipt({
          sessionId: string(own.sessionId)!,
          ...(typeof own.yolo === "boolean" ? { yolo: own.yolo } : {}),
          ...(Object.hasOwn(own, "autoMode") ? { autoMode: typeof own.autoMode === "boolean" ? own.autoMode : null } : {}),
          ...(Object.hasOwn(own, "modelId") ? { modelId: typeof own.modelId === "string" ? own.modelId : null } : {}),
          ...(Object.hasOwn(own, "reasoningEffort") ? { reasoningEffort: typeof own.reasoningEffort === "string" ? own.reasoningEffort : null } : {}),
        }, "x.ai/sessions/changed", turnId);
      }
    }
    this.touch();
    return accepted;
  }

  addGate(gate: PendingGate, protocolPayload?: unknown): void {
    this.snapshot.gates.push(gate);
    if (gate.kind === "planReview") {
      const payload = asRecord(gate.payload);
      const identity = planGateIdentity(gate);
      const previous = this.snapshot.plan.document;
      if (previous && planContentHash(previous.content) !== identity.baseHash) {
        this.#planReview.clearTask(this.snapshot.taskId);
      }
      this.snapshot.plan.document = {
        content: string(payload.content) || "",
        fileName: string(payload.fileName) || "plan.md",
        updatedAt: gate.receivedAt,
      };
    }
    this.record("acp", `gate/${gate.kind}`, gate.turnId, {
      gateId: gate.gateId,
      kind: gate.kind,
      title: gate.title,
      risk: gate.risk,
    }, protocolPayload);
    this.touch();
  }

  removeGate(
    gateId: string,
    outcome: "resolved" | "aborted" | "cancelled" = "resolved",
  ): PendingGate | undefined {
    const index = this.snapshot.gates.findIndex(
      (gate) => gate.gateId === gateId,
    );
    if (index < 0) return undefined;
    const [gate] = this.snapshot.gates.splice(index, 1);
    if (gate.kind === "planReview" && outcome === "resolved") {
      this.#planReview.clearTask(this.snapshot.taskId);
    }
    this.record("supervisor", `gate/${gate.kind}/${outcome}`, gate.turnId, {
      gateId,
    });
    this.snapshot.gates.forEach((entry, index) => {
      entry.position = index + 1;
      entry.total = this.snapshot.gates.length;
    });
    this.touch();
    return gate;
  }

  clearGates(
    reason: "cancelled" | "disconnected" | "stopped",
    sessionScope?: "parent" | "child",
  ): PendingGate[] {
    const gates = this.snapshot.gates.filter((gate) =>
      !sessionScope || gateSessionScope(gate) === sessionScope);
    if (gates.length) {
      const removed = new Set(gates.map((gate) => gate.gateId));
      this.snapshot.gates = this.snapshot.gates.filter((gate) => !removed.has(gate.gateId));
    }
    for (const gate of gates) {
      this.record("supervisor", `gate/${gate.kind}/${reason}`, gate.turnId, {
        gateId: gate.gateId,
      });
    }
    this.snapshot.gates.forEach((gate, index) => {
      gate.position = index + 1;
      gate.total = this.snapshot.gates.length;
    });
    if (gates.length) this.touch();
    return gates;
  }

  planReviewDraft(identity: PlanReviewDraftIdentity): PlanReviewDraftSnapshot {
    this.#assertPlanIdentity(identity);
    return this.#planReview.read(this.snapshot.taskId, identity);
  }

  savePlanReviewDraft(
    identity: PlanReviewDraftIdentity,
    draft: string | null,
  ): PlanReviewDraftSnapshot {
    this.#assertPlanIdentity(identity);
    return this.#planReview.save(this.snapshot.taskId, identity, draft);
  }

  clearPlanReviewState(): void {
    this.#planReview.clearTask(this.snapshot.taskId);
  }

  #assertPlanIdentity(identity: PlanReviewDraftIdentity): void {
    const gate = this.snapshot.gates.find(
      (entry): entry is PlanReviewPendingGate => entry.kind === "planReview"
        && entry.gateId === identity.gateId,
    );
    if (!gate || planGateIdentity(gate).baseHash !== identity.baseHash) {
      throw new AppProblem(
        409,
        "CAPABILITY_UNAVAILABLE",
        "This Plan revision is no longer the active native review Gate.",
      );
    }
  }

  finishQueueEntry(requestId: string, outcome: "removed" | "failed"): void {
    const index = this.snapshot.queue.entries.findIndex(
      (item) => item.requestId === requestId,
    );
    if (index < 0) return;
    const [entry] = this.snapshot.queue.entries.splice(index, 1);
    this.snapshot.activities.waiting = Math.max(
      0,
      this.snapshot.activities.waiting - 1,
    );
    this.record("supervisor", `queue/entry/${outcome}`, null, {
      requestId,
      entryId: entry.entryId,
    });
  }

  record(
    source: TaskEventSource,
    method: string,
    turnId: string | null,
    payload: unknown,
    protocolPayload?: unknown,
  ): TaskEventEnvelope {
    if (turnId && (method === "session/prompt:completed" || method === "session/prompt:failed" || method === "session/prompt:interrupted")) {
      const family = this.#turnIdentity.familyForBase(turnId);
      turnId = family.at(-1) || turnId;
    }
    return this.#appendEvent(source, method, turnId, payload, true, protocolPayload);
  }

  #recordChild(
    source: TaskEventSource,
    method: string,
    turnId: string | null,
    payload: unknown,
    protocolPayload?: unknown,
  ): TaskEventEnvelope {
    return this.#appendEvent(source, method, turnId, payload, false, protocolPayload);
  }

  #appendEvent(
    source: TaskEventSource,
    method: string,
    turnId: string | null,
    payload: unknown,
    _visible: boolean,
    _protocolPayload?: unknown,
  ): TaskEventEnvelope {
    const event: TaskEventEnvelope = {
      eventId: randomUUID(),
      taskId: this.snapshot.taskId,
      turnId,
      connectionEpoch: this.#connectionEpoch,
      sequence: ++this.#sequence,
      source,
      method,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.#contextReducer.observe(event);
    this.events.push(event);
    this.#syncActivities();
    return event;
  }

  #syncActivities(): void {
    const work = projectTaskWorkState(this.events);
    const all = [...work.active, ...work.unconfirmed, ...work.terminal];
    this.snapshot.activities.running = work.active.length;
    this.snapshot.activities.unconfirmed = work.unconfirmed.length;
    this.snapshot.activities.failed = work.terminal.filter((item) => item.status === "failed").length;
    this.snapshot.activities.completed = work.terminal.filter((item) =>
      item.status === "completed" || item.status === "cancelled").length;
    this.snapshot.activities.batchId = all.length ? `activity:${this.#connectionEpoch}` : null;
    this.snapshot.activities.newestActivityAt = all.reduce<string | null>(
      (latest, item) => !latest || item.updatedAt > latest ? item.updatedAt : latest,
      null,
    );
  }

  #persistAtomically<T>(operation: () => T): T {
    return operation();
  }

  touch(): void {
    this.snapshot.updatedAt = new Date().toISOString();
    this.snapshot.revision += 1;
  }

  advanceConnectionEpoch(): void {
    this.#connectionEpoch += 1;
    this.#sequence = 0;
    this.#turnIdentity.beginConnectionEpoch();
  }

}

function gateSessionScope(gate: PendingGate): "parent" | "child" {
  return asRecord(gate.payload).sessionScope === "child"
    ? "child"
    : "parent";
}
