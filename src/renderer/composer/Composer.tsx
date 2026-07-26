import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowUp, Eye, File, FolderOpen, Layers3, ListChecks, Paperclip, Pencil, Plus, Settings2, Square, Target, X, Zap } from "lucide-react";
import type { PathReferenceSummary, ReasoningEffort, SandboxProfile, TaskCommandInfo, TaskGoalState, TaskPermissionMode } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { InlineComposerEditor, type InlineComposerEditorHandle } from "./InlineComposerEditor.js";
import { useMobileLayout } from "../app/mobileViewport.js";
import { composerFingerprint, composerHasContent, composerInput, composerPaths, composerText, restoreReplayDocument, textNodes, type ComposerNode } from "./composerDocument.js";
import { RichContent } from "../thread/RichContent.js";
import { composerActionVisibility, composerShortcutIntent } from "./composerKeyboard.js";
import { useComposerDraft } from "./useComposerDraft.js";
import { Control, Divider, Notice, Spinner, Surface, Text } from "../../ui/components/index.js";
import { ComposerGoalBar } from "./ComposerGoalBar.js";
import { ContextUsageIndicator } from "./ContextUsageIndicator.js";
import { ChoiceTrigger, effortChoices, modelChoices, setSetting, systemPromptLabel, type ChoicePanel, type UpPanel } from "./ComposerOptions.js";
import { permissionLabel, sandboxLabel } from "../sessionSettingLabels.js";
import { useComposerPreview } from "./useComposerPreview.js";
import { useComposerAttachments } from "./useComposerAttachments.js";
import type { ComposerProps } from "./composerTypes.js";
import styles from "./Composer.module.css";
import { composerPanelPosition } from "./composerPanelPosition.js";

export type { ComposerGoalAction, ComposerProps, ComposerSettings, ComposerSubmitOptions } from "./composerTypes.js";

