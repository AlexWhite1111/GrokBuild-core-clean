import {
  DEFAULT_UI_PREFERENCES,
  SavedContextResourceSchema,
  TaskScrollAnchorSchema,
  UiPreferencesSchema,
  type DraftSnapshot,
  type TaskUiState,
  type UiPreferences,
} from "../../shared/contracts.js";
import type { JsonStateStore } from "./JsonStateStore.js";

export class UiStateStore {
  constructor(private readonly state: JsonStateStore) {}

  preferences(): UiPreferences {
    const stored = this.state.get<Record<string, unknown>>("ui.preferences");
    const parsed = UiPreferencesSchema.safeParse(stored);
    if (!parsed.success) return { ...DEFAULT_UI_PREFERENCES };
    if (stored?.cornerRadius === undefined && stored?.cornerScale !== undefined) {
      this.state.set("ui.preferences", parsed.data);
    }
    return parsed.data;
  }

  savePreferences(preferences: UiPreferences): UiPreferences {
    const value = UiPreferencesSchema.parse(preferences);
    this.state.set("ui.preferences", value);
    return value;
  }

  taskState(taskId: string): TaskUiState {
    const value = this.state.get<Record<string, unknown>>(`task.ui.${taskId}`);
    const anchor = TaskScrollAnchorSchema.safeParse(value?.scrollAnchor);
    return {
      scrollAnchor: anchor.success ? anchor.data : null,
      contextOpen: value?.contextOpen === true,
      contextResources: savedContextResources(value?.contextResources),
      contextSection: value?.contextSection === "work" || value?.contextSection === "context" ? value.contextSection : "planning",
    };
  }

  saveTaskState(taskId: string, patch: Partial<TaskUiState>): TaskUiState {
    const current = this.taskState(taskId);
    const next = {
      scrollAnchor: patch.scrollAnchor === undefined ? current.scrollAnchor : patch.scrollAnchor,
      contextOpen: patch.contextOpen ?? current.contextOpen,
      contextResources: patch.contextResources ?? current.contextResources,
      contextSection: patch.contextSection ?? current.contextSection,
    };
    this.state.set(`task.ui.${taskId}`, next);
    return next;
  }

  deleteTaskState(taskId: string): void {
    this.state.delete(`task.ui.${taskId}`);
    this.state.delete(`draft.task:${taskId}`);
  }

  draft(key: string): DraftSnapshot {
    return { document: this.state.get<string>(`draft.${key}`) || null };
  }

  saveDraft(key: string, document: string | null): DraftSnapshot {
    if (document) this.state.set(`draft.${key}`, document);
    else this.state.delete(`draft.${key}`);
    return { document };
  }

  transferDraft(fromKey: string, toKey: string): DraftSnapshot {
    const document = this.state.get<string>(`draft.${fromKey}`) || null;
    if (document) this.state.set(`draft.${toKey}`, document);
    this.state.delete(`draft.${fromKey}`);
    return { document };
  }
}

function savedContextResources(value: unknown): TaskUiState["contextResources"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = SavedContextResourceSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 1_024);
}
