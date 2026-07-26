import { z } from "zod";

const WorkModeSchema = z.enum(["normal", "plan"]);
export type WorkMode = z.infer<typeof WorkModeSchema>;
const TaskSubmissionModeSchema = z.enum(["prompt", "goal", "plan"]);
export type TaskSubmissionMode = z.infer<typeof TaskSubmissionModeSchema>;

const PermissionModeSchema = z.enum([
  "ask",
  "auto",
  "alwaysApprove",
  "acceptEdits",
  "dontAsk",
]);
export type TaskPermissionMode = z.infer<typeof PermissionModeSchema>;

const SandboxProfileSchema = z.enum([
  "off",
  "workspace",
  "readOnly",
  "strict",
  "custom",
]);
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;
const SystemPromptBodyShape = {
  rules: z.string().trim().max(100_000).default(""),
  systemPrompt: z.string().trim().max(100_000).default(""),
} as const;
const validateSystemPromptBody = (value: { rules: string; systemPrompt: string }, context: z.RefinementCtx) => {
  if (!value.systemPrompt && !value.rules) context.addIssue({ code: "custom", message: "System Prompt Override or Rules is required." });
};
const TaskSystemPromptSchema = z.object({
  presetId: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  ...SystemPromptBodyShape,
}).strict().superRefine(validateSystemPromptBody);
export type TaskSystemPrompt = z.infer<typeof TaskSystemPromptSchema>;
export const SystemPromptPresetSchema = z.object({
  presetId: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  ...SystemPromptBodyShape,
  pinned: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict().superRefine(validateSystemPromptBody);
export type SystemPromptPreset = z.infer<typeof SystemPromptPresetSchema>;
export const ReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

const TaskConnectionSchema = z.enum([
  "unloaded",
  "loading",
  "ready",
  "recovering",
  "failed",
]);
const TurnStateSchema = z.enum(["idle", "running", "cancelling"]);
export interface PermissionModeAvailability {
  mode: TaskPermissionMode;
  available: boolean;
  effective: boolean;
  hotSwitch: boolean;
  source: "acp" | "xai" | "config" | "policy" | "fallback";
  reason?: string;
  lockedBy?: string;
}

interface EffectivePermissionState {
  requested: TaskPermissionMode;
  effective: TaskPermissionMode;
  base?: "ask" | "acceptEdits" | "dontAsk";
  modes: PermissionModeAvailability[];
}

interface ImmutableSandboxState {
  requested: SandboxProfile;
  effective: SandboxProfile;
  locked: true;
  mechanism: "seatbelt" | "none";
  verified: boolean;
  source: "task-create" | "loaded-session";
  detail?: string;
}

interface PlanSnapshot {
  document: {
    content: string;
    fileName: string;
    updatedAt: string;
  } | null;
}

type TodoEntryStatus = "pending" | "inProgress" | "completed" | "failed" | "cancelled";
export type TodoGroupEndReason = "completed" | "superseded" | "cancelled" | "failed" | "interrupted" | null;

export interface TodoEntrySnapshot {
  id: string;
  content: string;
  status: TodoEntryStatus;
}

export interface TodoGroupSnapshot {
  groupId: string;
  planId: string | null;
  entries: TodoEntrySnapshot[];
  state: "active" | "archived";
  endReason: TodoGroupEndReason;
  createdAt: string;
  updatedAt: string;
}

export type WorkItemKind = "agent" | "task" | "monitor" | "loop";
export type WorkItemStatus = "unconfirmed" | "pending" | "running" | "completed" | "failed" | "cancelled";

export interface WorkItemSnapshot {
  id: string;
  kind: WorkItemKind;
  activityId: string | null;
  childSessionId: string | null;
  title: string | null;
  status: WorkItemStatus;
  currentActivity: string | null;
  outputTail: string | null;
  telemetry: WorkItemTelemetry | null;
  startedAt: string;
  updatedAt: string;
}

interface WorkItemTelemetry {
  agentType: string | null;
  role: string | null;
  modelId: string | null;
  contextSource: string | null;
  capabilityMode: string | null;
  resumedFrom: string | null;
  contextNormalized: boolean | null;
  turnCount: number | null;
  toolCallCount: number | null;
  errorCount: number | null;
  contextUsagePct: number | null;
  tokensUsed: number | null;
  durationMs: number | null;
  toolsUsed: string[];
  willWake: boolean | null;
}

export type ContextHistoryItem =
  | { id: string; turnId: string | null; kind: "todo"; occurredAt: string; status: TodoGroupEndReason; todo: TodoGroupSnapshot }
  | { id: string; turnId: string | null; kind: "work"; occurredAt: string; status: WorkItemStatus; work: WorkItemSnapshot }
  | { id: string; turnId: string | null; kind: "plan"; occurredAt: string; status: "active" | "inactive"; title: string };

export interface TaskOperationalContextSnapshot {
  currentTodo: TodoGroupSnapshot | null;
  activeWork: WorkItemSnapshot[];
  history: ContextHistoryItem[];
}

export interface ChildSessionDetail {
  sessionId: string;
  status: WorkItemStatus;
  transcriptAvailable: boolean;
  detail: TaskDetailProjection | null;
  reason: string | null;
}

interface PendingGateBase {
  gateId: string;
  title: string;
  risk: "low" | "medium" | "high" | "unknown";
  receivedAt: string;
  turnId: string;
  position: number;
  total: number;
  payload: unknown;
}

export interface QuestionPendingGate extends PendingGateBase {
  kind: "question";
}

export interface PermissionPendingGate extends PendingGateBase {
  kind: "permission";
}

export interface PlanReviewPendingGate extends PendingGateBase {
  kind: "planReview";
}

export const PlanReviewDraftIdentitySchema = z.object({
  gateId: z.string().min(1).max(256),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PlanReviewDraftIdentity = z.infer<typeof PlanReviewDraftIdentitySchema>;

export const PlanReviewDraftMutationSchema = PlanReviewDraftIdentitySchema.extend({
  requestId: z.string().uuid(),
  draft: z.string().max(100_000).nullable(),
}).strict();

export interface PlanReviewDraftSnapshot {
  draft: string | null;
  updatedAt: string | null;
}

export type ComposerPendingGate = PermissionPendingGate | QuestionPendingGate;
export type PendingGate = ComposerPendingGate | PlanReviewPendingGate;

export interface NativeQueueEntry {
  entryId: string | null;
  requestId: string;
  textPreview: string;
  version: number | null;
  position: number | null;
  createdAt: string;
}

interface NativeQueueSnapshot {
  available: boolean;
  runningEntryId: string | null;
  entries: NativeQueueEntry[];
}

interface ActivitySummary {
  batchId: string | null;
  running: number;
  /** Runtime work seen before the latest session/load but not confirmed afterward. */
  unconfirmed: number;
  waiting: number;
  failed: number;
  completed: number;
  newestActivityAt: string | null;
}

export interface TaskConfigOption {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options: Array<{ value: string; name: string; description: string | null }>;
}

export interface TaskCommandInfo {
  name: string;
  description: string;
  inputHint: string | null;
}

interface TaskCommandState {
  available: TaskCommandInfo[];
  execution: {
    requestId: string;
    name: string;
    state: "pending" | "confirmed" | "failed";
    message: string | null;
  } | null;
}

export interface TaskGoalState {
  status: "unknown" | "inactive" | "active" | "paused";
  lastOutcome: "completed" | "cleared" | "cancelled" | "failed" | "interrupted" | null;
  objective: string | null;
  /** Accumulated active runtime; updatedAt is the current clock checkpoint. */
  timeUsedSeconds: number;
  /** Goal lifecycle is projected only from Grok's official goal_updated update. */
  source: "none" | "native";
  updatedAt: string | null;
  telemetry: TaskGoalTelemetry | null;
}

export interface TaskGoalTelemetry {
  goalId: string | null; phase: string | null;
  tokensUsed: number; tokenBudget: number | null; tokenBaseline: number;
  finishedSubagentTokens: number; liveSubagentTokens: number | null; contextUsagePct: number | null;
  turnCount: number | null; toolCallCount: number | null;
  tokensByModel: Array<{ modelId: string; tokens: number }>;
  totalDeliverables: number; completedDeliverables: number;
  workerRounds: number; verifyRounds: number;
  classifierRuns: number; classifierMaxRuns: number; verifyingCompletion: boolean;
  classifierVerdict: string | null;
  planning: boolean; lastEvent: string | null;
  lastEventDetail: string | null; lastEventAt: string | null;
}

export interface TaskContextWindowUsage {
  usedTokens: number;
  totalTokens: number;
  percentage: number;
  updatedAt: string;
}

export interface TaskContinuationOrigin {
  taskId: string;
  sessionId: string;
  title: string;
  ordinal: number;
  /** Last visible block inherited from the source task; the divider follows it. */
  boundaryBlockId: string | null;
}

export interface TaskSnapshot {
  taskId: string;
  projectId: string;
  /** Stable identity of the Grok Home that owns the native session. */
  grokHomeId: string;
  sessionId: string | null;
  title: string;
  connection: z.infer<typeof TaskConnectionSchema>;
  turn: z.infer<typeof TurnStateSchema>;
  /** The one PromptExecution currently owned by the live runtime, never inferred from transcript shape. */
  currentPromptExecutionId: string | null;
  workMode: WorkMode;
  permission: EffectivePermissionState;
  sandbox: ImmutableSandboxState;
  /** Frozen selection used when this native Grok session was created. */
  systemPrompt?: TaskSystemPrompt | null;
  continuedFrom?: TaskContinuationOrigin | null;
  plan: PlanSnapshot;
  goal: TaskGoalState;
  contextWindow: TaskContextWindowUsage | null;
  gates: PendingGate[];
  queue: NativeQueueSnapshot;
  activities: ActivitySummary;
  modelId: string | null;
  effort: ReasoningEffort | null;
  configOptions: TaskConfigOption[];
  commands: TaskCommandState;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Changes whenever a disk or live projection starts a new revision sequence. */
  projectionEpoch: string;
  revision: number;
}

export type TaskEventSource = "acp" | "xai" | "cli" | "config" | "supervisor";

export interface TaskEventEnvelope<T = unknown> {
  eventId: string;
  taskId: string;
  turnId: string | null;
  connectionEpoch: number;
  sequence: number;
  source: TaskEventSource;
  method: string;
  occurredAt: string;
  payload: T;
}

/** Stable ordering coordinates inside one ACP connection epoch. */
export interface TaskEventCursor {
  connectionEpoch: number;
  sequence: number;
}

/** Raw-protocol coordinates for the visible message hierarchy. */
export interface TaskMessageProtocolIdentity {
  /** One submitted prompt, including every native continuation and Interject. */
  promptExecutionId: string;
  /** Grok-native Turn identity. A new promptId starts a new NativeTurn. */
  promptId?: string;
  turnStartMs?: number;
  /** A distinct streamStartMs is a distinct ModelPass inside the NativeTurn. */
  streamStartMs?: number;
  /** Advertised messageId, or a deterministic ID derived from the coordinates above. */
  messageId: string;
  /** Native rewind point attached to a user prompt replay. */
  promptIndex?: number;
  /** True only for an accepted native Interject inside the same PromptExecution. */
  interjection?: boolean;
}

export interface TaskMessageBlock {
  blockId: string;
  /** The ACP block identity when one was advertised; blockId remains a unique UI segment identity. */
  sourceBlockId?: string;
  role: "user" | "assistant" | "thought";
  text: string;
  turnId: string;
  requestId?: string;
  /** Local user prompts stay pending until Grok echoes or completes the exact request. */
  delivery?: "pending" | "unknown" | "accepted" | "failed";
  streaming: boolean;
  createdAt: string;
  /** Authoritative zero-based record position in an official session transcript. */
  sourceOrdinal?: number;
  firstEvent?: TaskEventCursor;
  lastEvent?: TaskEventCursor;
  paths?: PathReferenceSummary[];
  media?: TaskMediaAttachment[];
  /** Rehydratable input nodes used by Edit in Composer and exact failed-message retry. */
  composerDocument?: ComposerReplayDocument;
  /** Protocol identity is kept separate from the UI blockId and local correlation turnId. */
  protocol?: TaskMessageProtocolIdentity;
}

type TaskMediaKind = "image" | "audio" | "video";

/** A browser-safe description of media owned by the backend artifact store. */
export interface TaskMediaAttachment {
  mediaId: string;
  /** Identifies this appearance independently from the underlying media bytes. */
  placementId: string;
  kind: TaskMediaKind;
  mimeType: string;
  name: string;
  sizeBytes: number;
  source: "acp" | "local" | "remote";
  /** How this placement entered rich text; structured ACP/PathNode media has no prose syntax. */
  syntax?: "explicit" | "bare" | "structured";
  /** Present only when a structured Composer PathNode created this placement. */
  pathRefId?: string;
  /** Text coordinates for local media; no filesystem path crosses this boundary. */
  anchor?: { start: number; end: number; sourceStart?: number; sourceEnd?: number };
}

export interface TaskMediaLease {
  ticket: string;
  expiresAt: string;
  path?: PathReferenceSummary;
}

const PathReferenceKindSchema = z.enum(["code", "image", "document", "sheet", "archive", "media", "folder", "generic"]);
export type PathReferenceKind = z.infer<typeof PathReferenceKindSchema>;

export const PathReferenceSummarySchema = z.object({
  refId: z.string().uuid(),
  name: z.string().min(1).max(512),
  displayPath: z.string().min(1).max(4_096),
  serializedPath: z.string().min(1).max(8_192),
  sizeBytes: z.number().int().nonnegative(),
  kind: PathReferenceKindSchema,
  withinProject: z.boolean(),
  valid: z.boolean(),
  isDirectory: z.boolean(),
});
export type PathReferenceSummary = z.infer<typeof PathReferenceSummarySchema>;

const ComposerReplayNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(200_000) }),
  z.object({ type: z.literal("path"), path: PathReferenceSummarySchema }),
]);

const ComposerReplayDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(ComposerReplayNodeSchema).min(1),
}).superRefine((document, context) => {
  const textLength = document.nodes.reduce((total, node) => total + (node.type === "text" ? node.text.length : 0), 0);
  if (textLength > 200_000) context.addIssue({ code: "custom", message: "Composer replay text is too long." });
});
export type ComposerReplayDocument = z.infer<typeof ComposerReplayDocumentSchema>;

const PathReferenceInputSchema = z.object({
  refId: z.string().uuid(),
});

const ComposerInputNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(200_000) }),
  z.object({ type: z.literal("path"), refId: z.string().uuid() }),
]);

export const ComposerInputDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(ComposerInputNodeSchema).min(1),
}).superRefine((document, context) => {
  const textLength = document.nodes.reduce((total, node) => total + (node.type === "text" ? node.text.length : 0), 0);
  if (textLength > 200_000) context.addIssue({ code: "custom", message: "Composer text is too long." });
});
export type ComposerInputDocument = z.infer<typeof ComposerInputDocumentSchema>;

export interface TaskDetailProjection {
  snapshot: TaskSnapshot;
  messages: TaskMessageBlock[];
  events: TaskEventEnvelope[];
  context: TaskOperationalContextSnapshot;
}

/**
 * Ordered renderer-facing frames from the one authoritative task projection.
 * Snapshot frames establish structure. Delta frames replace only changed
 * messages/events while carrying the current small task/context projections.
 * The official Session remains the sole source for both forms.
 */