type SubmitIntent = "send" | "queue" | "interject" | "goal" | "plan";
export function Composer(props: ComposerProps) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const mobileInput = useMobileLayout(760);
  const { nodes, setNodes, clear: clearDraft } = useComposerDraft({ api, draftKey: props.draftKey, initialDraft: props.initialDraft, projectId: props.projectId });
  const [submittingIntent, setSubmittingIntent] = useState<SubmitIntent | null>(null);
  const [deferredSubmissionPending, setDeferredSubmissionPending] = useState(false);
  const activeGoal = visibleGoal(props.activeGoal) ? props.activeGoal : null;
  const waiting = Boolean(props.waiting) || Boolean(submittingIntent && !deferredSubmissionPending);
  const interactionLocked = waiting;
  const [upPanel, setUpPanel] = useState<UpPanel | null>(null);
  const [composerMode, setComposerMode] = useState<"goal" | "plan" | null>(null);
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalEditNodes, setGoalEditNodes] = useState(() => textNodes(""));
  const [richPreview, setRichPreview] = useState(false);
  const editor = useRef<InlineComposerEditorHandle>(null);
  const shell = useRef<HTMLDivElement>(null);
  const panelElement = useRef<HTMLElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const appliedReplacement = useRef<string | null>(null);
  const replacementBackup = useRef<ComposerNode[] | null>(null);
  const inputNodes = goalEditing ? goalEditNodes : nodes;
  const setInputNodes = goalEditing ? setGoalEditNodes : setNodes;
  const currentNodes = useRef(nodes);
  const currentInputNodes = useRef(inputNodes);
  const onReplacementApplied = useRef(props.onReplacementApplied);
  currentNodes.current = nodes;
  currentInputNodes.current = inputNodes;
  onReplacementApplied.current = props.onReplacementApplied;
  const [replacementSource, setReplacementSource] = useState<{ id: string; createdAt: string; targetPromptIndex: number; sourceBlockId: string } | null>(null);
  const { choose, dragActive, pathError, registerFiles, registerTextClip, setPathError } = useComposerAttachments({ editor, projectId: props.projectId, draftKey: props.draftKey, enabled: !props.disabled && !interactionLocked && !goalEditing });
  const { scopeId: previewScopeId, preview, clearPreview } = useComposerPreview({ nodes: inputNodes, enabled: richPreview, projectId: props.projectId, policy: props.renderPolicy });

  useEffect(() => {
    setRichPreview(false);
    clearPreview();
    setComposerMode(null);
    setGoalEditing(false);
    setGoalEditNodes([]);
    setReplacementSource(null);
    replacementBackup.current = null;
    appliedReplacement.current = null;
  }, [clearPreview, props.draftKey]);

  useEffect(() => {
    props.onDraftStateChange?.(composerHasContent(nodes));
  }, [nodes, props.onDraftStateChange]);

  useEffect(() => {
    const replacement = props.replacementDraft;
    if (!replacement || appliedReplacement.current === replacement.id) return;
    appliedReplacement.current = replacement.id;
    let current = true;
    const restore = (paths: PathReferenceSummary[]) => window.grokDesktop
      ? window.grokDesktop.restorePaths(paths, props.projectId)
      : Promise.resolve(paths.map((path) => ({ ...path, valid: false })));
    void restoreReplayDocument(replacement.document, restore).then((value) => {
      if (!current) return;
      if (!replacementBackup.current) replacementBackup.current = cloneComposerNodes(currentNodes.current);
      setUpPanel(null);
      setComposerMode(null);
      setGoalEditing(false);
      setGoalEditNodes([]);
      setRichPreview(false);
      setNodes(value);
      setReplacementSource({ id: replacement.id, createdAt: replacement.sourceCreatedAt, targetPromptIndex: replacement.targetPromptIndex, sourceBlockId: replacement.sourceBlockId });
      onReplacementApplied.current?.(replacement.id);
      requestAnimationFrame(() => editor.current?.focus());
    }).catch((cause) => {
      if (current) {
        appliedReplacement.current = null;
        setPathError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => { current = false; };
  }, [props.projectId, props.replacementDraft, setNodes]);

  useEffect(() => {
    if (activeGoal || !goalEditing) return;
    setGoalEditing(false);
    setGoalEditNodes([]);
  }, [activeGoal, goalEditing]);

  useEffect(() => {
    if (!upPanel) return;
    const close = (event: PointerEvent) => {
      if (!shell.current?.contains(event.target as Node)) setUpPanel(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [upPanel]);

  useLayoutEffect(() => {
    if (!upPanel) {
      setPanelPosition(null);
      return;
    }
    const container = shell.current;
    const panel = panelElement.current;
    const anchor = container?.querySelector<HTMLElement>(`[data-choice-panel="${upPanel}"]`);
    if (!container || !panel || !anchor) return;
    const position = () => setPanelPosition(composerPanelPosition(
      container.getBoundingClientRect(),
      anchor.getBoundingClientRect(),
      panel.getBoundingClientRect(),
    ));
    position();
    const observer = new ResizeObserver(position);
    observer.observe(container);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [upPanel]);

  const clearAcceptedDraft = () => {
    clearDraft();
    setRichPreview(false);
    setReplacementSource(null);
    replacementBackup.current = null;
  };

  const cancelMessageReplacement = () => {
    if (interactionLocked || !replacementSource) return;
    const backup = replacementBackup.current || [];
    replacementBackup.current = null;
    setReplacementSource(null);
    setRichPreview(false);
    setNodes(cloneComposerNodes(backup));
    requestAnimationFrame(() => editor.current?.focus());
  };

  const beginGoalEdit = () => {
    if (!activeGoal || interactionLocked || submittingIntent) return;
    setUpPanel(null);
    setComposerMode(null);
    setRichPreview(false);
    setGoalEditNodes(textNodes(activeGoal.objective || ""));
    setGoalEditing(true);
    requestAnimationFrame(() => editor.current?.focus());
  };

  const cancelGoalEdit = () => {
    if (interactionLocked || submittingIntent) return;
    setGoalEditing(false);
    setGoalEditNodes([]);
    requestAnimationFrame(() => editor.current?.focus());
  };

  const runGoalAction = async (action: "pause" | "resume" | "clear") => {
    if (!props.onGoalAction || interactionLocked || submittingIntent) return;
    try { await props.onGoalAction({ action }); }
    catch { /* Task page owns the visible error. */ }
  };
  const exitPlanMode = async () => {
    if (!props.onExitPlanMode || interactionLocked || submittingIntent) return;
    setUpPanel(null);
    setSubmittingIntent("plan");
    try { await props.onExitPlanMode(); }
    catch { /* Task page owns the visible error. */ }
    finally { setSubmittingIntent(null); }
  };

  const submit = async (intent: "send" | "queue" | "interject" = "send") => {
    if (props.disabled || interactionLocked || submittingIntent) return;
    const paths = composerPaths(inputNodes);
    if (paths.some((item) => !item.valid)) { setPathError(t("pathNeedsRelocation", { defaultValue: "有路径来自上次启动，请删除后重新添加。" })); return; }
    const text = composerText(inputNodes);
    if (!composerHasContent(inputNodes)) return;
    if (goalEditing) {
      if (intent !== "send" || !props.onGoalAction) return;
      const previous = goalEditNodes;
      const deferred = true;
      setSubmittingIntent("goal");
      setDeferredSubmissionPending(deferred);
      try {
        const consumed = await props.onGoalAction({ action: "set", objective: text.trim() });
        if (consumed !== false && composerFingerprint(currentInputNodes.current) === composerFingerprint(previous)) {
          setGoalEditing(false);
          setGoalEditNodes([]);
          setRichPreview(false);
        }
      } catch { /* Preserve the Goal edit for retry. */ }
      finally { setSubmittingIntent(null); setDeferredSubmissionPending(false); }
      return;
    }
    const invocation = commandInvocation(text, props.commands || []);
    if (invocation) {
      setPathError(t("slashCommandsUnavailable", { defaultValue: "Slash 控制已从输入框移除，请使用对应的界面控制。" }));
      return;
    }
    const handler = intent === "queue" ? props.onQueue : intent === "interject" ? props.onInterject : props.onSend;
    if (!handler) return;
    const previous = nodes;
    const mode = replacementSource ? "prompt" : intent === "send" ? composerMode || "prompt" : "prompt";
    const deferred = mode === "goal" || mode === "plan" || Boolean(props.pendingPermission);
    setSubmittingIntent(mode === "goal" || mode === "plan" ? mode : intent);
    setDeferredSubmissionPending(deferred);
    try {
      const consumed = await handler(text, paths, composerInput(inputNodes), {
        mode,
        ...(replacementSource ? { replacement: { targetPromptIndex: replacementSource.targetPromptIndex, sourceBlockId: replacementSource.sourceBlockId } } : {}),
      });
      if (consumed !== false) {
        if (composerFingerprint(currentNodes.current) === composerFingerprint(previous)) clearAcceptedDraft();
        setComposerMode(null);
      }
    } catch (cause) {
      if (replacementSource && apiProblemCode(cause) === "REWIND_APPLIED_PROMPT_FAILED") {
        setReplacementSource(null);
        replacementBackup.current = null;
      }
    } finally { setSubmittingIntent(null); setDeferredSubmissionPending(false); }
  };

  const sendShortcut = props.sendShortcut || "enter";
  const submitFromEditor = (commandKey: boolean) => {
    if (goalEditing || composerMode) { void submit(); return; }
    const intent = composerShortcutIntent(commandKey, Boolean(props.busy), Boolean(props.queueAvailable), Boolean(props.interjectAvailable));
    if (intent) void submit(intent);
  };

  const draft = composerText(inputNodes);
  const draftPaths = composerPaths(inputNodes);
  const currentPreview = preview?.text === draft ? preview : null;
  const currentPathIds = new Set(draftPaths.map((path) => path.refId));
  const previewMedia = currentPreview?.media
    || preview?.media.filter((item) => item.pathRefId && currentPathIds.has(item.pathRefId))
    || [];
  const canSubmit = composerHasContent(inputNodes);
  const goalAvailable = (props.commands || []).some((command) => command.name.toLowerCase() === "goal");
  const specialMode = goalEditing ? "goal-edit" : composerMode;
  const actions = composerActionVisibility(Boolean(props.busy), canSubmit, specialMode ? false : Boolean(props.queueAvailable), specialMode ? false : Boolean(props.interjectAvailable));
  const effortPanel: ChoicePanel = { value: props.settings.effort || "", choices: effortChoices(props), onChange: (value) => setSetting(props, "effort", (value || null) as ReasoningEffort | null) };
  const panels: Record<Exclude<UpPanel, "add">, ChoicePanel> = {
    model: { value: props.settings.modelId || "", choices: modelChoices(props), onChange: (value) => setSetting(props, "modelId", value || null) },
    permission: { value: props.pendingPermission || props.settings.permission, choices: props.permissionModes.filter((item) => item.available).map((item) => ({ value: item.mode, label: permissionLabel(item.mode) })), onChange: (value) => setSetting(props, "permission", value as TaskPermissionMode), locked: props.permissionLocked },
    sandbox: { value: props.settings.sandbox, choices: ["off", "workspace", "readOnly", "strict"].map((value) => ({ value, label: sandboxLabel(value as SandboxProfile) })), onChange: (value) => setSetting(props, "sandbox", value as SandboxProfile), disabled: props.sessionSettingsBlocked },
    systemPrompt: {
      value: props.settings.systemPrompt?.presetId || "default",
      choices: [{ value: "default", label: "System" }, ...props.systemPromptPresets.filter((preset) => preset.pinned).map((preset) => ({ value: preset.presetId, label: preset.title }))],
      disabled: props.sessionSettingsBlocked,
      onChange: (value) => {
        const preset = props.systemPromptPresets.find((item) => item.presetId === value);
        setSetting(props, "systemPrompt", preset ? {
          presetId: preset.presetId,
          title: preset.title,
          rules: preset.rules,
          systemPrompt: preset.systemPrompt,
        } : null);
      },
    },
  };
  const activeChoices = upPanel && upPanel !== "add" ? panels[upPanel] : null;
  const sessionSettingHint = props.sessionSettingsBlocked
    ? t("sessionSettingsBusy")
    : t(props.sessionCommitted ? "sessionSettingsForkHint" : "sessionSettingsSetupHint");
  const conversationDropRegion = dragActive ? document.querySelector<HTMLElement>("[data-conversation-drop-region]") : null;
  return <div ref={shell} className={styles.shell} onKeyDownCapture={(event) => {
    if (event.key !== "Escape") return;
    if (upPanel) { event.preventDefault(); setUpPanel(null); }
    else if (goalEditing) { event.preventDefault(); cancelGoalEdit(); }
    else if (replacementSource) { event.preventDefault(); cancelMessageReplacement(); }
    else if (composerMode && !submittingIntent) { event.preventDefault(); setComposerMode(null); }
  }}>
    {conversationDropRegion && createPortal(<div className={styles.conversationDropOverlay} role="status"><Paperclip size={20} /><span>{t("dropFilesHere")}</span></div>, conversationDropRegion)}
    {upPanel && <Surface appearance="menu" elevation="floating" className={styles.upPanel} data-panel={upPanel} aria-label={upPanel} elementRef={(element) => { panelElement.current = element; }} style={panelPosition ? panelPosition : { visibility: "hidden" }}>
      {upPanel === "add" ? <>
        <Control recipe="menu" onClick={() => { setUpPanel(null); void choose("files"); }}><File size={14} />{t("chooseFiles")}</Control>
        <Control recipe="menu" onClick={() => { setUpPanel(null); void choose("folder"); }}><FolderOpen size={14} />{t("chooseFromFolder")}</Control>
        {props.planActive
          ? <Control recipe="menu" selected disabled={Boolean(!props.onExitPlanMode || goalEditing || waiting || submittingIntent || replacementSource)} onClick={() => void exitPlanMode()}><ListChecks size={14} />{t("exitPlanMode")}</Control>
          : <Control recipe="menu" selected={composerMode === "plan"} disabled={Boolean(goalEditing || waiting || submittingIntent || replacementSource)} onClick={() => { setComposerMode("plan"); setUpPanel(null); requestAnimationFrame(() => editor.current?.focus()); }}><ListChecks size={14} />{t("plan")}</Control>}
        {goalAvailable && <Control recipe="menu" selected={composerMode === "goal" || goalEditing} disabled={Boolean(props.planActive || waiting || submittingIntent || replacementSource)} onClick={() => { if (activeGoal) beginGoalEdit(); else { setComposerMode("goal"); setUpPanel(null); requestAnimationFrame(() => editor.current?.focus()); } }}><Target size={14} />{t("goal")}</Control>}
      </> : upPanel === "model" ? <>
        <Text as="span" tone="secondary" size="caption" className={styles.panelLabel}>Model</Text>
        {panels.model.choices.map((choice) => <Control recipe="menu" key={choice.value} selected={choice.value === panels.model.value} onClick={() => { panels.model.onChange(choice.value); setUpPanel(null); }}>{choice.label}</Control>)}
        {effortPanel.choices.length > 0 && <><Divider className={styles.panelDivider} /><Text as="span" tone="secondary" size="caption" className={styles.panelLabel}>Reasoning</Text>{effortPanel.choices.map((choice) => <Control recipe="menu" key={choice.value} selected={choice.value === effortPanel.value} onClick={() => { effortPanel.onChange(choice.value); setUpPanel(null); }}>{choice.label}</Control>)}</>}
      </> : upPanel === "systemPrompt" ? <>
        {panels.systemPrompt.choices.map((choice) => <Control recipe="menu" key={choice.value} selected={choice.value === panels.systemPrompt.value} disabled={panels.systemPrompt.disabled} onClick={() => { panels.systemPrompt.onChange(choice.value); setUpPanel(null); }}>{choice.label}</Control>)}
        <Text as="small" tone="secondary" size="caption" className={styles.panelHint}>{sessionSettingHint}</Text>
        <Divider className={styles.panelDivider} />
        <Control recipe="menu" onClick={() => { setUpPanel(null); props.onManageSystemPrompts?.(); }}><Settings2 size={13} />Settings</Control>
      </> : <>{activeChoices?.choices.map((choice) => <Control recipe="menu" key={choice.value} selected={choice.value === activeChoices.value} disabled={activeChoices.locked || activeChoices.disabled} onClick={() => { activeChoices.onChange(choice.value); setUpPanel(null); }}>{choice.label}</Control>)}{upPanel === "sandbox" && <Text as="small" tone="secondary" size="caption" className={styles.panelHint}>{sessionSettingHint}</Text>}</>}
    </Surface>}
    {pathError && <Notice tone="warning" density="compact" role="alert" className={styles.notice}>{pathError}<Control recipe="icon" density="detail" tone="warning" onClick={() => setPathError(null)} aria-label={t("close")}><X size={11} /></Control></Notice>}
    <div className={styles.composer} data-shape="surface" data-drag-active={dragActive || undefined} data-rich-preview={richPreview || undefined} data-composer-mode={specialMode || undefined} data-goal-active={activeGoal ? activeGoal.status : undefined} data-submitting={Boolean(waiting || submittingIntent) || undefined} aria-busy={Boolean(waiting || submittingIntent) || undefined}>
      {activeGoal && <ComposerGoalBar goal={activeGoal} editing={goalEditing} onEdit={beginGoalEdit} onCancelEdit={cancelGoalEdit} onAction={runGoalAction} />}
      {replacementSource && <div className={styles.replacementBar}>
        <Pencil size={12} aria-hidden="true" />
        <span>{t("editAndResendFrom", { time: formatMessageTime(replacementSource.createdAt) })}</span>
        <Control recipe="icon" density="detail" disabled={interactionLocked} onClick={cancelMessageReplacement} aria-label={t("cancelEditAndResend")} title={t("cancelEditAndResend")}><X size={11} /></Control>
      </div>}
      <div className={styles.editorStack}>
        {richPreview && composerHasContent(inputNodes) && <div className={styles.richPreview} data-rich-preview="true" tabIndex={0} aria-label={t("livePreview")} aria-busy={!currentPreview}><RichContent taskId={previewScopeId} text={draft} paths={draftPaths} media={previewMedia} document={currentPreview?.document} localLinks={currentPreview?.localLinks} renderPolicy={props.renderPolicy} mediaScale={props.mediaPreviewScale} portable={false} /></div>}
        <InlineComposerEditor ref={editor} value={inputNodes} disabled={Boolean(props.disabled || waiting)} readOnly={waiting} placeholder={t(goalEditing ? "goalEditPlaceholder" : composerMode === "goal" ? "goalComposerPlaceholder" : composerMode === "plan" ? "planComposerPlaceholder" : "composerPlaceholder")} submitOnEnter={!mobileInput && sendShortcut === "enter"} maxLines={6} onChange={(value) => { setUpPanel(null); setInputNodes(value); }} onSubmit={submitFromEditor} onFiles={registerFiles} onTextClip={registerTextClip} onRevealPath={(refId) => void window.grokDesktop?.revealPath(refId)} />
      </div>
      <div className={styles.toolbar}>
        <div className={styles.leading}>
          <Control recipe="icon" density="compact" data-choice-panel="add" selected={upPanel === "add"} aria-label={t("addAttachment")} aria-expanded={upPanel === "add"} disabled={interactionLocked || goalEditing} onClick={() => setUpPanel((value) => value === "add" ? null : "add")}><Plus size={16} /></Control>
          {composerMode && <Control recipe="text" hover="surface" density="compact" shape="control" className={styles.specialMode} disabled={Boolean(submittingIntent)} aria-label={t(composerMode === "goal" ? "exitGoalMode" : "exitPlanMode")} onClick={() => setComposerMode(null)}>{composerMode === "goal" ? <Target size={12} /> : <ListChecks size={12} />}<span>{t(composerMode)}</span><X size={10} /></Control>}
          {composerHasContent(inputNodes) && <Control recipe="icon" density="compact" selected={richPreview} aria-label={t("livePreview")} aria-pressed={richPreview} disabled={interactionLocked} onClick={() => setRichPreview((value) => !value)}><Eye size={14} /></Control>}
        </div>
        <div className={styles.controls}>
          <div className={styles.controlScroller}>
            {(props.settings.modelId || props.settings.effort) && <ChoiceTrigger panel="model" grouped label={<>{props.settings.modelId || "Model"}{props.settings.effort && <><Text as="span" tone="secondary" size="label" className={styles.inlineDivider}>·</Text>{props.settings.effort}</>}</>} open={upPanel === "model"} disabled={interactionLocked} onToggle={setUpPanel} />}
            <div className={styles.secondaryOptions}>
              <ChoiceTrigger panel="sandbox" label={sandboxLabel(props.settings.sandbox)} open={upPanel === "sandbox"} disabled={interactionLocked} onToggle={setUpPanel} />
              <ChoiceTrigger panel="systemPrompt" label={systemPromptLabel(props.settings.systemPrompt)} open={upPanel === "systemPrompt"} disabled={interactionLocked} onToggle={setUpPanel} />
              <ChoiceTrigger panel="permission" label={props.pendingPermission ? `${permissionLabel(props.pendingPermission)} · ${t("pendingApply")}` : permissionLabel(props.settings.permission)} open={upPanel === "permission"} locked={panels.permission.locked} disabled={interactionLocked} onToggle={setUpPanel} />
            </div>
          </div>
          {props.showContextUsage && props.contextWindow && <ContextUsageIndicator usage={props.contextWindow} />}
        </div>
        <div className={styles.actions}>
          {!waiting && actions.stop && <Control recipe="floating" density="action" shape="round" iconOnly tone="danger" onClick={() => void props.onStop?.()} aria-label={t("stop")} title={t("stop")}><Square size={12} fill="currentColor" /></Control>}
          {!waiting && actions.interject && <Control recipe="floating" density="action" shape="round" iconOnly tone="danger" onClick={() => void submit("interject")} disabled={Boolean(interactionLocked || submittingIntent)} aria-label={t("interruptAndSend")} title={t("interruptAndSend")}>{submittingIntent === "interject" ? <Spinner tone="danger" /> : <Zap size={14} />}</Control>}
          {!waiting && actions.queue && <Control recipe="solid" hover="none" density="action" shape="round" iconOnly className={styles.cutoutAction} onClick={() => void submit("queue")} disabled={Boolean(interactionLocked || submittingIntent)} aria-label={t("queueAction")} title={t("queueAction")}>{submittingIntent === "queue" ? <Spinner tone="onAccent" /> : <Layers3 size={14} />}</Control>}
          {(actions.send || waiting || goalEditing || composerMode || submittingIntent) && <Control recipe="solid" hover="none" density="action" shape="round" iconOnly className={`${styles.sendAction} ${styles.cutoutAction}`} onClick={() => void submit()} disabled={Boolean(props.disabled || interactionLocked || submittingIntent || !canSubmit)} aria-label={waiting || submittingIntent ? t("waitingForReceipt") : t(goalEditing ? "saveGoal" : composerMode === "goal" ? "sendAsGoal" : composerMode === "plan" ? "sendAsPlan" : "send")} aria-busy={Boolean(waiting || submittingIntent) || undefined}>{waiting || submittingIntent ? <Spinner tone="onAccent" /> : <ArrowUp size={16} />}</Control>}
        </div>
      </div>
    </div>
  </div>;
}

function apiProblemCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const problem = (value as { problem?: unknown }).problem;
  if (!problem || typeof problem !== "object") return undefined;
  const code = (problem as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function commandInvocation(value: string, commands: TaskCommandInfo[]): TaskCommandInfo | null { const match = value.match(/^\/([a-z0-9][a-z0-9:_-]*)(?:\s+[\s\S]*)?$/i); return match ? commands.find((item) => item.name.toLowerCase() === match[1].toLowerCase()) || null : null; }
function visibleGoal(goal?: TaskGoalState): goal is TaskGoalState { return goal?.status === "active" || goal?.status === "paused"; }
function formatMessageTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function cloneComposerNodes(nodes: ComposerNode[]): ComposerNode[] { return nodes.map((node) => node.type === "text" ? { ...node } : { type: "path", path: { ...node.path } }); }
