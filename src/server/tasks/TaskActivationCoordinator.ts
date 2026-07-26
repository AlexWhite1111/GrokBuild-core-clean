import { randomUUID } from "node:crypto";
import type { TaskCreate, TaskSnapshot } from "../../shared/contracts.js";
import { AcpStageTimeoutError } from "../acp/OfficialAcpClient.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskRow } from "./TaskStore.js";
import { TaskActor } from "./TaskActor.js";
import { newActorOptions, restoredActorOptions } from "./taskActorOptions.js";
import type { TaskStore } from "./TaskStore.js";
import { assertPermissionAvailable } from "./supervisorPoolPolicy.js";
import type { RuntimePermissionCapabilities, TaskActorOptions } from "./taskTypes.js";

export class TaskActivationCoordinator {
  readonly #activations = new Map<string, Promise<TaskActor>>();

  constructor(private readonly options: {
    actors: Map<string, TaskActor>;
    store: TaskStore;
    actorFactory: (options: TaskActorOptions) => TaskActor;
    permissionCapabilities(): RuntimePermissionCapabilities;
    ensureTaskCreationAllowed(): Promise<void>;
    ensureCapacity(): void;
    taskRow(taskId: string): TaskRow;
    actorRuntime(projectId: string): Omit<TaskActorOptions, "taskId" | "projectId" | "workMode" | "permission" | "sandbox">;
    attach(actor: TaskActor): void;
    publishCreatedTask(actor: TaskActor): void;
  }) {}

  async create(input: TaskCreate): Promise<TaskSnapshot> {
    await this.options.ensureTaskCreationAllowed();
    assertPermissionAvailable(input.permission, this.options.permissionCapabilities());
    this.options.ensureCapacity();
    const provisionalTaskId = randomUUID();
    const actor = this.options.actorFactory(newActorOptions(
      provisionalTaskId,
      input,
      this.options.actorRuntime(input.projectId),
    ));
    this.options.attach(actor);
    try {
      await actor.createSession();
    } catch (error) {
      if (!actor.snapshot.sessionId) {
        actor.stop();
        this.options.actors.delete(provisionalTaskId);
        throw activationProblem(error, input.requestId);
      }
    }
    this.#adoptOfficialIdentity(provisionalTaskId, actor);
    this.options.publishCreatedTask(actor);
    return actor.snapshot;
  }

  async intentActor(taskId: string, requestId: string): Promise<TaskActor> {
    try {
      return await this.activate(taskId);
    } catch (error) {
      throw activationProblem(error, requestId);
    }
  }

  async createSessionBranch(
    taskId: string,
    input: TaskCreate,
    continuationContext: string,
  ): Promise<TaskActor> {
    await this.options.ensureTaskCreationAllowed();
    assertPermissionAvailable(input.permission, this.options.permissionCapabilities());
    this.options.ensureCapacity();
    const actor = this.options.actorFactory({
      ...newActorOptions(taskId, input, this.options.actorRuntime(input.projectId)),
      continuationContext,
    });
    this.options.attach(actor);
    try {
      await actor.createSession();
      this.#adoptOfficialIdentity(taskId, actor);
      return actor;
    } catch (error) {
      actor.stop();
      this.options.actors.delete(taskId);
      if (actor.snapshot.taskId !== taskId) this.options.actors.delete(actor.snapshot.taskId);
      this.forgetTask(taskId);
      throw error;
    }
  }

  activate(taskId: string): Promise<TaskActor> {
    const pending = this.#activations.get(taskId);
    if (pending) return pending;
    const existing = this.options.actors.get(taskId);
    if (existing?.snapshot.connection === "ready") return Promise.resolve(existing);
    return this.#trackActivation(taskId, this.#activateActor(taskId, existing));
  }

  forgetTask(taskId: string): void {
    this.#activations.delete(taskId);
  }

  clear(): void {
    this.#activations.clear();
  }

  #trackActivation(taskId: string, activation: Promise<TaskActor>): Promise<TaskActor> {
    this.#activations.set(taskId, activation);
    const clear = () => { if (this.#activations.get(taskId) === activation) this.#activations.delete(taskId); };
    void activation.then(clear, clear);
    return activation;
  }

  #adoptOfficialIdentity(provisionalTaskId: string, actor: TaskActor): void {
    const taskId = actor.snapshot.sessionId;
    if (!taskId || actor.snapshot.taskId !== taskId) {
      throw new Error("A new task must use its official Grok session ID.");
    }
    if (this.options.actors.get(provisionalTaskId) === actor) {
      this.options.actors.delete(provisionalTaskId);
    }
    const existing = this.options.actors.get(taskId);
    if (existing && existing !== actor) {
      throw new Error(`Official Grok session ${taskId} is already active.`);
    }
    this.options.attach(actor);
  }

  async #activateActor(taskId: string, current?: TaskActor): Promise<TaskActor> {
    let actor = current;
    const created = !actor;
    if (!actor) {
      await this.options.ensureTaskCreationAllowed();
      this.options.ensureCapacity();
      const row = this.options.taskRow(taskId);
      if (!row.session_id) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "This task has no Grok session to resume.");
      const runtime = this.options.actorRuntime(row.project_id);
      if (row.grok_home_id !== runtime.grokHomeId) {
        throw new AppProblem(409, "GROK_HOME_MISMATCH", "Switch to the Grok Home that owns this task before resuming it.");
      }
      const existing = this.options.store.readDetail(taskId);
      if (!existing) throw new AppProblem(404, "NOT_FOUND", "Task not found.");
      actor = this.options.actorFactory(restoredActorOptions(row, existing, runtime));
      this.options.attach(actor);
    }
    try {
      if (actor.snapshot.connection !== "ready") await actor.resume();
      return actor;
    } catch (error) {
      if (created) { this.options.actors.delete(taskId); actor.stop(); }
      throw error;
    }
  }
}

function activationProblem(error: unknown, requestId: string): unknown {
  if (!(error instanceof AcpStageTimeoutError)) return error;
  return new AppProblem(
    504,
    "CAPABILITY_UNAVAILABLE",
    `Grok stopped because ${error.stage} did not complete within ${Math.ceil(error.timeoutMs / 1_000)} seconds. The requested operation was not dispatched.`,
    requestId,
  );
}