export type TaskProjectionFrame =
  | {
      kind: "snapshot";
      detail: TaskDetailProjection;
    }
  | {
      kind: "delta";
      snapshot: TaskSnapshot;
      context: TaskOperationalContextSnapshot;
      messageCount: number;
      messages: Array<{
        index: number;
        message: TaskMessageBlock;
      }>;
      eventCount: number;
      events: Array<{
        index: number;
        event: TaskEventEnvelope;
      }>;
    };

export const NewTaskDraftKeySchema = z.string().regex(/^new:project_[a-f0-9]{24}(?::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i);

export const TaskCreateSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().min(1).max(128),
  modelId: z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,256}$/).nullable().optional(),
  effort: ReasoningEffortSchema.nullable().optional(),
  workMode: WorkModeSchema.default("normal"),
  permission: PermissionModeSchema,
  sandbox: SandboxProfileSchema.default("off"),
  systemPrompt: TaskSystemPromptSchema.nullable().default(null),
  draftKey: NewTaskDraftKeySchema.optional(),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskResumeSchema = z.object({
  requestId: z.string().uuid(),
});

export const TaskPromptSchema = z.object({
  requestId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(200_000),
  paths: z.array(PathReferenceInputSchema).default([]),
  document: ComposerInputDocumentSchema.optional(),
  submissionMode: TaskSubmissionModeSchema.default("prompt"),
});

