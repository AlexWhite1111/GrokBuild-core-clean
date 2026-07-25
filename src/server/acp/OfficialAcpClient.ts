import * as acp from "@agentclientprotocol/sdk";
import type {
  InitializeResponse,
  JsonRpcId,
  LoadSessionResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SetSessionConfigOptionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { z } from "zod";
import { XAI_METHODS, XaiMethodRegistry, type XaiMethod } from "./XaiMethodRegistry.js";
import {
  AskUserQuestionRequestSchema,
  ExitPlanModeRequestSchema,
  cancelledReverseRequest,
  parseReverseRequestResponse,
  type ReverseRequestMethod,
} from "./reverseContracts.js";
import {
  YoloModeChangedParamsSchema,
  sessionRosterState,
  type SessionRosterState,
} from "./sessionRosterContracts.js";

interface DeferredGate {
  method: ReverseRequestMethod;
  sessionId: string | null;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type AcpProcessOwnerKind = "task" | "run" | "preview" | "application";

interface AcpProcessOwner {
  kind: AcpProcessOwnerKind;
  id: string;
}

/**
 * Minimal lifecycle port required by the ACP adapter. Keeping this contract
 * local prevents the transport layer from depending on the server runtime.
 */
interface AcpProcessRegistry {
  register(input: {
    ownerKind: AcpProcessOwnerKind;
    ownerId: string;
    child: ChildProcess;
    isolatedProcessGroup?: boolean;
  }): () => void;
  stopOwner(ownerKind: AcpProcessOwnerKind, ownerId: string): Promise<void>;
}

export interface AcpClientOptions {
  binary: string;
  cwd: string;
  grokHome: string;
  permissionMode?: "default" | "bypassPermissions" | null;
  sandboxMode?: "workspace" | "read-only" | "strict" | "custom" | null;
  modelId?: string | null;
  effort?: string | null;
  processes?: AcpProcessRegistry;
  processOwner?: AcpProcessOwner;
}

export interface ReverseRequestEvent {
  gateId: string;
  requestId: JsonRpcId;
  method: ReverseRequestMethod;
  params: unknown;
}

export interface ReverseRequestClosedEvent {
  gateId: string;
  method: ReverseRequestMethod;
  sessionId: string | null;
  reason: "aborted" | "cancelled";
}

const RewindPointSchema = z.object({
  prompt_index: z.number().int().nonnegative(),
  created_at: z.string(),
  num_file_snapshots: z.number().int().nonnegative(),
  has_file_changes: z.boolean(),
  prompt_preview: z.string(),
}).passthrough();
const RewindPointsResponseSchema = z.object({
  rewind_points: z.array(RewindPointSchema),
}).passthrough();
const RewindExecuteResponseSchema = z.object({
  success: z.boolean(),
  target_prompt_index: z.number().int().nonnegative(),
  mode: z.enum(["all", "conversation_only", "files_only"]),
  reverted_files: z.array(z.string()),
  clean_files: z.array(z.string()),
  conflicts: z.array(z.string()),
  prompt_text: z.string().nullable(),
  error: z.string().nullable(),
}).passthrough();
const ForkSessionResponseSchema = z.object({
  newSessionId: z.string().min(1).max(1_024),
  chatMessagesCopied: z.number().int().nonnegative(),
  updatesCopied: z.number().int().nonnegative(),
  planStateCopied: z.boolean(),
  newCwd: z.string().min(1),
  parentSessionId: z.string().min(1).max(1_024),
  newModelId: z.string().min(1).max(256),
}).passthrough();

export type RewindPoint = z.infer<typeof RewindPointSchema>;
export type RewindExecuteResponse = z.infer<typeof RewindExecuteResponseSchema>;
export type ForkSessionResponse = z.infer<typeof ForkSessionResponseSchema>;

const PASSIVE_XAI_EVENTS: XaiMethod[] = [
  XAI_METHODS.queueChanged,
  XAI_METHODS.promptComplete,
  XAI_METHODS.sessionInterjection,
  XAI_METHODS.sessionNotification,
  XAI_METHODS.sessionUpdate,
  XAI_METHODS.sessionsChanged,
  XAI_METHODS.settingsUpdate,
  XAI_METHODS.fsNotify,
  XAI_METHODS.fsIndex,
  XAI_METHODS.fsIndexDelta,
  XAI_METHODS.fuzzyStatus,
  XAI_METHODS.worktreeStatus,
];

const ACP_ACTIVATION_STAGE_HARD_LIMIT_MS = 120_000;
const SLOW_ACP_STAGE_MS = 5_000;

export class OfficialAcpClient extends EventEmitter {
  readonly registry = new XaiMethodRegistry();
  readonly #gates = new Map<string, DeferredGate>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: acp.ClientConnection | null = null;
  #initialize: InitializeResponse | null = null;
  #starting: Promise<InitializeResponse> | null = null;
  #processOwner: AcpProcessOwner | null = null;
  #processStop: Promise<void> | null = null;

  constructor(private readonly options: AcpClientOptions) {
    super();
  }

  get initializeResponse(): InitializeResponse | null {
    return this.#initialize;
  }

  start(): Promise<InitializeResponse> {
    if (this.#initialize) return Promise.resolve(this.#initialize);
    if (this.#starting) return this.#starting;
    const starting = this.#start();
    this.#starting = starting;
    void starting.finally(() => {
      if (this.#starting === starting) this.#starting = null;
    }).catch(() => undefined);
    return starting;
  }

  async #start(): Promise<InitializeResponse> {
    this.#processOwner = null;
    this.#processStop = null;
    const isolatedProcessGroup = process.platform !== "win32";
    const child = spawn(this.options.binary, buildAgentArguments(this.options), {
      cwd: this.options.cwd,
      env: { ...process.env, GROK_HOME: this.options.grokHome },
      detached: isolatedProcessGroup,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#process = child;
    child.stderr.on("data", (chunk: Buffer) => this.emit("stderr", redact(chunk.toString("utf8"))));
    child.once("error", (error) => this.#handleDisconnect(error));
    child.once("exit", (code, signal) => this.#handleDisconnect(new Error(`Grok ACP exited (${code ?? signal ?? "unknown"})`)));
    if (this.options.processes) {
      try {
        const owner = this.options.processOwner || { kind: "application" as const, id: `acp:${child.pid ?? "pending"}` };
        this.options.processes.register({
          ownerKind: owner.kind,
          ownerId: owner.id,
          child,
          isolatedProcessGroup,
        });
        this.#processOwner = owner;
      } catch (error) {
        this.#process = null;
        signalChild(child, "SIGKILL", isolatedProcessGroup);
        throw error;
      }
    }

    const clientApp = acp.client({ name: "grok-build" })
      .onRequest(acp.methods.client.session.requestPermission, (context) =>
        this.#deferPermission(context.requestId, context.params, context.signal))
      .onNotification(acp.methods.client.session.update, (context) => {
        this.emit("notification", { method: acp.methods.client.session.update, params: context.params });
      })
      .onRequest(XAI_METHODS.askUserQuestion, AskUserQuestionRequestSchema, (context) =>
        this.#deferCustom(context.requestId, XAI_METHODS.askUserQuestion, context.params, context.signal))
      .onRequest(`_${XAI_METHODS.askUserQuestion}`, AskUserQuestionRequestSchema, (context) =>
        this.#deferCustom(context.requestId, XAI_METHODS.askUserQuestion, context.params, context.signal))
      .onRequest(XAI_METHODS.exitPlanMode, ExitPlanModeRequestSchema, (context) =>
        this.#deferCustom(context.requestId, XAI_METHODS.exitPlanMode, context.params, context.signal))
      .onRequest(`_${XAI_METHODS.exitPlanMode}`, ExitPlanModeRequestSchema, (context) =>
        this.#deferCustom(context.requestId, XAI_METHODS.exitPlanMode, context.params, context.signal));

    for (const method of PASSIVE_XAI_EVENTS) {
      clientApp.onNotification(method, z.unknown(), (context) => {
        this.#observePassiveEvent(method, context.params);
      });
      clientApp.onNotification(`_${method}`, z.unknown(), (context) => {
        this.#observePassiveEvent(method, context.params);
      });
      clientApp.onRequest(method, z.unknown(), (context) => {
        this.#observePassiveEvent(method, context.params);
        return {};
      });
      clientApp.onRequest(`_${method}`, z.unknown(), (context) => {
        this.#observePassiveEvent(method, context.params);
        return {};
      });
    }

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = clientApp.connect(stream);
    this.#connection = connection;
    try {
      const response = await this.#activationStage("initialize", connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            session: { configOptions: {} },
            plan: {},
          },
          clientInfo: { name: "Grok Build", version: process.env.GROK_GUI_APP_VERSION || "development" },
        }));
      this.#initialize = response;
      this.registry.applyInitialize(response);
      const cachedToken = response.authMethods?.find((method) => method.id === "cached_token");
      if (cachedToken) {
        await this.#activationStage(
          "authenticate",
          connection.agent.request(acp.methods.agent.authenticate, { methodId: cachedToken.id }),
        );
      }
      this.emit("ready", response);
      return response;
    } catch (error) {
      this.stop(error);
      throw error;
    }
  }

  async newSession(meta?: { rules?: string[]; systemPromptOverride?: string }): Promise<NewSessionResponse> {
    const context = await this.#context();
    try {
      return await this.#activationStage("session/new", context.request(acp.methods.agent.session.new, {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(meta ? { _meta: meta } : {}),
      }));
    } catch (error) {
      this.stop(error);
      throw error;
    }
  }

  async loadSession(sessionId: string): Promise<LoadSessionResponse> {
    const context = await this.#context();
    try {
      return await this.#activationStage("session/load", context.request(acp.methods.agent.session.load, {
        sessionId,
        cwd: this.options.cwd,
        mcpServers: [],
      }));
    } catch (error) {
      this.stop(error);
      throw error;
    }
  }

  async prompt(sessionId: string, text: string): Promise<unknown> {
    const context = await this.#context();
    return context.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async setMode(sessionId: string, mode: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(mode)) throw new Error("Invalid ACP mode ID.");
    const context = await this.#context();
    await context.request(acp.methods.agent.session.setMode, { sessionId, modeId: mode });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetSessionConfigOptionResponse> {
    const context = await this.#context();
    return context.request(acp.methods.agent.session.setConfigOption, {
      sessionId,
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const context = await this.#context();
    await context.notify(acp.methods.agent.session.cancel, { sessionId });
    for (const [gateId, gate] of this.#gates) {
      if (gate.sessionId !== sessionId) continue;
      gate.resolve(cancelledReverseRequest(gate.method));
      this.#gates.delete(gateId);
      this.emit("reverseRequestClosed", {
        gateId,
        method: gate.method,
        sessionId: gate.sessionId,
        reason: "cancelled",
      } satisfies ReverseRequestClosedEvent);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const context = await this.#context();
    if (this.#initialize?.agentCapabilities?.sessionCapabilities?.close) {
      await context.request(acp.methods.agent.session.close, { sessionId });
      return;
    }
    await this.cancel(sessionId);
  }

  async requestXai<T>(method: XaiMethod, params: unknown): Promise<T> {
    this.registry.require(method, "request");
    const context = await this.#context();
    return context.request<T, unknown>(`_${method}`, params);
  }

  async interject(sessionId: string, text: string): Promise<unknown> {
    return this.requestXai(XAI_METHODS.interject, { sessionId, text });
  }

  async rewindPoints(sessionId: string): Promise<RewindPoint[]> {
    const value = await this.requestXai<unknown>(XAI_METHODS.rewindPoints, { sessionId });
    return RewindPointsResponseSchema.parse(value).rewind_points;
  }

  async rewind(
    sessionId: string,
    targetPromptIndex: number,
    mode: "all" | "conversation_only" | "files_only" = "all",
  ): Promise<RewindExecuteResponse> {
    const value = await this.requestXai<unknown>(XAI_METHODS.rewindExecute, {
      sessionId,
      targetPromptIndex,
      force: true,
      mode,
    });
    return RewindExecuteResponseSchema.parse(value);
  }

  async forkSession(input: {
    sourceSessionId: string;
    sourceCwd: string;
    newCwd: string;
    newSessionId: string;
    newModelId: string;
    sourceWorkspaceDir: string;
  }): Promise<ForkSessionResponse> {
    const value = await this.requestXai<unknown>(XAI_METHODS.sessionFork, input);
    return ForkSessionResponseSchema.parse(value);
  }

  async notifyXai(method: XaiMethod, params: unknown): Promise<void> {
    this.registry.require(method, "notification");
    const context = await this.#context();
    await context.notify(`_${method}`, params);
  }

  async readSessionRosterState(
    sessionId: string,
  ): Promise<SessionRosterState> {
    const response = await this.requestXai<unknown>(XAI_METHODS.sessionsList, {});
    return sessionRosterState(response, sessionId);
  }

  async setYoloMode(
    sessionId: string,
    enabled: boolean,
  ): Promise<SessionRosterState> {
    await this.notifyXai(XAI_METHODS.yoloModeChanged, yoloParams(sessionId, enabled));
    try {
      return await this.#confirmYoloMode(sessionId, enabled);
    } catch (error) {
      if (!enabled) throw error;
      try {
        await this.notifyXai(XAI_METHODS.yoloModeChanged, yoloParams(sessionId, false));
        await this.#confirmYoloMode(sessionId, false);
      } catch (rollbackError) {
        this.stop(rollbackError);
        throw new Error("Always Approve could not be confirmed or rolled back; the ACP connection was stopped.");
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)} Always Approve was rolled back to Ask.`);
    }
  }

  async #confirmYoloMode(
    sessionId: string,
    enabled: boolean,
  ): Promise<SessionRosterState> {
    let lastError: unknown;
    for (const delayMs of [0, 20, 50]) {
      if (delayMs) await delay(delayMs);
      try {
        const state = await this.readSessionRosterState(sessionId);
        if (state.yolo === enabled && (!enabled || state.autoMode !== true)) {
          return state;
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw new Error(
      `Grok did not confirm ${enabled ? "Always Approve" : "Ask"} in the session roster.`,
    );
  }

  resolveGate(gateId: string, value: unknown): void {
    const gate = this.#gates.get(gateId);
    if (!gate) throw new Error("The ACP gate is no longer pending.");
    const response = parseReverseRequestResponse(gate.method, value);
    this.#gates.delete(gateId);
    gate.resolve(response);
  }

  stop(reason: unknown = new Error("ACP client stopped")): void {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const gate of this.#gates.values()) gate.reject(error);
    this.#gates.clear();
    this.#initialize = null;
    this.#connection?.close(error);
    this.#connection = null;
    const child = this.#process;
    this.#process = null;
    if (child && child.exitCode == null && child.signalCode == null) {
      const owner = this.#processOwner;
      if (this.options.processes && owner) {
        this.#processStop ||= this.options.processes.stopOwner(owner.kind, owner.id)
          .catch(() => { signalChild(child, "SIGKILL", true); });
      } else {
        signalChild(child, "SIGTERM", process.platform !== "win32");
      }
    }
  }

  async shutdown(reason: unknown = new Error("ACP client stopped")): Promise<void> {
    this.stop(reason);
    await this.#processStop;
  }

  async #context(): Promise<acp.ClientContext> {
    await this.start();
    if (!this.#connection) throw new Error("ACP connection is not available.");
    return this.#connection.agent;
  }

  async #activationStage<T>(stage: string, operation: Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await withAcpStageDeadline(operation, stage, ACP_ACTIVATION_STAGE_HARD_LIMIT_MS);
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= SLOW_ACP_STAGE_MS) {
        console.warn(`[grok-build] slow ACP activation stage=${stage} elapsedMs=${elapsedMs}`);
      }
    }
  }

  #deferPermission(
    requestId: JsonRpcId,
    params: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    return this.#defer(requestId, "session/request_permission", params.sessionId, params, signal) as Promise<RequestPermissionResponse>;
  }

  #deferCustom(
    requestId: JsonRpcId,
    method: typeof XAI_METHODS.askUserQuestion | typeof XAI_METHODS.exitPlanMode,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.registry.observe(method);
    return this.#defer(requestId, method, sessionIdFrom(params), params, signal);
  }

  #defer(
    requestId: JsonRpcId,
    method: ReverseRequestEvent["method"],
    sessionId: string | null,
    params: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const gateId = `${method}:${String(requestId)}`;
    return new Promise((resolve, reject) => {
      this.#gates.set(gateId, { method, sessionId, resolve, reject });
      signal.addEventListener("abort", () => {
        if (!this.#gates.delete(gateId)) return;
        reject(signal.reason instanceof Error ? signal.reason : new Error("ACP gate aborted"));
        this.emit("reverseRequestClosed", {
          gateId,
          method,
          sessionId,
          reason: "aborted",
        } satisfies ReverseRequestClosedEvent);
      }, { once: true });
      this.emit("reverseRequest", { gateId, requestId, method, params } satisfies ReverseRequestEvent);
    });
  }

  #handleDisconnect(error: Error): void {
    if (!this.#process && !this.#connection) return;
    this.stop(error);
    this.emit("disconnect", error);
  }

  #observePassiveEvent(method: XaiMethod, params: unknown): void {
    this.registry.observe(method);
    this.emit("notification", { method, params });
  }
}

export function withAcpStageDeadline<T>(operation: Promise<T>, stage: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AcpStageTimeoutError(stage, timeoutMs));
    }, timeoutMs);
    timer.unref();
    void operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class AcpStageTimeoutError extends Error {
  constructor(readonly stage: string, readonly timeoutMs: number) {
    super(`Grok ACP ${stage} did not complete within ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "AcpStageTimeoutError";
  }
}

function buildAgentArguments(options: AcpClientOptions): string[] {
  if (options.modelId && !/^[A-Za-z0-9._:/-]{1,256}$/.test(options.modelId)) throw new Error("Invalid model ID.");
  if (options.effort && !/^(?:none|minimal|low|medium|high|xhigh|max)$/.test(options.effort)) throw new Error("Invalid reasoning effort.");
  const arguments_: string[] = [];
  if (options.permissionMode) arguments_.push("--permission-mode", options.permissionMode);
  if (options.sandboxMode) arguments_.push("--sandbox", options.sandboxMode);
  arguments_.push("agent", "--no-leader");
  if (options.modelId) arguments_.push("--model", options.modelId);
  if (options.effort) arguments_.push("--reasoning-effort", options.effort);
  arguments_.push("stdio");
  return arguments_;
}

function yoloParams(sessionId: string, enabled: boolean) {
  return YoloModeChangedParamsSchema.parse({ sessionId, yolo_mode: enabled });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionIdFrom(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sessionId = (value as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}

function signalChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals, group: boolean): void {
  try {
    if (group && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may have exited between the state check and signal delivery.
  }
}

function redact(value: string): string {
  return value
    .replace(/(?:Bearer\s+|token["'=:\s]+)[A-Za-z0-9._~+/-]{12,}/gi, "[REDACTED]")
    .slice(0, 16_000);
}

export function acpSessionUpdate(value: unknown): value is SessionNotification {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { sessionId?: unknown }).sessionId === "string"
    && Boolean((value as { update?: unknown }).update);
}
