import { randomUUID } from "node:crypto";
import type { TaskPermissionMode, TaskSnapshot } from "../../shared/contracts.js";
import type { OfficialAcpClient } from "../acp/OfficialAcpClient.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import { basePermissionMode } from "./taskPermissionState.js";
import type { RuntimePermissionCapabilities } from "./taskTypes.js";
import { errorMessage } from "./taskValue.js";

interface TaskPermissionRuntimeOptions {
  client: OfficialAcpClient;
  projection: TaskProjection;
  requested: TaskPermissionMode;
  capabilities: RuntimePermissionCapabilities;
  isIdle: () => boolean;
  waitForIdle: () => Promise<void>;
  isStopped: () => boolean;
  touch: () => void;
  change: () => void;
}

interface PendingPermission {
  requestId: string;
  input: "on" | "off";
  target: TaskPermissionMode;
}

export class TaskPermissionRuntime {
  #pending: PendingPermission | null = null;
  #drain: Promise<void> | null = null;

  constructor(private readonly options: TaskPermissionRuntimeOptions) {}

  get hasPending(): boolean { return Boolean(this.#pending || this.#drain); }

  async establish(sessionId: string, turnId: string | null): Promise<void> {
    const { requested, capabilities, client, projection } = this.options;
    if (requested === "auto") {
      throw unavailable("Auto is unavailable because this Grok runtime did not advertise a verifiable structured control.");
    }
    if (requested === "alwaysApprove" && !capabilities.alwaysApprove.available) {
      throw unavailable(capabilities.alwaysApprove.reason || "Always Approve is unavailable.");
    }
    if (requested === "acceptEdits" && !capabilities.acceptEdits.available) {
      throw unavailable(capabilities.acceptEdits.reason || "Accept Edits is unavailable.");
    }
    if (requested === "dontAsk" && !capabilities.dontAsk.available) {
      throw unavailable(capabilities.dontAsk.reason || "Don’t Ask is unavailable.");
    }
    const state = requested === "alwaysApprove"
      ? await client.setYoloMode(sessionId, true)
      : requested === "ask"
        ? await client.setYoloMode(sessionId, false)
        : await client.readSessionRosterState(sessionId);
    const effective = projection.applySessionRosterReceipt(state, "x.ai/sessions/list", turnId);
    if (effective !== requested) {
      throw new Error(`Grok reported ${effective} after ${requested} was requested.`);
    }
  }

  async setAlwaysApprove(requestId: string, input: string): Promise<TaskSnapshot> {
    const { projection } = this.options;
    if (!projection.snapshot.sessionId) throw new Error("Task session is not ready.");
    const normalized = input.trim().toLowerCase();
    if (normalized !== "on" && normalized !== "off") {
      throw new AppProblem(400, "VALIDATION_FAILED", "Always Approve requires an explicit on or off value.");
    }
    const enabled = normalized === "on";
    const target = enabled
      ? "alwaysApprove"
      : projection.snapshot.permission.base || basePermissionMode(this.options.requested);
    const mode = projection.snapshot.permission.modes.find((entry) => entry.mode === target);
    if (!mode?.available || !mode.hotSwitch) {
      throw unavailable(mode?.reason || `${target} is not available for this session.`);
    }
    this.#pending = { requestId, input: normalized, target };
    await this.#ensureDrain();
    while (this.#pending || this.#drain) await this.flushPending();
    return projection.detail().snapshot;
  }

  async flushPending(): Promise<void> {
    while (this.#pending || this.#drain) {
      await (this.#drain || this.#ensureDrain());
    }
  }

  #ensureDrain(): Promise<void> {
    if (this.#drain) return this.#drain;
    const drain = this.#drainPending();
    this.#drain = drain;
    void drain.finally(() => {
      if (this.#drain !== drain) return;
      this.#drain = null;
      if (this.#pending && !this.options.isStopped()) void this.#ensureDrain().catch(() => undefined);
    }).catch(() => undefined);
    return drain;
  }

  async #drainPending(): Promise<void> {
    await this.options.waitForIdle();
    while (this.#pending) {
      if (this.options.isStopped()) throw new Error("Task actor has been retired.");
      if (!this.options.isIdle()) await this.options.waitForIdle();
      const pending = this.#pending;
      this.#pending = null;
      if (this.options.projection.snapshot.permission.effective === pending.target) continue;
      await this.#apply(pending);
    }
  }

  async #apply(pending: PendingPermission): Promise<void> {
    const { client, projection } = this.options;
    const sessionId = projection.snapshot.sessionId;
    if (!sessionId) throw new Error("Task session is not ready.");
    const turnId = randomUUID();
    projection.beginCommand(turnId, pending.requestId, "always-approve", pending.input);
    this.#changed();
    try {
      const state = await client.setYoloMode(sessionId, pending.input === "on");
      const effective = projection.applySessionRosterReceipt(state, "x.ai/sessions/list", turnId);
      if (effective !== pending.target) throw new Error(`Grok reported ${effective} instead of ${pending.target}.`);
      projection.record("xai", "x.ai/yolo_mode_changed", turnId, {
        sessionId,
        yolo: state.yolo,
        effective,
      });
      projection.finishCommand(turnId, pending.requestId, "always-approve");
    } catch (error) {
      const message = errorMessage(error);
      projection.snapshot.error = { code: "PERMISSION_UNCONFIRMED", message };
      projection.finishCommand(turnId, pending.requestId, "always-approve", message);
      this.#pending = null;
      throw error;
    } finally {
      this.#changed();
    }
  }

  #changed(): void {
    this.options.touch();
    this.options.change();
  }
}

function unavailable(message: string): AppProblem {
  return new AppProblem(409, "CAPABILITY_UNAVAILABLE", message);
}