export const TaskRewindAndPromptSchema = TaskPromptSchema.extend({
  targetPromptIndex: z.number().int().nonnegative(),
  sourceBlockId: z.string().min(1).max(2_048),
  submissionMode: z.literal("prompt").default("prompt"),
});

export const TaskForkSchema = z.object({
  requestId: z.string().uuid(),
  sandbox: SandboxProfileSchema.optional(),
  systemPrompt: TaskSystemPromptSchema.nullable().optional(),
}).strict();
export type TaskFork = z.infer<typeof TaskForkSchema>;

export const TaskQueueSubmitSchema = TaskPromptSchema.omit({ submissionMode: true }).extend({
  requestId: z.string().uuid(),
});

export const TaskInterjectSchema = z.object({
  requestId: z.string().uuid(),
  text: z.string().trim().min(1).max(200_000),
});

export const QueueMutationSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["remove", "reorder", "edit", "interject", "clear"]),
  entryId: z.string().min(1).max(256).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative().optional(),
  text: z.string().trim().min(1).max(200_000).optional(),
});

export const TaskConfigMutationSchema = z.object({
  requestId: z.string().uuid(),
  configId: z.string().min(1).max(256),
  value: z.union([z.string().min(1).max(256), z.boolean()]),
});

export const TaskCommandMutationSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,127}$/i),
  input: z.string().max(20_000).default(""),
});

