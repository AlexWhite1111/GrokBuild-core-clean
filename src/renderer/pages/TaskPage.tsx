import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ComposerInputDocument,
  ComposerReplayDocument,
  PathReferenceSummary,
  TaskMessageBlock,
  TaskFork,
  NativeQueueEntry,
  TaskSnapshot,
  WorkItemSnapshot,
} from "../../shared/contracts.js";
import { projectTaskExecution } from "../../shared/taskExecutionStatus.js";
import { typographyScope } from "../../ui/core/index.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import {
  useCapabilities,
  useTask,
  useTaskIntents,
  useUiPreferenceIntent,
  useUiPreferences,
  useWorkspace,
} from "../api/hooks.js";
import type { ComposerGoalAction, ComposerSettings, ComposerSubmitOptions } from "../composer/Composer.js";
import { TaskContext } from "../context/TaskContext.js";
import { ChildSessionFocusView } from "../context/ChildSessionFocusView.js";
import { PlanReview } from "../review/PlanReview.js";
import { TaskThread } from "../thread/TaskThread.js";
import { useProjectTerminal } from "../terminal/TerminalWorkspace.js";
import { SourceControlControl } from "../sourceControl/SourceControlControl.js";
import { SystemPromptWorkspace } from "../systemPrompt/SystemPromptWorkspace.js";
import { Surface } from "../../ui/components/index.js";
import styles from "./TaskPage.module.css";
import { TaskComposerArea } from "./TaskComposerArea.js";
import { TaskPageLoading } from "./TaskPageLoading.js";
import { TaskTopControls } from "./TaskTopControls.js";
import { useComposerMetrics } from "./useComposerMetrics.js";
import { useTaskUiState } from "./useTaskUiState.js";
import {
  currentWorkItem,
  permissionCommand,
  retryInputFromMessage,
  replayDocumentFromMessage,
  taskPageError,
  workStopMethod,
  type MainTaskView,
  type PermissionRequest,
} from "./taskPageLogic.js";

