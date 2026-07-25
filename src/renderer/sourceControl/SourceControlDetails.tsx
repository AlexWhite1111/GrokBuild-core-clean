import { ArrowLeft, FileDiff, FolderGit2, GitBranch, ListMinus, ListPlus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SourceControlFile, SourceControlMutationInput, SourceControlSnapshot, SourceControlWorktree } from "../../shared/contracts.js";
import { Badge, Control, Notice, PanelEmpty, PanelRow, PanelSection, Spinner, Text, UiIcon } from "../../ui/components/index.js";
import styles from "./SourceControlControl.module.css";

const CHANGE_LIST_LIMIT = 200;

export type SourceControlScreen = "summary" | "changes" | "worktrees";
export type ChangeSelection = { path: string; staged: boolean };
type ChangeMutation = Omit<Extract<SourceControlMutationInput, { action: "stage" | "unstage" }>, "expectedStateToken">;

export function SourceControlFallbackHeader({ pending, onRefresh }: { pending: boolean; onRefresh(): void }) {
  const { t } = useTranslation();
  return <header className={styles.header}>
    <div className={styles.screenHeader}><UiIcon source={GitBranch} size="detail" /><Text as="strong" weight="semibold">{t("sourceControl")}</Text></div>
    <span className={styles.headerActions}><Control recipe="icon" density="compact" aria-label={t("refresh")} title={t("refresh")} disabled={pending} onClick={onRefresh}><RefreshCw size={13} /></Control></span>
  </header>;
}

export function SourceControlScreenHeader({ screen, pending, onBack, onRefresh }: { screen: Exclude<SourceControlScreen, "summary">; pending: boolean; onBack(): void; onRefresh(): void }) {
  const { t } = useTranslation();
  return <header className={styles.header}>
    <div className={styles.screenHeader}>
      <Control recipe="icon" density="compact" aria-label={t("backToSourceControl")} title={t("backToSourceControl")} onClick={onBack}><ArrowLeft size={13} /></Control>
      <Text as="strong" weight="semibold">{screen === "changes" ? t("changes") : t("gitWorktrees")}</Text>
    </div>
    <span className={styles.headerActions}><Control recipe="icon" density="compact" aria-label={t("refresh")} title={t("refresh")} disabled={pending} onClick={onRefresh}><RefreshCw size={13} /></Control></span>
  </header>;
}

export function SourceControlChanges(props: {
  snapshot: SourceControlSnapshot;
  selected: ChangeSelection | null;
  setSelected(value: ChangeSelection): void;
  diff: string;
  diffLoading: boolean;
  diffTruncated: boolean;
  locked: boolean;
  onRefreshDiff(): void;
  onRun(input: ChangeMutation): void;
  onDiscard(paths: string[]): void;
}) {
  const { t } = useTranslation();
  const staged = props.snapshot.files.filter((file) => file.staged);
  const unstaged = props.snapshot.files.filter((file) => file.unstaged);
  const visibleStaged = staged.slice(0, CHANGE_LIST_LIMIT);
  const visibleUnstaged = unstaged.slice(0, CHANGE_LIST_LIMIT);
  return <div className={styles.sectionStack}>
    <PanelSection icon={ListPlus} title={t("staged")} count={staged.length || undefined}>
      {!staged.length && <PanelEmpty>{t("noStagedChanges")}</PanelEmpty>}
      {visibleStaged.map((file) => <ChangeRow key={`staged:${file.path}`} file={file} staged selected={props.selected?.path === file.path && props.selected.staged} locked={props.locked} onSelect={props.setSelected} onRun={props.onRun} onDiscard={props.onDiscard} />)}
      {staged.length > visibleStaged.length && <Notice tone="info" density="compact">{t("sourceControlListLimited", { shown: visibleStaged.length, total: staged.length })}</Notice>}
    </PanelSection>
    <PanelSection icon={ListMinus} title={t("unstaged")} count={unstaged.length || undefined}>
      {!unstaged.length && <PanelEmpty>{t("noUnstagedChanges")}</PanelEmpty>}
      {visibleUnstaged.map((file) => <ChangeRow key={`unstaged:${file.path}`} file={file} staged={false} selected={props.selected?.path === file.path && !props.selected.staged} locked={props.locked} onSelect={props.setSelected} onRun={props.onRun} onDiscard={props.onDiscard} />)}
      {unstaged.length > visibleUnstaged.length && <Notice tone="info" density="compact">{t("sourceControlListLimited", { shown: visibleUnstaged.length, total: unstaged.length })}</Notice>}
    </PanelSection>
    {props.selected && <PanelSection title={props.selected.path} action={{ label: t("refresh"), icon: RefreshCw, onClick: props.onRefreshDiff }}>
      {props.diffLoading ? <div className={styles.loading}><Spinner size="compact" /></div> : <pre className={styles.diff} data-shape="control">{props.diff || t("noDiffContent")}</pre>}
      {props.diffTruncated && <Notice tone="warning" density="compact">{t("diffTruncated")}</Notice>}
    </PanelSection>}
  </div>;
}

