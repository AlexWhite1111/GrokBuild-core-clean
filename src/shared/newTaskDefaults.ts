import type {
  ProjectDefaults,
  SystemPromptPreset,
  TaskCreate,
  TaskPermissionMode,
  WorkspaceProjection,
} from "./contracts.js";

type PermissionModeAvailability =
  WorkspaceProjection["supervisor"]["permissionModes"][number];

/**
 * Resolve a saved new-task preference against current verified capabilities.
 * This never mutates the saved preference; a temporary capability gap may
 * affect one new Session, not future defaults.
 */
export function resolveNewTaskPermission(
  saved: TaskPermissionMode,
  modes: readonly PermissionModeAvailability[],
): TaskPermissionMode {
  return modes.some((mode) => mode.mode === saved && mode.available)
    ? saved
    : "ask";
}

export function resolveNewTaskDefaults(
  saved: ProjectDefaults,
  modes: readonly PermissionModeAvailability[],
  grokDefaultModel: string | null,
  presets: readonly SystemPromptPreset[],
): Pick<
  TaskCreate,
  "modelId" | "effort" | "permission" | "sandbox" | "systemPrompt"
> {
  const preset = presets.find((item) =>
    item.presetId === saved.systemPromptPresetId);
  return {
    modelId: saved.modelId || grokDefaultModel,
    effort: saved.effort,
    permission: resolveNewTaskPermission(saved.permission, modes),
    sandbox: saved.sandbox,
    systemPrompt: preset ? {
      presetId: preset.presetId,
      title: preset.title,
      rules: preset.rules,
      systemPrompt: preset.systemPrompt,
    } : null,
  };
}