export function TaskPage() {
  const { t } = useTranslation();
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const { api } = useBootstrap();
  const capabilities = useCapabilities().data;
  const preferences = useUiPreferences().data;
  const savePreferences = useUiPreferenceIntent();
  const workspace = useWorkspace().data;
  const task = useTask(taskId);
  const intents = useTaskIntents(taskId);
  const detail = task.data;
  const snapshot = detail?.snapshot;
  const project = workspace.projects.find(
    (item) => item.projectId === snapshot?.projectId,
  );
  const [mainView, setMainView] = useState<MainTaskView>({ kind: "thread" });
  const terminal = useProjectTerminal();
  const [settings, setSettings] = useState<ComposerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerHasDraft, setComposerHasDraft] = useState(false);
  const [composerReplacement, setComposerReplacement] = useState<{
    id: string;
    sourceCreatedAt: string;
    targetPromptIndex: number;
    sourceBlockId: string;
    document: ComposerReplayDocument;
  } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<
    TaskSnapshot["permission"]["effective"] | null
  >(null);
  const permissionRequestVersion = useRef(0);
  const [specialPromptPending, setSpecialPromptPending] = useState(false);
  const currentGate = snapshot?.gates[0];
  const planGate = snapshot?.gates.find((gate) => gate.kind === "planReview") || null;
  const composerGate = currentGate?.kind === "planReview" ? undefined : currentGate;
  const showError = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const taskUi = useTaskUiState(api, taskId, snapshot?.projectId);
  const composerMetrics = useComposerMetrics(
    Boolean(
      detail && snapshot && settings && !planGate && mainView.kind === "thread",
    ),
  );

  useEffect(() => {
    if (!snapshot) return;
    setSettings({
      modelId: snapshot.modelId,
      effort: snapshot.effort,
      permission: snapshot.permission.effective,
      sandbox: snapshot.sandbox.effective,
      systemPrompt: snapshot.systemPrompt ?? null,
    });
  }, [
    snapshot?.taskId,
    snapshot?.modelId,
    snapshot?.effort,
    snapshot?.permission.effective,
    snapshot?.sandbox.effective,
    snapshot?.systemPrompt,
  ]);
  useEffect(() => {
    setMainView({ kind: "thread" });
    setComposerReplacement(null);
    setComposerHasDraft(false);
    setPendingPermission(null);
    setSpecialPromptPending(false);
    permissionRequestVersion.current += 1;
  }, [taskId]);
  useEffect(() => {
    if (planGate) setMainView({ kind: "thread" });
  }, [planGate?.gateId]);
  if (task.isError)
    return (
      <TaskPageLoading error={task.error instanceof Error ? task.error.message : String(task.error)} />
    );
  if (task.isLoading || !detail || !snapshot || !settings) return <TaskPageLoading />;
  const execution = projectTaskExecution(snapshot);
  const xaiMethods = new Set(
    capabilities.acp.xai
      .filter((item) => ["advertised", "probed"].includes(item.availability))
      .map((item) => item.method),
  );
  const advertisedXaiMethods = new Set(
    capabilities.acp.xai
      .filter((item) => item.availability === "advertised")
      .map((item) => item.method),
  );
  const queueAvailable = xaiMethods.has("x.ai/queue/changed");
  const interjectAvailable =
    xaiMethods.has("x.ai/queue/interject") || xaiMethods.has("x.ai/interject");
  const rewindAvailable = xaiMethods.has("x.ai/rewind/points") && xaiMethods.has("x.ai/rewind/execute");
  const forkAvailable = xaiMethods.has("x.ai/session/fork");
  const canStopWork = (item: WorkItemSnapshot) =>
    (item.status === "pending" || item.status === "running") &&
    (item.kind === "agent"
      ? Boolean(item.childSessionId)
      : advertisedXaiMethods.has(workStopMethod(item.kind)!)) &&
    item.currentActivity !== "Stopping";

  const send = async (
    prompt: string,
    paths: PathReferenceSummary[],
    document: ComposerInputDocument,
    options: ComposerSubmitOptions,
  ) => {
    setError(null);
    const input = {
      requestId: crypto.randomUUID(),
      prompt: prompt || "请查看这些路径。",
      paths: paths.map(({ refId }) => ({ refId })),
      document,
      submissionMode: options.mode,
    };
    const special = options.mode === "goal" || options.mode === "plan";
    try {
      if (special) setSpecialPromptPending(true);
      await taskUi.flushContextResources();
      if (options.replacement) {
        await intents.rewindAndPrompt.mutateAsync({
          ...input,
          targetPromptIndex: options.replacement.targetPromptIndex,
          sourceBlockId: options.replacement.sourceBlockId,
          submissionMode: "prompt",
        });
      } else {
        await intents.prompt.mutateAsync(input);
      }
    } catch (cause) {
      showError(cause);
      throw cause;
    } finally {
      if (special) setSpecialPromptPending(false);
    }
  };
  const enqueue = async (
    prompt: string,
    paths: PathReferenceSummary[],
    document: ComposerInputDocument,
  ) => {
    setError(null);
    try {
      await taskUi.flushContextResources();
      await intents.enqueue.mutateAsync({
        requestId: crypto.randomUUID(),
        prompt: prompt || "请查看这些路径。",
        paths: paths.map(({ refId }) => ({ refId })),
        document,
      });
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  };
  const mutateGoal = async (input: ComposerGoalAction) => {
    setError(null);
    try {
      await intents.goal.mutateAsync({ requestId: crypto.randomUUID(), ...input });
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  };
  const retryMessage = async (message: TaskMessageBlock) => {
    setError(null);
    try {
      await taskUi.flushContextResources();
      const input = await retryInputFromMessage(message, crypto.randomUUID(), snapshot.projectId);
      await intents.prompt.mutateAsync(input);
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  };
  const forkConversation = async (overrides: Pick<TaskFork, "sandbox" | "systemPrompt"> = {}) => {
    setError(null);
    try {
      const child = await intents.fork.mutateAsync({ requestId: crypto.randomUUID(), ...overrides });
      navigate(`/tasks/${child.taskId}`);
    } catch (cause) {
      showError(cause);
    }
  };
  const queueMutation = async (
    action: "remove" | "reorder" | "edit" | "interject",
    entry: NativeQueueEntry,
    extra: { text?: string; position?: number } = {},
  ) => {
    setError(null);
    try {
      await intents.queue.mutateAsync({
        requestId: crypto.randomUUID(),
        action,
        entryId: entry.entryId || undefined,
        expectedVersion: entry.version ?? undefined,
        ...extra,
      });
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  };
  const interjectDraft = async (
    prompt: string,
    paths: PathReferenceSummary[],
  ) => {
    if (paths.length)
      throw new Error("Interrupt & Send 暂不接受路径 Chip；请加入 Queue。 ");
    try {
      await intents.interject.mutateAsync({
        requestId: crypto.randomUUID(),
        text: prompt,
      });
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  };
  const applyPermission = async (
    request: PermissionRequest,
  ): Promise<boolean> => {
    const version = ++permissionRequestVersion.current;
    setError(null);
    setPendingPermission(request.target);
    try {
      const result = await intents.command.mutateAsync({
        requestId: crypto.randomUUID(),
        name: request.name,
        input: request.input,
      });
      if (version !== permissionRequestVersion.current) return true;
      if (result.permission.effective !== request.target)
        setError(result.error?.message || t("permissionUnconfirmed"));
      setSettings((current) => current ? { ...current, permission: result.permission.effective } : current);
      return result.permission.effective === request.target;
    } catch (cause) {
      if (version === permissionRequestVersion.current) {
        showError(cause);
        setSettings((current) => current ? { ...current, permission: snapshot.permission.effective } : current);
      }
      return false;
    } finally {
      if (version === permissionRequestVersion.current) setPendingPermission(null);
    }
  };
  const stopWork = async (item: WorkItemSnapshot) => {
    setError(null);
    try {
      await intents.workStop.mutateAsync({
        requestId: crypto.randomUUID(),
        workItemId: item.id,
      });
    } catch (cause) {
      showError(cause);
    }
  };
  const cancelTurn = async () => {
    setError(null);
    try {
      await intents.cancel.mutateAsync(crypto.randomUUID());
    } catch (cause) {
      showError(cause);
    }
  };
  const changeSettings = (next: ComposerSettings) => {
    if (next.sandbox !== settings.sandbox || !sameSystemPrompt(next.systemPrompt, settings.systemPrompt)) {
      void forkConversation({ sandbox: next.sandbox, systemPrompt: next.systemPrompt });
      return;
    }
    const model = snapshot.configOptions.find(
      (option) => option.category === "model",
    );
    const effort = snapshot.configOptions.find(
      (option) =>
        option.category === "thought_level" ||
        /effort|reasoning/i.test(option.id),
    );
    if (next.modelId !== settings.modelId && model && next.modelId)
      void intents.config
        .mutateAsync({
          requestId: crypto.randomUUID(),
          configId: model.id,
          value: next.modelId,
        })
        .catch(showError);
    if (next.effort !== settings.effort && effort && next.effort)
      void intents.config
        .mutateAsync({
          requestId: crypto.randomUUID(),
          configId: effort.id,
          value: next.effort,
        })
        .catch(showError);
    const requestedPermission = pendingPermission || settings.permission;
    if (next.permission !== requestedPermission) {
      const command = permissionCommand(
        requestedPermission,
        next.permission,
        snapshot.permission.modes,
      );
      const request: PermissionRequest | null = command ? {
        name: command.name,
        input: command.input,
        target: next.permission,
      } : null;
      if (request) {
        setSettings({ ...settings, permission: next.permission });
        void applyPermission(request);
      }
    }
  };
  const taskPermissionModes = snapshot.permission.modes.map((mode) => ({
    ...mode,
    available: mode.effective || (mode.available && mode.hotSwitch),
  }));
  const permissionControlAvailable = taskPermissionModes.some(
    (mode) => mode.available && mode.hotSwitch && !mode.effective,
  );
  const focusedWork =
    mainView.kind === "child" ? currentWorkItem(detail, mainView.item) : null;

  const visibleError = taskPageError(error, snapshot.error);

  return (
    <Surface as="main" appearance="canvas" shape="none" className={styles.page} data-rail-open={taskUi.contextOpen || undefined}>
      <TaskTopControls
        groupLabel={t("taskControls")}
        terminalLabel={t("terminal")}
        contextLabel={taskUi.contextOpen ? t("collapseContext") : t("expandContext")}
        sourceControl={<SourceControlControl key={snapshot.taskId} projectId={snapshot.projectId} taskId={snapshot.taskId} taskTitle={snapshot.title} className={styles.topControl} />}
        terminalOpen={terminal.open}
        contextOpen={taskUi.contextOpen}
        onToggleTerminal={terminal.toggle}
        onToggleContext={() => {
          if (taskUi.contextOpen) taskUi.closeContext();
          else taskUi.openContext(taskUi.contextFocus);
        }}
      />
      <div className={styles.body}>
        <section className={styles.main}>
          <div
            className={styles.conversationPane}
            {...typographyScope("conversation")}
            data-conversation-drop-region
            style={
              {
                "--composer-height": `${composerMetrics.composerHeight}px`,
              } as CSSProperties
            }
          >
            {planGate || mainView.kind === "plan" ? (
              <PlanReview
                api={api}
                taskId={snapshot.taskId}
                gate={planGate || undefined}
                document={snapshot.plan.document}
                preparing={snapshot.workMode === "plan"}
                renderPolicy={preferences.richTextRenderPolicy}
                mediaScale={preferences.mediaPreviewScale}
                onClose={planGate ? undefined : () => setMainView({ kind: "thread" })}
                onDecision={planGate ? async (decision) => {
                  setError(null);
                  try {
                    await intents.gate.mutateAsync(decision);
                  } catch (cause) {
                    showError(cause);
                    throw cause;
                  }
                } : undefined}
              />
            ) : mainView.kind === "systemPrompt" ? (
              <SystemPromptWorkspace
                current={settings.systemPrompt}
                taskId={snapshot.taskId}
                renderPolicy={preferences.richTextRenderPolicy}
                mediaScale={preferences.mediaPreviewScale}
                onApply={(systemPrompt) => {
                  changeSettings({ ...settings, systemPrompt });
                  setMainView({ kind: "thread" });
                }}
                onClose={() => setMainView({ kind: "thread" })}
              />
            ) : focusedWork ? (
              <ChildSessionFocusView
                key={`${snapshot.taskId}:${focusedWork.childSessionId || focusedWork.id}`}
                taskId={snapshot.taskId}
                item={focusedWork}
                canStop={canStopWork(focusedWork)}
                stopPending={intents.workStop.isPending}
                onStop={() => void stopWork(focusedWork)}
                onClose={() => setMainView({ kind: "thread" })}
              />
            ) : (
              <TaskThread
                key={snapshot.taskId}
                detail={detail}
                bottomInset={composerMetrics.stackHeight}
                onRetry={retryMessage}
                onEdit={rewindAvailable && !intents.rewindAndPrompt.isPending && !intents.fork.isPending ? (message) => setComposerReplacement({
                  id: crypto.randomUUID(),
                  sourceCreatedAt: message.createdAt,
                  targetPromptIndex: message.protocol!.promptIndex!,
                  sourceBlockId: message.blockId,
                  document: replayDocumentFromMessage(message),
                }) : undefined}
                onFork={forkAvailable && !intents.rewindAndPrompt.isPending && !intents.fork.isPending ? forkConversation : undefined}
                composerHasDraft={composerHasDraft}
              />
            )}
            {!planGate && mainView.kind === "thread" && (
              <TaskComposerArea
                stackRef={composerMetrics.stackRef}
                composerRef={composerMetrics.composerRef}
                error={visibleError}
                queue={snapshot.queue}
                goal={snapshot.goal}
                contextWindow={snapshot.contextWindow}
                gates={snapshot.gates}
                currentGate={composerGate}
                taskId={snapshot.taskId}
                projectId={snapshot.projectId}
                projectLabel={project?.displayPath || "Project"}
                settings={settings}
                commands={snapshot.commands.available}
                configOptions={snapshot.configOptions}
                capabilities={capabilities}
                permissionModes={taskPermissionModes}
                systemPromptPresets={workspace.systemPromptPresets}
                renderPolicy={preferences.richTextRenderPolicy}
                mediaPreviewScale={preferences.mediaPreviewScale}
                sendShortcut={preferences.sendShortcut}
                showContextUsage={preferences.showContextUsage}
                busy={execution.foregroundBusy}
                waiting={Boolean((intents.prompt.isPending && !specialPromptPending) || intents.rewindAndPrompt.isPending || intents.fork.isPending)}
                pendingPermission={pendingPermission}
                queueAvailable={execution.allowedActions.queue && queueAvailable}
                interjectAvailable={execution.allowedActions.interject && interjectAvailable}
                permissionLocked={!permissionControlAvailable}
                planActive={snapshot.workMode === "plan"}
                connection={snapshot.connection}
                onSettingsChange={changeSettings}
                onGoalAction={mutateGoal}
                onSend={send}
                onQueue={enqueue}
                onInterject={interjectDraft}
                onStop={cancelTurn}
                onGateDecision={(decision) =>
                  intents.gate.mutateAsync(decision)
                }
                onQueueMutation={queueMutation}
                onChooseProject={() =>
                  void window.grokDesktop?.chooseProject()
                }
                onManageSystemPrompts={() => setMainView({ kind: "systemPrompt" })}
                replacementDraft={composerReplacement}
                onReplacementApplied={(id) => setComposerReplacement((current) => current?.id === id ? null : current)}
                onDraftStateChange={setComposerHasDraft}
              />
            )}
          </div>
        </section>
        {taskUi.contextOpen && (
          <TaskContext
            key={snapshot.taskId}
            detail={detail}
            savedResources={taskUi.savedResources}
            focus={taskUi.contextFocus}
            width={preferences.contextWidth}
            onWidthChange={(value) =>
              savePreferences.mutate({ ...preferences, contextWidth: value })
            }
            onFocusChange={taskUi.openContext}
            onClose={taskUi.closeContext}
            onOpenPlan={() => setMainView({ kind: "plan" })}
            onOpenChild={(item) => setMainView({ kind: "child", item })}
            canStopWork={canStopWork}
            onStopWork={(item) => void stopWork(item)}
            workStopPending={intents.workStop.isPending}
            canCancelTodo={snapshot.turn !== "idle"}
            todoCancelPending={intents.cancel.isPending}
            onCancelTodo={() => void cancelTurn()}
            onAddResources={taskUi.addResources}
            onRemoveResource={taskUi.removeResource}
          />
        )}
      </div>
    </Surface>
  );
}

function sameSystemPrompt(left: ComposerSettings["systemPrompt"], right: ComposerSettings["systemPrompt"]): boolean {
  if (!left || !right) return !left && !right;
  return left.presetId === right.presetId
    && left.title === right.title
    && left.rules === right.rules
    && left.systemPrompt === right.systemPrompt;
}
