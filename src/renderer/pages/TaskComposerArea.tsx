import type { ComponentProps, RefObject } from "react";
import type {
  ComposerInputDocument,
  ComposerReplayDocument,
  ComposerPendingGate,
  GateDecision,
  NativeQueueEntry,
  PathReferenceSummary,
  RichTextRenderPolicy,
  TaskSnapshot,
} from "../../shared/contracts.js";
import { Composer, type ComposerGoalAction, type ComposerSettings, type ComposerSubmitOptions } from "../composer/Composer.js";
import { ComposerStack } from "../composer/ComposerStack.js";
import { ComposerTakeover } from "../composer/ComposerTakeover.js";
import { NativeQueue } from "../composer/NativeQueue.js";
import { Notice } from "../../ui/components/index.js";
import styles from "./TaskPage.module.css";

type ComposerCapabilities = ComponentProps<typeof Composer>["capabilities"];
type ComposerPermissionModes =
  ComponentProps<typeof Composer>["permissionModes"];
type ComposerConfigOptions =
  ComponentProps<typeof Composer>["taskConfigOptions"];
type ComposerCommands = ComponentProps<typeof Composer>["commands"];
type ComposerSendShortcut = ComponentProps<typeof Composer>["sendShortcut"];

interface TaskComposerAreaProps {
  stackRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
  error: string | null;
  queue: TaskSnapshot["queue"];
  goal: TaskSnapshot["goal"];
  contextWindow: TaskSnapshot["contextWindow"];
  gates: TaskSnapshot["gates"];
  currentGate?: ComposerPendingGate;
  taskId: string;
  projectId: string;
  projectLabel: string;
  settings: ComposerSettings;
  commands: ComposerCommands;
  configOptions: ComposerConfigOptions;
  capabilities: ComposerCapabilities;
  permissionModes: ComposerPermissionModes;
  systemPromptPresets: ComponentProps<typeof Composer>["systemPromptPresets"];
  renderPolicy: RichTextRenderPolicy;
  mediaPreviewScale: number;
  sendShortcut: ComposerSendShortcut;
  showContextUsage: boolean;
  busy: boolean;
  waiting: boolean;
  pendingPermission: TaskSnapshot["permission"]["effective"] | null;
  queueAvailable: boolean;
  interjectAvailable: boolean;
  permissionLocked: boolean;
  planActive: boolean;
  connection: TaskSnapshot["connection"];
  onSettingsChange: (settings: ComposerSettings) => void;
  onGoalAction: (input: ComposerGoalAction) => Promise<boolean | void> | boolean | void;
  onSend: (
    prompt: string,
    paths: PathReferenceSummary[],
    document: ComposerInputDocument,
    options: ComposerSubmitOptions,
  ) => Promise<boolean | void> | boolean | void;
  onQueue: (
    prompt: string,
    paths: PathReferenceSummary[],
    document: ComposerInputDocument,
  ) => Promise<boolean | void> | boolean | void;
  onInterject: (
    prompt: string,
    paths: PathReferenceSummary[],
    document: ComposerInputDocument,
  ) => Promise<boolean | void> | boolean | void;
  onStop: () => Promise<void> | void;
  onGateDecision: (decision: GateDecision) => unknown | Promise<unknown>;
  onQueueMutation: (
    action: "remove" | "reorder" | "edit" | "interject",
    entry: NativeQueueEntry,
    extra?: { text?: string; position?: number },
  ) => Promise<void>;
  onChooseProject?: () => void;
  onManageSystemPrompts?: () => void;
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

export function TaskComposerArea({
  stackRef,
  composerRef,
  error,
  queue,
  goal,
  contextWindow,
  gates,
  currentGate,
  taskId,
  projectId,
  projectLabel,
  settings,
  commands,
  configOptions,
  capabilities,
  permissionModes,
  systemPromptPresets,
  renderPolicy,
  mediaPreviewScale,
  sendShortcut,
  showContextUsage,
  busy,
  waiting,
  pendingPermission,
  queueAvailable,
  interjectAvailable,
  permissionLocked,
  planActive,
  connection,
  onSettingsChange,
  onGoalAction,
  onSend,
  onQueue,
  onInterject,
  onStop,
  onGateDecision,
  onQueueMutation,
  onChooseProject,
  onManageSystemPrompts,
  replacementDraft,
  onReplacementApplied,
  onDraftStateChange,
}: TaskComposerAreaProps) {
  return (
    <div ref={stackRef} className={styles.composerArea}>
      <ComposerStack>
        {error && (
          <Notice
            tone="danger"
            density="compact"
            role="alert"
            className={styles.error}
          >
            {error}
          </Notice>
        )}
        <NativeQueue
          entries={queue.entries}
          gateActive={gates.length > 0}
          onEdit={(entry, text) => onQueueMutation("edit", entry, { text })}
          onRemove={(entry) => onQueueMutation("remove", entry)}
          onReorder={(entry, position) =>
            onQueueMutation("reorder", entry, { position })
          }
          onSendNow={(entry) => onQueueMutation("interject", entry)}
        />
        <div ref={composerRef}>
          <ComposerTakeover
            gate={currentGate}
            taskId={taskId}
            renderPolicy={renderPolicy}
            mediaScale={mediaPreviewScale}
            onDecision={onGateDecision}
          >
            <Composer
              key={taskId}
              settings={settings}
              onSettingsChange={onSettingsChange}
              activeGoal={goal}
              contextWindow={contextWindow}
              showContextUsage={showContextUsage}
              pendingPermission={pendingPermission}
              onGoalAction={onGoalAction}
              onSend={onSend}
              onQueue={onQueue}
              onInterject={onInterject}
              commands={commands}
              draftKey={`task:${taskId}`}
              projectId={projectId}
              renderPolicy={renderPolicy}
              mediaPreviewScale={mediaPreviewScale}
              sendShortcut={sendShortcut}
              onStop={onStop}
              busy={busy}
              queueAvailable={queueAvailable}
              interjectAvailable={interjectAvailable}
              disabled={Boolean(currentGate)}
              waiting={waiting}
              permissionLocked={permissionLocked}
              planActive={planActive}
              connection={connection}
              taskConfigOptions={configOptions}
              projectLabel={projectLabel}
              onChooseProject={onChooseProject}
              onManageSystemPrompts={onManageSystemPrompts}
              capabilities={capabilities}
              permissionModes={permissionModes}
              systemPromptPresets={systemPromptPresets}
              replacementDraft={replacementDraft}
              onReplacementApplied={onReplacementApplied}
              onDraftStateChange={onDraftStateChange}
            />
          </ComposerTakeover>
        </div>
      </ComposerStack>
    </div>
  );
}
