import type {
  CapabilitySnapshot,
  ComposerInputDocument,
  ComposerReplayDocument,
  PathReferenceSummary,
  ReasoningEffort,
  RichTextRenderPolicy,
  SandboxProfile,
  TaskCommandInfo,
  TaskConfigOption,
  TaskContextWindowUsage,
  TaskGoalState,
  TaskSystemPrompt,
  TaskPermissionMode,
  UiPreferences,
  WorkspaceProjection,
} from "../../shared/contracts.js";

export interface ComposerSettings {
  modelId: string | null;
  effort: ReasoningEffort | null;
  permission: TaskPermissionMode;
  sandbox: SandboxProfile;
  systemPrompt: TaskSystemPrompt | null;
}

interface ComposerReplacementTarget {
  targetPromptIndex: number;
  sourceBlockId: string;
}

export interface ComposerSubmitOptions {
  mode: "prompt" | "goal" | "plan";
  replacement?: ComposerReplacementTarget;
}

export type ComposerGoalAction =
  | { action: "set"; objective: string }
  | { action: "pause" | "resume" | "clear" };

export interface ComposerProps {
  settings: ComposerSettings;
  onSettingsChange: (settings: ComposerSettings) => void;
  onSend: (text: string, paths: PathReferenceSummary[], document: ComposerInputDocument, options: ComposerSubmitOptions) => Promise<boolean | void> | boolean | void;
  onQueue?: (text: string, paths: PathReferenceSummary[], document: ComposerInputDocument, options: ComposerSubmitOptions) => Promise<boolean | void> | boolean | void;
  onInterject?: (text: string, paths: PathReferenceSummary[], document: ComposerInputDocument, options: ComposerSubmitOptions) => Promise<boolean | void> | boolean | void;
  onStop?: () => Promise<void> | void;
  commands?: TaskCommandInfo[];
  busy?: boolean;
  queueAvailable?: boolean;
  interjectAvailable?: boolean;
  disabled?: boolean;
  permissionLocked?: boolean;
  planActive?: boolean;
  onExitPlanMode?: () => Promise<void> | void;
  activeGoal?: TaskGoalState;
  contextWindow?: TaskContextWindowUsage | null;
  showContextUsage?: boolean;
  onGoalAction?: (input: ComposerGoalAction) => Promise<boolean | void> | boolean | void;
  pendingPermission?: TaskPermissionMode | null;
  waiting?: boolean;
  taskConfigOptions?: TaskConfigOption[];
  modelChoices?: Array<{ id: string; name?: string | null }>;
  projectLabel: string;
  onChooseProject?: () => void;
  capabilities: CapabilitySnapshot;
  permissionModes: WorkspaceProjection["supervisor"]["permissionModes"];
  systemPromptPresets: WorkspaceProjection["systemPromptPresets"];
  onManageSystemPrompts?: () => void;
  initialDraft?: string;
  draftKey?: string;
  projectId?: string;
  renderPolicy?: RichTextRenderPolicy;
  mediaPreviewScale?: number;
  sendShortcut?: UiPreferences["sendShortcut"];
  replacementDraft?: {
    id: string;
    sourceCreatedAt: string;
    targetPromptIndex: number;
    sourceBlockId: string;
    document: ComposerReplayDocument;
  } | null;
  onReplacementApplied?: (id: string) => void;
  onDraftStateChange?: (hasContent: boolean) => void;
}
