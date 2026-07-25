import { GitBranch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  SourceControlMutationInput,
  SourceControlSnapshot,
  SourceControlWorktree,
} from "../../shared/contracts.js";
import { suggestSourceControlBranchName } from "../../shared/sourceControlBranchName.js";
import {
  useSourceControl,
  useSourceControlDiff,
  useSourceControlMutation,
} from "../api/hooks.js";
import {
  Control,
  Notice,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  Spinner,
  Text,
  UiIcon,
} from "../../ui/components/index.js";
import styles from "./SourceControlControl.module.css";
import {
  ConfirmSourceControlDialog,
  CreateBranchDialog,
} from "./SourceControlDialogs.js";
import {
  type ChangeSelection,
  SourceControlChanges,
  SourceControlFallbackHeader,
  type SourceControlScreen,
  SourceControlScreenHeader,
  SourceControlWorktrees,
} from "./SourceControlDetails.js";
import {
  SourceControlSummary,
  SourceControlSummaryHeader,
} from "./SourceControlSummary.js";

export function SourceControlControl({ projectId, taskId, taskTitle, className = "" }: {
  projectId: string;
  taskId: string;
  taskTitle: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<SourceControlScreen>("summary");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [customBranchOpen, setCustomBranchOpen] = useState(false);
  const [customBranchName, setCustomBranchName] = useState("");
  const [customBranchError, setCustomBranchError] = useState<string | null>(null);
  const [branchPickerError, setBranchPickerError] = useState<string | null>(null);
  const [discardRequest, setDiscardRequest] = useState<{ paths: string[]; expectedStateToken: string } | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [removeWorktreeRequest, setRemoveWorktreeRequest] = useState<{
    worktree: SourceControlWorktree;
    expectedStateToken: string;
  } | null>(null);
  const [removeWorktreeError, setRemoveWorktreeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChangeSelection | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [remote, setRemote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const operationRef = useRef(false);
  const source = useSourceControl(projectId, open);
  const mutation = useSourceControlMutation(projectId);
  const snapshot = source.data;
  const diff = useSourceControlDiff(
    projectId,
    selected?.path || null,
    selected?.staged || false,
    open && screen === "changes" && Boolean(snapshot?.repository),
  );
  const suggestedBranch = useMemo(
    () => suggestSourceControlBranchName(taskTitle, taskId),
    [taskId, taskTitle],
  );
  const pending = operationPending || mutation.isPending;
  const locked = Boolean(snapshot?.writeLocked)
    || source.isFetching
    || source.isError
    || !reconciled
    || pending;

  useEffect(() => {
    if (!snapshot) return;
    if (!remote || !snapshot.remotes.includes(remote)) setRemote(snapshot.remotes[0] || "");
    if (!selected) return;
    const file = snapshot.files.find((entry) => entry.path === selected.path);
    if (!file) setSelected(null);
    else if (selected.staged && !file.staged && file.unstaged) setSelected({ path: file.path, staged: false });
    else if (!selected.staged && !file.unstaged && file.staged) setSelected({ path: file.path, staged: true });
  }, [remote, selected, snapshot]);

  const reconcile = async () => {
    setReconciled(false);
    try {
      const next = (await source.refetch()).data || null;
      setReconciled(Boolean(next));
      return next;
    } catch {
      setReconciled(false);
      return null;
    }
  };
  const run = async (input: SourceControlMutationInput) => {
    setError(null);
    try {
      const result = await mutation.mutateAsync(input);
      if (!result.refreshRequired && result.snapshot) {
        setReconciled(true);
        return result;
      }
      const current = await reconcile();
      if (!current) setError(t("sourceControlRefreshNeeded"));
      return { ...result, snapshot: current };
    } catch (cause) {
      setError(errorText(cause));
      await reconcile();
      throw cause;
    }
  };
  const startOperation = (operation: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperationPending(true);
    void operation().catch(() => undefined).finally(() => {
      operationRef.current = false;
      setOperationPending(false);
    });
  };
  const createBranch = async (requestedName: string, collision: "reject" | "suffix") => {
    if (!snapshot?.repository) return;
    await run({
      action: "createAndCheckoutBranch",
      requestedName,
      collision,
      ...expectedState(snapshot),
    });
    setBranchPickerOpen(false);
  };
  const submitCustomBranch = async () => {
    setCustomBranchError(null);
    try {
      await createBranch(customBranchName, "reject");
      setCustomBranchOpen(false);
    } catch (cause) {
      setCustomBranchError(errorText(cause));
    }
  };
  const commit = async (pushAfter: boolean) => {
    if (!snapshot?.repository) return;
    const committed = await run({
      action: "commit",
      message: commitMessage,
      includeUnstaged,
      ...expectedState(snapshot),
    });
    setCommitMessage("");
    if (!pushAfter) return;
    const authoritative = committed.snapshot;
    if (!authoritative?.repository) {
      setError(t("commitSucceededPushSkipped"));
      return;
    }
    try {
      await run({
        action: "push",
        ...(!authoritative.branch.upstream ? { remote } : {}),
        ...expectedState(authoritative),
      });
    } catch (cause) {
      setError(`${t("commitSucceededPushFailed")} ${errorText(cause)}`);
    }
  };
  const push = async () => {
    if (!snapshot?.repository) return;
    await run({
      action: "push",
      ...(!snapshot.branch.upstream ? { remote } : {}),
      ...expectedState(snapshot),
    });
  };
  const confirmDiscard = async () => {
    if (!discardRequest) return;
    setDiscardError(null);
    try {
      await run({ action: "discard", paths: discardRequest.paths, confirmation: "discard", expectedStateToken: discardRequest.expectedStateToken });
      setDiscardRequest(null);
    } catch (cause) {
      setDiscardError(errorText(cause));
    }
  };
  const confirmRemoveWorktree = async () => {
    if (!removeWorktreeRequest) return;
    setRemoveWorktreeError(null);
    try {
      await run({
        action: "removeWorktree",
        worktreeId: removeWorktreeRequest.worktree.id,
        confirmation: "remove",
        expectedStateToken: removeWorktreeRequest.expectedStateToken,
      });
      setRemoveWorktreeRequest(null);
    } catch (cause) {
      setRemoveWorktreeError(errorText(cause));
    }
  };

  return <>
    <PopoverRoot open={open} onOpenChange={(next) => {
      if (!next && operationRef.current) return;
      setOpen(next);
      if (next) {
        setReconciled(false);
        void reconcile();
      } else {
        setBranchPickerOpen(false);
        setScreen("summary");
      }
    }}>
      <PopoverTrigger asChild>
        <Control recipe="icon" density="titlebar" shape="none" className={className} data-active-icon={open || undefined} aria-label={t("openSourceControl")} title={t("openSourceControl")}>
          <UiIcon source={GitBranch} />
        </Control>
      </PopoverTrigger>
      <PopoverContent className={styles.popover} sideOffset={4} align="end" collisionPadding={8} role="dialog" aria-label={t("sourceControl")} aria-busy={pending}>
        <div className={styles.shell}>
          {screen === "summary"
            ? snapshot?.repository
              ? <SourceControlSummaryHeader snapshot={snapshot} branchPickerOpen={branchPickerOpen} setBranchPickerOpen={(next) => { if (!next && operationRef.current) return; if (next) setBranchPickerError(null); setBranchPickerOpen(next); }} branchQuery={branchQuery} setBranchQuery={setBranchQuery} suggestedBranch={suggestedBranch} error={branchPickerError} pending={pending} locked={locked} onQuickCreate={() => startOperation(async () => { setBranchPickerError(null); try { await createBranch(suggestedBranch, "suffix"); } catch (cause) { setBranchPickerError(errorText(cause)); } })} onCustomCreate={() => { setCustomBranchName(suggestedBranch); setCustomBranchError(null); setCustomBranchOpen(true); setBranchPickerOpen(false); }} onSwitch={(name) => startOperation(async () => { setBranchPickerError(null); try { await run({ action: "switchBranch", name, ...expectedState(snapshot) }); setBranchPickerOpen(false); } catch (cause) { setBranchPickerError(errorText(cause)); } })} onRefresh={() => void reconcile()} />
              : <SourceControlFallbackHeader pending={pending} onRefresh={() => void reconcile()} />
            : <SourceControlScreenHeader screen={screen} pending={pending} onBack={() => { setScreen("summary"); setSelected(null); }} onRefresh={() => void reconcile()} />}
          <div className={styles.body}>
            {error && <Notice tone="danger" density="compact" role="alert">{error}</Notice>}
            {snapshot?.writeLocked && <Notice tone="warning" density="compact">{t("sourceControlLocked")}</Notice>}
            {source.isLoading && <div className={styles.loading}><Spinner /><Text tone="muted">{t("loading")}</Text></div>}
            {source.isError && <Notice tone="danger">{errorText(source.error)}</Notice>}
            {snapshot && !snapshot.repository && <Notice tone="info">{snapshot.reason}</Notice>}
            {snapshot?.repository && screen === "summary" && <SourceControlSummary snapshot={snapshot} commitMessage={commitMessage} setCommitMessage={setCommitMessage} includeUnstaged={includeUnstaged} setIncludeUnstaged={setIncludeUnstaged} remote={remote} setRemote={setRemote} pending={pending} locked={locked} onCommit={() => startOperation(() => commit(false))} onCommitAndPush={() => startOperation(() => commit(true))} onPush={() => startOperation(push)} onOpenChanges={() => setScreen("changes")} onOpenWorktrees={() => setScreen("worktrees")} />}
            {snapshot?.repository && screen === "changes" && <SourceControlChanges snapshot={snapshot} selected={selected} setSelected={setSelected} diff={diff.data?.patch || ""} diffLoading={diff.isLoading} diffTruncated={Boolean(diff.data?.truncated)} locked={locked} onRefreshDiff={() => void diff.refetch()} onRun={(input) => startOperation(async () => { await run({ ...input, expectedStateToken: snapshot.stateToken }); })} onDiscard={(paths) => { setDiscardError(null); setDiscardRequest({ paths, expectedStateToken: snapshot.stateToken }); }} />}
            {snapshot?.repository && screen === "worktrees" && <SourceControlWorktrees snapshot={snapshot} locked={locked} onPrune={() => startOperation(async () => { await run({ action: "gcWorktrees", expectedStateToken: snapshot.stateToken }); })} onRemove={(worktree) => { setRemoveWorktreeError(null); setRemoveWorktreeRequest({ worktree, expectedStateToken: snapshot.stateToken }); }} />}
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>
    <CreateBranchDialog open={customBranchOpen} name={customBranchName} error={customBranchError} pending={pending} locked={locked} onNameChange={(value) => { setCustomBranchName(value); setCustomBranchError(null); }} onOpenChange={(next) => { if (!next && operationRef.current) return; setCustomBranchOpen(next); }} onSubmit={() => startOperation(submitCustomBranch)} />
    <ConfirmSourceControlDialog open={Boolean(discardRequest)} title={t("discardChanges")} description={t("discardChangesDescription")} target={discardRequest?.paths.join("\n") || ""} error={discardError} pending={pending} locked={locked} onOpenChange={(next) => { if (!next && !operationRef.current) { setDiscardRequest(null); setDiscardError(null); } }} onConfirm={() => startOperation(confirmDiscard)} />
    <ConfirmSourceControlDialog open={Boolean(removeWorktreeRequest)} title={t("removeWorktree")} description={t("removeWorktreeDescription")} target={removeWorktreeRequest?.worktree.label || ""} error={removeWorktreeError} pending={pending} locked={locked} onOpenChange={(next) => { if (!next && !operationRef.current) { setRemoveWorktreeRequest(null); setRemoveWorktreeError(null); } }} onConfirm={() => startOperation(confirmRemoveWorktree)} />
  </>;
}

function expectedState(snapshot: SourceControlSnapshot) {
  return {
    expectedStateToken: snapshot.stateToken,
  };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
