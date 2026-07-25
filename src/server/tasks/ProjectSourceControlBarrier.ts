import type { ProjectStore } from "../projects/ProjectStore.js";
import { AppProblem } from "../security/problemResponse.js";
import type { TaskActor } from "./TaskActor.js";
import type { TaskStore } from "./TaskStore.js";
import { projectSourceControlLocked } from "./supervisorPoolPolicy.js";

export class ProjectSourceControlBarrier {
  readonly #sourceControlWriteLeases = new Set<string>();
  readonly #projectRuntimeIntents = new Map<string, number>();

  constructor(
    private readonly projects: ProjectStore,
    private readonly actors: Map<string, TaskActor>,
    private readonly store: TaskStore,
  ) {}

  writeLockedMany(projectIds: readonly string[]): boolean {
    return this.#projectIds(projectIds).some((projectId) => this.#writeLocked(projectId));
  }

  #writeLocked(projectId: string): boolean {
    const storedSnapshots = this.store.rows().flatMap((row) => {
      if (this.actors.has(row.task_id)) return [];
      const detail = this.store.readDetail(row.task_id);
      return detail ? [detail.snapshot] : [];
    });
    return (this.#projectRuntimeIntents.get(projectId) ?? 0) > 0
      || projectSourceControlLocked(this.actors, storedSnapshots, projectId);
  }

  async withWriteLeases<T>(projectIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const ids = this.#projectIds(projectIds);
    if (ids.some((projectId) => this.#writeLocked(projectId))) {
      throw new AppProblem(409, "TASK_BUSY", "Source Control writes are locked while this Project has a running turn, Gate, background task, or Goal.");
    }
    if (ids.some((projectId) => this.#sourceControlWriteLeases.has(projectId))) {
      throw new AppProblem(409, "TASK_BUSY", "Another Source Control write is already running for this Project.");
    }
    for (const projectId of ids) this.#sourceControlWriteLeases.add(projectId);
    try {
      return await operation();
    } finally {
      for (const projectId of ids) this.#sourceControlWriteLeases.delete(projectId);
    }
  }

  async withRuntimeIntent<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#sourceControlWriteLeases.has(projectId)) {
      throw new AppProblem(409, "TASK_BUSY", "Wait for the current Source Control write before starting Project work.");
    }
    this.#projectRuntimeIntents.set(projectId, (this.#projectRuntimeIntents.get(projectId) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = (this.#projectRuntimeIntents.get(projectId) ?? 1) - 1;
      if (remaining > 0) this.#projectRuntimeIntents.set(projectId, remaining);
      else this.#projectRuntimeIntents.delete(projectId);
    }
  }

  #projectIds(projectIds: readonly string[]): string[] {
    const ids = [...new Set(projectIds)].sort();
    if (!ids.length) {
      throw new AppProblem(400, "VALIDATION_FAILED", "At least one Project is required for a Source Control write.");
    }
    for (const projectId of ids) this.projects.get(projectId);
    return ids;
  }
}
