import type { ProjectSummary, SystemPromptPreset, TaskListItem, WorkspaceProjection } from "../../shared/contracts.js";

export function workspaceProjection(
  projects: ProjectSummary[],
  tasks: TaskListItem[],
  systemPromptPresets: SystemPromptPreset[],
  supervisor: WorkspaceProjection["supervisor"],
): WorkspaceProjection {
  return { projects, tasks, systemPromptPresets, supervisor };
}