export const TaskGoalMutationSchema = z.discriminatedUnion("action", [
  z.object({ requestId: z.string().uuid(), action: z.literal("set"), objective: z.string().trim().min(1).max(20_000) }).strict(),
  z.object({ requestId: z.string().uuid(), action: z.enum(["status", "pause", "resume", "clear"]) }).strict(),
]);
export type TaskGoalMutation = z.infer<typeof TaskGoalMutationSchema>;
export type TaskGoalAction = TaskGoalMutation["action"];

export const TaskWorkModeMutationSchema = z.object({
  requestId: z.string().uuid(),
  mode: z.literal("normal"),
}).strict();

export const TaskWorkStopSchema = z.object({
  requestId: z.string().uuid(),
  workItemId: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();
export type TaskWorkStop = z.infer<typeof TaskWorkStopSchema>;

export const GateDecisionSchema = z.object({
  requestId: z.string().uuid(),
  gateId: z.string().min(1).max(256),
  action: z.enum(["submit", "skip"]),
  value: z.unknown().optional(),
});
export type GateDecision = z.infer<typeof GateDecisionSchema>;

export const ProjectMutationSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().min(1).max(128),
});

export const ProjectDefaultsSchema = z.object({
  modelId: z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,256}$/).nullable(),
  effort: ReasoningEffortSchema.nullable(),
  permission: PermissionModeSchema,
  sandbox: SandboxProfileSchema,
  systemPromptPresetId: z.string().uuid().nullable().default(null),
});
export type ProjectDefaults = z.infer<typeof ProjectDefaultsSchema>;

export const ProjectDefaultsMutationSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().min(1).max(128),
  defaults: ProjectDefaultsSchema,
});

export const SystemPromptPresetSaveSchema = z.object({
  requestId: z.string().uuid(),
  preset: z.object({
    presetId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(80),
    ...SystemPromptBodyShape,
    pinned: z.boolean().optional(),
  }).strict().superRefine(validateSystemPromptBody),
}).strict();
export type SystemPromptPresetSave = z.infer<typeof SystemPromptPresetSaveSchema>;

export const SystemPromptPresetDeleteSchema = z.object({
  requestId: z.string().uuid(),
  presetId: z.string().uuid(),
}).strict();

export interface ProjectSummary {
  projectId: string;
  name: string;
  displayPath: string;
  active: boolean;
  taskCount: number;
  updatedAt: string;
  defaults: ProjectDefaults;
}

export interface TaskListItem {
  taskId: string;
  projectId: string;
  sessionId: string | null;
  /** Directly reported by the official Session transcript/summary. */
  hasUserTurn: boolean;
  title: string;
  status: string;
  active: boolean;
  /** True only while an official foreground turn can be cancelled. */
  canStop: boolean;
  needsAttention: boolean;
  pinned: boolean;
  archived: boolean;
  agentState: "unloaded" | "idle" | "running" | "detached" | "gate" | "failed";
  naturalStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSearchResult {
  task: TaskListItem;
  projectName: string;
  match: "title" | "prompt";
  excerpt: string | null;
}

export interface WorkspaceProjection {
  projects: ProjectSummary[];
  tasks: TaskListItem[];
  systemPromptPresets: SystemPromptPreset[];
  supervisor: {
    activeAgents: number;
    softLimit: number;
    hardLimit: number;
    maxAgents: number;
    maxAllowed: 16;
    idleRetirementMinutes: number;
    permissionModes: Array<{
      mode: TaskPermissionMode;
      available: boolean;
      reason?: string;
      lockedBy?: string;
    }>;
  };
}

export const SupervisorSettingsMutationSchema = z.object({
  requestId: z.string().uuid(),
  settings: z.object({
    softLimit: z.number().int().min(1).max(14),
    hardLimit: z.number().int().min(2).max(15),
    maxAgents: z.number().int().min(3).max(16),
    idleRetirementMinutes: z.number().int().min(1).max(60),
  }).refine((value) => value.softLimit < value.hardLimit && value.hardLimit < value.maxAgents, {
    message: "Supervisor limits must satisfy soft < hard < max.",
  }),
});
