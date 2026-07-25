import { randomUUID } from "node:crypto";
import type {
  ComposerReplayDocument,
  PathReferenceSummary,
  TaskCreate,
  TaskFork,
  TaskSnapshot,
  TaskSubmissionMode,
  WorkspaceProjection,
} from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskActor } from "./TaskActor.js";
import type { TaskActivationCoordinator } from "./TaskActivationCoordinator.js";
import type { TaskRow, TaskStore } from "./TaskStore.js";
import { buildForkContinuation, sameTaskSystemPrompt } from "./taskSystemPrompt.js";

export class TaskHistoryCoordinator {
  readonly #receipts = new Map<string, { action: string; taskId: string }>();

  constructor(private readonly options: {
    store: TaskStore;
    actors: Map<string, TaskActor>;
    activation: TaskActivationCoordinator;
    taskRow(taskId: string): TaskRow;
    workspace(): WorkspaceProjection;
    publish(event: "task.retired" | "task.created" | "workspace.changed", payload: unknown): void;
  }) {}

  async rewindAndPrompt(
    taskId: string,
    requestId: string,
    targetPromptIndex: number,
    sourceBlockId: string,
    transportPrompt: string,
    displayPrompt = transportPrompt,
    paths: PathReferenceSummary[] = [],
    mode: TaskSubmissionMode = "prompt",
    composerDocument?: ComposerReplayDocument,
  ): Promise<TaskSnapshot> {
    this.#claim(requestId, "rewind", taskId);
    const actor = await this.options.activation.intentActor(taskId, requestId);
    const source = actor.detail.messages.find((message) =>
      message.role === "user"
      && message.blockId === sourceBlockId
      && message.protocol?.promptIndex === targetPromptIndex);
    if (!source?.firstEvent) {
      throw new AppProblem(409, "REWIND_POINT_STALE", "The selected message no longer maps to the requested native Rewind point.");
    }
    await actor.rewindTo(targetPromptIndex);
    actor.stop();
    this.options.actors.delete(taskId);
    this.options.activation.forgetTask(taskId);
    this.options.publish("task.retired", { taskId, reason: "rewind" });
    try {
      const resumed = await this.options.activation.intentActor(taskId, requestId);
      return await resumed.submit(requestId, transportPrompt, paths, displayPrompt, mode, composerDocument);
    } catch (error) {
      throw new AppProblem(
        502,
        "REWIND_APPLIED_PROMPT_FAILED",
        `The official Rewind was applied, but the replacement prompt was not confirmed: ${errorText(error)}`,
        requestId,
      );
    }
  }

  async fork(taskId: string, input: TaskFork): Promise<TaskSnapshot> {
    this.#claim(input.requestId, "fork", taskId);
    const sourceRow = this.options.taskRow(taskId);
    const source = await this.options.activation.intentActor(taskId, input.requestId);
    source.assertForkReady();
    const targetSandbox = input.sandbox ?? source.snapshot.sandbox.requested;
    const targetSystemPrompt = Object.hasOwn(input, "systemPrompt")
      ? input.systemPrompt ?? null
      : source.snapshot.systemPrompt ?? null;
    const configured = targetSandbox !== source.snapshot.sandbox.requested
      || !sameTaskSystemPrompt(targetSystemPrompt, source.snapshot.systemPrompt);

    let child: TaskActor;
    if (configured) {
      const branchInput: TaskCreate = {
        requestId: input.requestId,
        projectId: source.snapshot.projectId,
        modelId: source.snapshot.modelId,
        effort: source.snapshot.effort,
        workMode: source.snapshot.workMode,
        permission: source.snapshot.permission.requested,
        sandbox: targetSandbox,
        systemPrompt: targetSystemPrompt,
      };
      child = await this.options.activation.createSessionBranch(
        randomUUID(),
        branchInput,
        buildForkContinuation(source.detail.messages),
      );
    } else {
      const receipt = await source.forkNativeSession();
      child = await this.options.activation.activate(receipt.newSessionId);
    }

    const ordinal = this.options.store.nextForkOrdinal(taskId);
    const childId = child.snapshot.sessionId || child.snapshot.taskId;
    const title = forkTitle(sourceRow.title, ordinal);
    child.rename(title);
    try { this.options.store.rename(childId, title); } catch { /* official title can arrive on the next scan */ }
    this.options.publish("task.created", child.detail);
    this.options.publish("workspace.changed", this.options.workspace());
    return child.snapshot;
  }

  #claim(requestId: string, action: string, taskId: string): void {
    const prior = this.#receipts.get(requestId);
    if (prior && (prior.action !== action || prior.taskId !== taskId)) {
      throw new AppProblem(409, "IDEMPOTENCY_CONFLICT", "The requestId belongs to a different task mutation.", requestId);
    }
    this.#receipts.set(requestId, { action, taskId });
  }
}

function forkTitle(value: string, ordinal: number): string {
  const suffix = ` · Fork ${ordinal}`;
  return `${value.slice(0, Math.max(1, 160 - suffix.length)).trimEnd()}${suffix}`;
}

function errorText(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, 500);
}
