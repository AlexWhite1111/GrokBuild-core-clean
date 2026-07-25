import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { useAccount, useAccountStatus, useCapabilities, useTaskIntents, useWorkspace } from "../api/hooks.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import type { SystemPromptPreset, TaskSystemPrompt } from "../../shared/contracts.js";
import { OnboardingPanel } from "../onboarding/OnboardingPanel.js";
import styles from "./NewTaskPage.module.css";
import { accountViewState, effectiveAccount } from "../onboarding/accountState.js";
import { Notice } from "../../ui/components/index.js";
import { TaskPageLoading } from "./TaskPageLoading.js";

export function NewTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { api } = useBootstrap();
  const capabilities = useCapabilities().data;
  const workspace = useWorkspace().data;
  const project = workspace.projects.find((item) => item.active) || workspace.projects[0];
  const permissionModes = workspace.supervisor.permissionModes;
  const account = useAccount();
  const accountStatus = useAccountStatus();
  const [error, setError] = useState<string | null>(null);
  const createTask = useTaskIntents().create.mutateAsync;
  const startedKey = useRef<string | null>(null);
  const activeKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const accountState = accountViewState(accountStatus.data, account.data, account.isPending, account.isError);
  const signedIn = accountState === "authenticated";
  const draftKey = project ? `new:${project.projectId}${api.bootstrap.windowId ? `:${api.bootstrap.windowId}` : ""}` : undefined;
  const activationKey = signedIn && project && capabilities.status !== "unavailable"
    ? `${project.projectId}:${api.bootstrap.windowId || "shared"}`
    : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    activeKey.current = activationKey;
    if (!activationKey || !project || !draftKey || startedKey.current === activationKey) return;
    startedKey.current = activationKey;
    const requestStorageKey = `grok-build.new-task-request:${activationKey}`;
    const requestId = storedRequestId(requestStorageKey);
    const saved = project.defaults;
    const permission = permissionModes.some((mode) => mode.mode === saved.permission && mode.available)
      ? saved.permission
      : "ask";
    const preset = workspace.systemPromptPresets.find((item) => item.presetId === saved.systemPromptPresetId);
    const defaultModel = account.data?.models.defaultModel
      || account.data?.models.available.find((model) => model.isDefault)?.id
      || null;
    setError(null);
    void createTask({
      requestId,
      projectId: project.projectId,
      modelId: saved.modelId || defaultModel,
      effort: saved.effort,
      workMode: "normal",
      permission,
      sandbox: saved.sandbox,
      systemPrompt: promptFromPreset(preset),
      draftKey,
    }).then(async (task) => {
      sessionStorage.removeItem(requestStorageKey);
      if (window.grokDesktop) {
        try {
          await window.grokDesktop.transferTextClips({
            fromOwnerKey: draftKey,
            toOwnerKey: `task:${task.taskId}`,
          });
        } catch (cause) {
          if (mounted.current && activeKey.current === activationKey) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
      }
      if (mounted.current && activeKey.current === activationKey) {
        navigate(`/tasks/${task.taskId}`, { replace: true });
      }
    }).catch((cause) => {
      if (mounted.current && activeKey.current === activationKey) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [
    account.data?.models.available,
    account.data?.models.defaultModel,
    activationKey,
    createTask,
    draftKey,
    navigate,
    permissionModes,
    project,
    workspace.systemPromptPresets,
  ]);

  if (accountState === "unauthenticated") return <main className={styles.page}>
    <div className={styles.center}><OnboardingPanel account={effectiveAccount(accountStatus.data, account.data)} capabilities={capabilities} project={project} /></div>
  </main>;
  if (accountState === "error") return <main className={styles.page}>
    <div className={styles.center}><Notice tone="danger" density="compact" role="alert">{account.error instanceof Error ? account.error.message : t("startupFailed")}</Notice></div>
  </main>;
  if (signedIn && !project) return <main className={styles.page}>
    <div className={styles.prompt}><Trans i18nKey="newTaskQuestion" values={{ project: "Project" }} components={{ project: <button type="button" data-rich-link onClick={() => void window.grokDesktop?.chooseProject()} /> }} /></div>
  </main>;
  if (capabilities.status === "unavailable") return <TaskPageLoading error={t("startupFailed")} />;
  return <TaskPageLoading error={error || undefined} />;
}

function promptFromPreset(preset: SystemPromptPreset | undefined): TaskSystemPrompt | null {
  return preset ? {
    presetId: preset.presetId,
    title: preset.title,
    rules: preset.rules,
    systemPrompt: preset.systemPrompt,
  } : null;
}

function storedRequestId(key: string): string {
  const existing = sessionStorage.getItem(key);
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const requestId = crypto.randomUUID();
  sessionStorage.setItem(key, requestId);
  return requestId;
}
