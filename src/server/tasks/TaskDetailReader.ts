import type { TaskDetailProjection } from "../../shared/contracts.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { ProjectStore } from "../projects/ProjectStore.js";
import type { TaskRow } from "./TaskStore.js";
import { AppProblem } from "../security/problemResponse.js";
import { refreshTaskContextWindow } from "./taskContextWindow.js";
import type { TaskStore } from "./TaskStore.js";

interface TaskDetailReaderOptions {
  store: TaskStore;
  projects: ProjectStore;
  grokHome: string;
  media: MediaArtifactStore;
}

/** Reads official task projections and reattaches local media authority. */
export class TaskDetailReader {
  constructor(private readonly options: TaskDetailReaderOptions) {
    options.media.reconcilePersisted(options.store.mediaReferencesByTask());
  }

  parent(row: TaskRow): TaskDetailProjection {
    const detail = this.#restore(row);
    const projectPath = this.options.projects.getCanonicalPath(row.project_id);
    refreshTaskContextWindow(detail.snapshot, this.options.grokHome, projectPath);
    this.options.media.hydrateMessages(
      row.task_id,
      projectPath,
      detail.messages,
      { grokHome: this.options.grokHome, sessionId: row.session_id },
    );
    return detail;
  }

  child(row: TaskRow, childSessionId: string) {
    const parent = this.#restore(row);
    const detail = this.options.store.readChildDetail(row.task_id, childSessionId);
    const item = [...parent.context.activeWork, ...parent.context.history.flatMap((entry) => entry.kind === "work" ? [entry.work] : [])]
      .find((entry) => entry.childSessionId === childSessionId || entry.id === childSessionId);
    if (detail) this.options.media.hydrateMessages(
      row.task_id,
      this.options.projects.getCanonicalPath(row.project_id),
      detail.messages,
      { grokHome: this.options.grokHome, sessionId: childSessionId },
    );
    return {
      sessionId: childSessionId,
      status: item?.status || "unconfirmed",
      transcriptAvailable: Boolean(detail),
      detail,
      reason: detail ? null : "No structured child transcript is available yet.",
    };
  }

  #restore(row: TaskRow): TaskDetailProjection {
    const detail = this.options.store.readDetail(row.task_id);
    if (!detail) throw new AppProblem(404, "NOT_FOUND", "Task not found.");
    return detail;
  }
}
