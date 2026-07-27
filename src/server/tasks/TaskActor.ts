import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createActor } from "xstate";
import { QueueMutationSchema, type ComposerReplayDocument, type GateDecision, type PathReferenceSummary, type PlanReviewDraftIdentity, type PlanReviewDraftSnapshot, type TaskDetailProjection, type TaskGoalAction, type TaskProjectionFrame, type TaskSnapshot, type TaskSubmissionMode, type WorkMode } from "../../shared/contracts.js";
import type { z } from "zod";
import { OfficialAcpClient, type ForkSessionResponse, type RewindExecuteResponse } from "../acp/OfficialAcpClient.js";
import { wireTaskClientEvents } from "./TaskClientEvents.js";
import { PromptEchoQueue } from "./PromptEchoQueue.js";
import { TaskRuntimeProjection, type TaskProjectionChange } from "./TaskRuntimeProjection.js";
import { decideTaskGate } from "./taskGates.js";
import { applyTaskMachineState, taskMachine } from "./taskMachine.js";
import { createTaskSnapshot } from "./taskSnapshotFactory.js";
import { applyTaskConfigOptions } from "./taskConfigOptions.js";
import { setTaskConfigOption } from "./taskConfigMutation.js";
import { applySandboxEvidence } from "./sandboxEvidence.js";
import type { TaskActorOptions } from "./taskTypes.js";
import { errorMessage } from "./taskValue.js";
import { executeTaskCommand, type TaskCommandExecutionOptions, type TaskCommandPresentation } from "./taskCommandExecution.js";
import { alignQueuedActiveTurns, mutateNativeQueue } from "./taskNativeQueue.js";
import { AppProblem } from "../security/problemResponse.js";
import { preparePromptProjection } from "./preparePromptProjection.js";
import { interjectTask } from "./interjectTask.js";
import { stopTaskWork } from "./taskWorkControl.js";
import { taskAcpClientOptions } from "./taskAcpClientOptions.js";
import { TaskPermissionRuntime } from "./TaskPermissionRuntime.js";
import { hasPendingNativeQueue } from "./taskQueueState.js";
import { historyMutationBlocker } from "../../shared/taskHistoryReadiness.js";
import { refreshTaskContextWindow } from "./taskContextWindow.js";
import { createTaskRuntimeContext } from "./taskActorRuntimeContext.js";
import { completeTaskTurn, rejectTaskTurn, type ActiveTaskTurn, type TaskTurnSettlementContext } from "./taskTurnSettlement.js";
import { TaskPromptReceiptRuntime } from "./taskPromptReceipt.js";
import { forkTaskHistory, rewindTaskHistory } from "./taskHistoryMutation.js";
import { sessionPromptMeta } from "./taskSystemPrompt.js";
import { applyAvailableCommands, permissionModes } from "./taskProtocolRegistry.js";
interface IdleWaiter { resolve: () => void; reject: (error: Error) => void }
export class TaskActor extends EventEmitter {
  readonly #machine = createActor(taskMachine);
  readonly #projection: TaskRuntimeProjection; readonly #client: OfficialAcpClient;
  readonly #acceptedWaiters = new Map<string, () => void>();
  readonly #idleWaiters = new Set<IdleWaiter>();
  readonly #promptEchoes = new PromptEchoQueue();
  #activeTurns = new Map<string, ActiveTaskTurn>();
  readonly #permissions: TaskPermissionRuntime;
  readonly #receipts: TaskPromptReceiptRuntime;
  readonly #turnSettlement: TaskTurnSettlementContext;
  #latestTurnId: string | null = null; #pendingConnectionRestore = false;
  #pendingControlDispatches = 0;
  #controlDispatchTail: Promise<void> = Promise.resolve();
  #queueMutationTail: Promise<void> = Promise.resolve();
  #lastTouched = Date.now();
  #stopped = false;
  constructor(private readonly options: TaskActorOptions) {
    super();
    const snapshot = options.existing?.snapshot ?? createTaskSnapshot(options);
    snapshot.permission.modes = permissionModes(
      snapshot.permission.effective,
      options.permissionCapabilities,
    );
    snapshot.projectionEpoch = `runtime:${randomUUID()}`;
    snapshot.revision = 0;
    this.#projection = new TaskRuntimeProjection(snapshot, options.state, {
      restored: options.existing,
      readChild: (sessionId) => options.taskStore.readChildDetail(snapshot.taskId, sessionId),
      media: options.media ? { store: options.media, projectPath: options.projectPath, grokHome: options.grokHome } : undefined,
      notify: options.publishNotification,
    });
    this.#client = (options.clientFactory || ((clientOptions) => new OfficialAcpClient(clientOptions)))(taskAcpClientOptions(options));
    this.#receipts = new TaskPromptReceiptRuntime({
      projection: this.#projection, acceptedWaiters: this.#acceptedWaiters,
      connectionInterrupted: () => this.#connectionInterrupted(),
      touch: () => this.#touch(), change: (change) => this.#emitChange(change),
    });
    this.#permissions = new TaskPermissionRuntime({
      client: this.#client, projection: this.#projection, requested: options.permission,
      capabilities: options.permissionCapabilities,
      isIdle: () => this.#isControlSafeIdle,
      waitForIdle: () => this.#waitForIdle(),
      isStopped: () => this.#stopped,
      touch: () => this.#touch(), change: () => this.#emitChange(),
    });
    this.#turnSettlement = {
      projection: this.#projection, promptEchoes: this.#promptEchoes, activeTurns: this.#activeTurns,
      syncActiveTurn: () => this.#syncActiveTurn(),
      notifyIdle: () => this.#notifyIdle(), turnDone: () => this.#machine.send({ type: "TURN_DONE" }),
      refreshContextWindow: () => { this.#refreshContextWindow(); }, touch: () => this.#touch(), change: (change) => this.#emitChange(change),
      connectionInterrupted: () => this.#connectionInterrupted(),
    };
    const runtime = createTaskRuntimeContext({
      client: this.#client, projection: this.#projection, projectPath: options.projectPath, media: options.media,
      activeTurns: this.#activeTurns, acceptedWaiters: this.#acceptedWaiters, promptEchoes: this.#promptEchoes,
      latestTurnId: () => this.#latestTurnId, isStopped: () => this.#stopped,
      refreshContextWindow: () => this.#refreshContextWindow(), touch: () => this.#touch(),
      queueChanged: () => this.#alignQueuedActiveTurns(),
      settleTurn: (turnId, outcome, value) => outcome === "completed"
        ? this.#completeTurn(turnId, value)
        : this.#rejectTurn(turnId, value),
      change: (change) => this.#emitChange(change),
      disconnectMachine: () => this.#machine.send({ type: "DISCONNECTED" }),
    });
    wireTaskClientEvents(runtime);
    this.#machine.subscribe(() => this.#syncMachineState());
    this.#machine.start();
  }
  get snapshot(): TaskSnapshot { return structuredClone(this.#projection.snapshot); }
  get detail(): TaskDetailProjection { return this.#projection.detail(); }
  projectionFrame(change?: TaskProjectionChange): TaskProjectionFrame { return this.#projection.frame(change); }
  childDetail(sessionId: string) { return this.#projection.childDetail(sessionId); }
  rename(title: string): TaskSnapshot {
    this.#projection.snapshot.title = title;
    this.#projection.record("supervisor", "task/renamed", null, { title });
    this.#projection.touch(); this.#emitChange();
    return this.snapshot;
  }
  get lastTouched(): number { return this.#lastTouched; }
  get hasUserMessages(): boolean { return this.#projection.messages.some((message) => message.role === "user"); }
  get hasUnresolvedDelivery(): boolean {
    return this.#projection.messages.some((message) =>
      message.role === "user" && (message.delivery === "pending" || message.delivery === "unknown"));
  }
  get isIdle(): boolean {
    return this.#isControlSafeIdle
      && !this.#permissions.hasPending
      && this.#pendingControlDispatches === 0;
  }
  get #isControlSafeIdle(): boolean {
    const snapshot = this.#projection.snapshot;
    return this.#activeTurns.size === 0
      && snapshot.gates.length === 0
      && !this.hasUnresolvedDelivery
      && !hasPendingNativeQueue(snapshot);
  }
  get hasActiveGoal(): boolean { return this.snapshot.goal.status === "active"; }
  get hasGoal(): boolean { return this.snapshot.goal.status === "active" || this.snapshot.goal.status === "paused"; }
  async createSession(): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    this.#machine.send({ type: "START" });
    try {
      const initialize = await this.#client.start();
      applyAvailableCommands(this.#projection.snapshot, initialize._meta?.availableCommands);
      applySandboxEvidence(this.#projection.snapshot, this.options.grokHome, this.options.projectPath);
      const session = await this.#client.newSession(sessionPromptMeta(
        this.options.systemPrompt,
        this.options.continuationContext,
      ));
      this.#projection.adoptOfficialSessionIdentity(session.sessionId);
      applyTaskConfigOptions(this.#projection.snapshot, session.configOptions);
      if (session.modes?.currentModeId === "normal" || session.modes?.currentModeId === "plan") {
        this.#projection.snapshot.workMode = session.modes.currentModeId;
      }
      await this.#permissions.establish(session.sessionId, this.#latestTurnId);
      this.#machine.send({ type: "READY" });
      return this.snapshot;
    } catch (error) {
      this.#fail(error);
      throw error;
    }
  }
  async resume(): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    const sessionId = this.#projection.snapshot.sessionId;
    if (!sessionId) throw new Error("Task has no Grok session to resume.");
    const machine = this.#machine.getSnapshot();
    const recovering = machine.matches("recovering") || machine.matches("failed");
    this.#machine.send({ type: recovering ? "RECOVER" : "START" });
    try {
      const initialize = await this.#client.start();
      applyAvailableCommands(this.#projection.snapshot, initialize._meta?.availableCommands);
      applySandboxEvidence(this.#projection.snapshot, this.options.grokHome, this.options.projectPath);
      this.#projection.beginSessionReplay();
      const loaded = await this.#client.loadSession(sessionId).finally(() => this.#projection.endSessionReplay());
      applyTaskConfigOptions(this.#projection.snapshot, loaded.configOptions);
      if (loaded.modes?.currentModeId === "normal" || loaded.modes?.currentModeId === "plan") this.#projection.snapshot.workMode = loaded.modes.currentModeId;
      await this.#permissions.establish(sessionId, this.#latestTurnId);
      this.#projection.snapshot.error = null;
      this.#projection.snapshot.sandbox.source = "loaded-session";
      this.#machine.send({ type: "READY" });
      this.#pendingConnectionRestore ||= recovering;
      this.#refreshContextWindow();
      this.#projection.record("acp", "session/load", null, { sessionId });
      this.#projection.touch();
      this.#emitChange();
      return this.snapshot;
    } catch (error) {
      this.#fail(error);
      throw error;
    }
  }
  async submit(requestId: string, transportPrompt: string, paths: PathReferenceSummary[] = [], displayPrompt = transportPrompt, mode: TaskSubmissionMode = "prompt", composerDocument?: ComposerReplayDocument): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    if (this.#projection.userMessageDelivery(requestId)) return this.snapshot;
    if (mode === "goal") {
      return this.executeGoal(requestId, "set", displayPrompt, {
        displayPrompt, transportInput: transportPrompt, paths, composerDocument,
      });
    }
    if (mode === "plan") return this.#serializeControlDispatch(async () => {
      await this.#waitForIdle();
      this.#assertNotStopped();
      await this.#permissions.flushPending();
      await this.setWorkMode("plan");
      return this.#submitPrompt(requestId, transportPrompt, paths, displayPrompt, false, composerDocument);
    });
    if (this.#permissions.hasPending) return this.#serializeControlDispatch(async () => {
      await this.#waitForIdle();
      this.#assertNotStopped();
      await this.#permissions.flushPending();
      return this.#submitPrompt(requestId, transportPrompt, paths, displayPrompt, false, composerDocument);
    });
    if (this.#activeTurns.size > 0) {
      throw new AppProblem(409, "TASK_BUSY", "The current turn is still running. Choose Queue or Interrupt & Send.");
    }
    return this.#submitPrompt(requestId, transportPrompt, paths, displayPrompt, false, composerDocument);
  }
  async enqueue(requestId: string, transportPrompt: string, paths: PathReferenceSummary[] = [], displayPrompt = transportPrompt, composerDocument?: ComposerReplayDocument): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    this.#assertLiveConnection();
    if (this.#permissions.hasPending) return this.#serializeControlDispatch(async () => {
      await this.#waitForIdle();
      this.#assertNotStopped();
      await this.#permissions.flushPending();
      return this.#submitPrompt(requestId, transportPrompt, paths, displayPrompt, false, composerDocument);
    });
    if (this.#activeTurns.size === 0) {
      throw new AppProblem(409, "TASK_BUSY", "Queue is only available while another turn is running.");
    }
    return this.#submitPrompt(requestId, transportPrompt, paths, displayPrompt, true, composerDocument);
  }
  async interject(requestId: string, text: string): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    this.#assertLiveConnection();
    const snapshot = await interjectTask({ client: this.#client, projection: this.#projection, activeTurnId: this.#activeTurns.keys().next().value, requestId, text });
    this.#emitChange();
    return snapshot;
  }
  async rewindTo(targetPromptIndex: number): Promise<RewindExecuteResponse> {
    this.#assertHistoryMutationReady("Rewind");
    return rewindTaskHistory(this.#client, this.#projection, targetPromptIndex);
  }
  async forkNativeSession(): Promise<ForkSessionResponse> {
    this.#assertHistoryMutationReady("Fork");
    return forkTaskHistory(this.#client, this.#projection, this.options.projectPath, this.options.modelId);
  }
  assertForkReady(): void { this.#assertHistoryMutationReady("Fork"); }
  async #submitPrompt(requestId: string, transportPrompt: string, paths: PathReferenceSummary[], displayPrompt: string, queued: boolean, composerDocument?: ComposerReplayDocument): Promise<TaskSnapshot> {
    const sessionId = this.#projection.snapshot.sessionId;
    if (!sessionId) throw new Error("Task session is not ready.");
    const text = transportPrompt.trim();
    if (!text) throw new Error("Prompt cannot be empty.");
    if (this.#pendingConnectionRestore) {
      this.#projection.record("supervisor", "task/connection:restored", null, { sessionId });
      this.#pendingConnectionRestore = false;
    }
    const turnId = preparePromptProjection({
      projection: this.#projection,
      echoes: this.#promptEchoes,
      requestId,
      displayPrompt,
      paths,
      composerDocument,
      queued,
    });
    this.#latestTurnId = turnId;
    if (!queued) {
      this.#projection.snapshot.currentPromptExecutionId = turnId;
      this.#machine.send({ type: "PROMPT" });
    }
    this.#promptEchoes.trackTransport(requestId, text);
    this.#projection.markUserMessageDispatched(requestId, turnId, text);
    const completion = this.#client.prompt(sessionId, text);
    this.#activeTurns.set(turnId, { completion, requestId });
    this.#syncActiveTurn();
    this.#touch();
    void completion.then(
      (response) => this.#completeTurn(turnId, response),
      (error) => this.#rejectTurn(turnId, error),
    );
    await this.#receipts.waitFor(completion, requestId);
    return this.snapshot;
  }
  async mutateQueue(input: z.infer<typeof QueueMutationSchema>): Promise<TaskSnapshot> {
    const mutation = this.#queueMutationTail.then(() =>
      mutateNativeQueue(this.#client, this.#projection, this.#promptEchoes, input, this.#latestTurnId));
    this.#queueMutationTail = mutation.catch(() => undefined);
    await mutation;
    this.#alignQueuedActiveTurns();
    this.#emitChange();
    return this.snapshot;
  }
  async cancel(preservePlanReview = false): Promise<void> {
    const sessionId = this.#projection.snapshot.sessionId;
    if (!sessionId || !this.#activeTurns.size) return;
    this.#machine.send({ type: "CANCEL" });
    this.#projection.touch();
    this.#emitChange();
    if (!preservePlanReview) this.#projection.clearPlanReviewState();
    await this.#client.cancel(sessionId);
    this.#projection.clearGates("cancelled", "parent");
    this.#notifyIdle();
    this.#emitChange();
  }
  async setConfigOption(configId: string, value: string | boolean): Promise<TaskSnapshot> { const snapshot = await setTaskConfigOption(this.#client, this.#projection, configId, value, this.#latestTurnId); this.#emitChange(); return snapshot; }
  async executeCommand(requestId: string, name: string, input = "", presentation?: TaskCommandPresentation, options?: TaskCommandExecutionOptions): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    if (name === "always-approve") return this.#permissions.setAlwaysApprove(requestId, input);
    if (name === "auto") throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Auto has no advertised structured control and session-roster confirmation in this Grok runtime.");
    return executeTaskCommand({
      client: this.#client, projection: this.#projection, activeTurns: this.#activeTurns, promptEchoes: this.#promptEchoes,
      setLatestTurnId: (turnId) => { this.#latestTurnId = turnId; },
      syncActiveTurn: () => this.#syncActiveTurn(),
      promptStarted: () => this.#machine.send({ type: "PROMPT" }),
      completeTurn: (turnId, response) => this.#completeTurn(turnId, response),
      rejectTurn: (turnId, error) => this.#rejectTurn(turnId, error),
      touch: () => this.#touch(), change: () => this.#emitChange(),
    }, requestId, name, input, presentation, options);
  }
  async executeGoal(requestId: string, action: TaskGoalAction, objective?: string, presentation?: TaskCommandPresentation): Promise<TaskSnapshot> {
    const input = action === "set" ? objective?.trim() : action;
    if (!input) throw new Error("Goal objective cannot be empty.");
    return this.#serializeControlDispatch(async () => {
      if (this.#activeTurns.size > 0 && this.snapshot.goal.status === "active") {
        await this.cancel();
        await this.#waitForIdle();
        if (action === "pause") {
          this.#refreshOfficialGoal();
          return this.snapshot;
        }
      }
      const completion = this.executeCommand(requestId, "goal", input, presentation, {
        queueWhenBusy: this.#activeTurns.size > 0,
      });
      await this.#receipts.waitFor(completion, requestId);
      if (this.#refreshOfficialGoal()) {
        this.#projection.touch();
        this.#touch();
        this.#emitChange();
      }
      return this.snapshot;
    });
  }
  async setWorkMode(mode: WorkMode): Promise<TaskSnapshot> {
    this.#assertNotStopped();
    const sessionId = this.#projection.snapshot.sessionId;
    if (!sessionId) throw new Error("Task session is not ready.");
    await this.#client.setMode(sessionId, mode);
    this.#projection.snapshot.workMode = mode;
    this.#projection.record("acp", "session/set_mode", this.#latestTurnId, { mode });
    this.#projection.touch();
    this.#touch();
    this.#emitChange();
    return this.snapshot;
  }
  async stopWork(requestId: string, workItemId: string): Promise<TaskSnapshot> {
    this.#assertNotStopped(); const snapshot = await stopTaskWork(this.#client, this.#projection, requestId, workItemId); this.#touch(); this.#emitChange(); return snapshot;
  }
  planReviewDraft(identity: PlanReviewDraftIdentity): PlanReviewDraftSnapshot { return this.#projection.planReviewDraft(identity); }
  savePlanReviewDraft(identity: PlanReviewDraftIdentity, draft: string | null): PlanReviewDraftSnapshot { return this.#projection.savePlanReviewDraft(identity, draft); }
  async decideGate(decision: GateDecision): Promise<TaskSnapshot> {
    const snapshot = decideTaskGate(this.#client, this.#projection, decision, () => this.#notifyIdle());
    this.#emitChange();
    return snapshot;
  }
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#client.stop();
    this.#projection.clearGates("stopped");
    this.#machine.stop();
    this.#projection.snapshot.connection = "unloaded";
    this.#projection.snapshot.turn = "idle";
    this.#projection.snapshot.currentPromptExecutionId = null;
    this.#notifyIdle(true);
    this.#projection.touch();
    this.#emitChange();
  }
  async shutdown(): Promise<void> {
    try {
      await this.cancel(true);
      await Promise.race([
        Promise.allSettled([...this.#activeTurns.values()].map((turn) => turn.completion)),
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ]);
    } finally {
      this.stop();
      await this.#client.shutdown();
    }
  }
  #completeTurn(turnId: string, response: unknown): void {
    if (this.#activeTurns.get(turnId)?.commandName === "goal") {
      this.#refreshOfficialGoal();
    }
    completeTaskTurn(this.#turnSettlement, turnId, response);
  }
  #rejectTurn(turnId: string, error: unknown): void {
    if (this.#activeTurns.get(turnId)?.commandName === "goal") {
      this.#refreshOfficialGoal();
    }
    rejectTaskTurn(this.#turnSettlement, turnId, error);
  }
  #syncMachineState(): void { applyTaskMachineState(this.#projection.snapshot, this.#machine.getSnapshot()); this.#projection.touch(); this.#emitChange(); }
  #fail(error: unknown): void {
    this.#machine.send({ type: "FAIL" });
    this.#projection.snapshot.error = { code: "TASK_START_FAILED", message: errorMessage(error) };
    this.#projection.touch();
    this.#emitChange();
  }
  #refreshOfficialGoal(): boolean {
    const detail = this.options.taskStore.readDetail(this.#projection.snapshot.taskId);
    return detail ? this.#projection.reconcileOfficialGoal(detail) : false;
  }
  #refreshContextWindow(): boolean { return refreshTaskContextWindow(this.#projection.snapshot, this.options.grokHome, this.options.projectPath); }
  #connectionInterrupted(): boolean {
    return this.snapshot.connection === "recovering" || this.snapshot.connection === "failed";
  }
  #assertLiveConnection(): void {
    if (this.snapshot.connection !== "ready") {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Queue and Interject require a live Grok session.");
    }
  }
  #assertHistoryMutationReady(action: "Rewind" | "Fork"): void {
    this.#assertNotStopped();
    this.#assertLiveConnection();
    const snapshot = this.#projection.snapshot;
    const blocker = historyMutationBlocker({
      activeTurnCount: this.#activeTurns.size,
      hasUnresolvedDelivery: this.hasUnresolvedDelivery,
      gates: snapshot.gates.length,
      queueRunning: snapshot.queue.runningEntryId !== null,
      queuedPrompts: Math.max(snapshot.activities.waiting, snapshot.queue.entries.length),
      goalStatus: snapshot.goal.status,
      runningActivities: snapshot.activities.running,
    });
    if (blocker) throw new AppProblem(409, "TASK_BUSY", `${action} is blocked because ${blocker.detail}.`);
  }
  #touch(): void { this.#lastTouched = Date.now(); }
  #waitForIdle(): Promise<void> {
    if (this.#stopped) return Promise.reject(new Error("Task actor has been retired."));
    if (this.#isControlSafeIdle) return Promise.resolve();
    return new Promise((resolve, reject) => this.#idleWaiters.add({ resolve, reject }));
  }
  #notifyIdle(force = false): void {
    if (!force && this.#connectionInterrupted()) {
      const error = new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Grok disconnected before the pending control could be dispatched.");
      for (const waiter of this.#idleWaiters) waiter.reject(error);
      this.#idleWaiters.clear();
    } else if (force || this.#isControlSafeIdle) {
      for (const waiter of this.#idleWaiters) waiter.resolve();
      this.#idleWaiters.clear();
    }
  }
  #serializeControlDispatch<T>(operation: () => Promise<T>): Promise<T> {
    this.#pendingControlDispatches += 1;
    const result = this.#controlDispatchTail.then(operation);
    this.#controlDispatchTail = result.then(() => undefined, () => undefined);
    void result.finally(() => { this.#pendingControlDispatches = Math.max(0, this.#pendingControlDispatches - 1); }).catch(() => undefined);
    return result;
  }
  #alignQueuedActiveTurns(): void {
    alignQueuedActiveTurns(this.#activeTurns, this.#promptEchoes);
    this.#syncActiveTurn();
  }
  #syncActiveTurn(): void {
    this.#projection.snapshot.currentPromptExecutionId = this.#activeTurns.keys().next().value || null;
  }
  #emitChange(change?: TaskProjectionChange): void { this.#notifyIdle(); this.emit("change", change); }
  #assertNotStopped(): void { if (this.#stopped) throw new Error("Task actor has been retired."); }
}