function ChangeRow({ file, staged, selected, locked, onSelect, onRun, onDiscard }: {
  file: SourceControlFile;
  staged: boolean;
  selected: boolean;
  locked: boolean;
  onSelect(value: ChangeSelection): void;
  onRun(input: ChangeMutation): void;
  onDiscard(paths: string[]): void;
}) {
  const { t } = useTranslation();
  const tone = changeTone(file, staged);
  const action = staged
    ? { label: t("unstageChange"), icon: ListMinus, disabled: locked, onClick: () => onRun({ action: "unstage", paths: [file.path] }) }
    : { label: t("stageChange"), icon: ListPlus, disabled: locked, onClick: () => onRun({ action: "stage", paths: [file.path] }) };
  return <PanelRow icon={FileDiff} title={file.path} detail={staged ? t("staged") : changeLabel(file, t)} meta={<span className={styles.changeStatus} data-tone={tone}>{`${file.indexStatus}${file.worktreeStatus}`}</span>} tone={tone} selected={selected} onClick={() => onSelect({ path: file.path, staged })} actions={[action, ...(!staged ? [{ label: t("discardChanges"), icon: Trash2, tone: "danger" as const, disabled: locked, onClick: () => onDiscard([file.path]) }] : [])]} />;
}

export function SourceControlWorktrees({ snapshot, locked, onPrune, onRemove }: { snapshot: SourceControlSnapshot; locked: boolean; onPrune(): void; onRemove(worktree: SourceControlWorktree): void }) {
  const { t } = useTranslation();
  return <PanelSection icon={FolderGit2} title={t("gitWorktrees")} count={snapshot.worktrees.length} action={{ label: t("pruneWorktrees"), icon: RefreshCw, disabled: locked, onClick: onPrune }}>
    {!snapshot.worktrees.length && <PanelEmpty>{t("noGitWorktrees")}</PanelEmpty>}
    {snapshot.worktrees.map((worktree) => <PanelRow key={worktree.id} icon={FolderGit2} title={worktree.label} detail={worktree.branch || t("detachedHead")} tone={worktree.current ? "accent" : worktree.prunable ? "warning" : "neutral"} trailing={worktree.current ? <Badge tone="accent">{t("current")}</Badge> : worktree.indexedProject ? <Badge>{t("projectGroup")}</Badge> : undefined} actions={worktree.current ? [] : [{ label: t("removeWorktree"), icon: Trash2, tone: "danger", disabled: locked || worktree.locked || worktree.indexedProject, onClick: () => onRemove(worktree) }]} />)}
  </PanelSection>;
}

function changeLabel(file: Pick<SourceControlFile, "untracked" | "conflicted">, translate: (key: string) => string): string {
  if (file.conflicted) return translate("conflict");
  if (file.untracked) return translate("untracked");
  return translate("modified");
}

function changeTone(file: Pick<SourceControlFile, "untracked" | "conflicted">, staged: boolean): "success" | "warning" | "info" | "danger" {
  if (file.conflicted) return "danger";
  if (file.untracked) return "info";
  return staged ? "success" : "warning";
}
