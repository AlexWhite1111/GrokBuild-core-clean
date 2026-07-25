import { ArrowRight, Check, ChevronDown, FileDiff, FolderGit2, GitBranch, Plus, RefreshCw, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SourceControlSnapshot } from "../../shared/contracts.js";
import {
  Checkbox,
  Control,
  Divider,
  Field,
  Input,
  Notice,
  PanelEmpty,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
  TextArea,
  ThemedSelect,
  UiIcon,
} from "../../ui/components/index.js";
import styles from "./SourceControlControl.module.css";

const BRANCH_LIST_LIMIT = 200;

export function SourceControlSummaryHeader(props: {
  snapshot: SourceControlSnapshot;
  branchPickerOpen: boolean;
  setBranchPickerOpen(value: boolean): void;
  branchQuery: string;
  setBranchQuery(value: string): void;
  suggestedBranch: string;
  error: string | null;
  pending: boolean;
  locked: boolean;
  onQuickCreate(): void;
  onCustomCreate(): void;
  onSwitch(name: string): void;
  onRefresh(): void;
}) {
  const { t } = useTranslation();
  const query = props.branchQuery.trim().toLocaleLowerCase();
  const filtered = props.snapshot.branches.filter((branch) => branch.name.toLocaleLowerCase().includes(query));
  const first = filtered.slice(0, BRANCH_LIST_LIMIT);
  const current = filtered.find((branch) => branch.current);
  const visible = current && !first.includes(current)
    ? [current, ...first.slice(0, BRANCH_LIST_LIMIT - 1)]
    : first;
  return <header className={styles.header}>
    <PopoverRoot open={props.branchPickerOpen} onOpenChange={(open) => {
      props.setBranchPickerOpen(open);
      if (open) props.setBranchQuery("");
    }}>
      <PopoverTrigger asChild>
        <Control recipe="row" density="compact" className={styles.branchTrigger} aria-label={t("chooseGitBranch")}>
          <UiIcon source={GitBranch} size="detail" />
          <span className={styles.branchName}>{props.snapshot.branch.current || t("detachedHead")}</span>
          <ChevronDown size={12} />
        </Control>
      </PopoverTrigger>
      <PopoverContent className={styles.picker} sideOffset={5} align="start" collisionPadding={8} aria-label={t("branches")} aria-busy={props.pending}>
        <div className={styles.pickerSearch}><Input density="compact" autoFocus value={props.branchQuery} onChange={(event) => props.setBranchQuery(event.target.value)} placeholder={t("searchBranches")} aria-label={t("searchBranches")} /></div>
        {props.error && <Notice tone="danger" density="compact" role="alert">{props.error}</Notice>}
        <div className={styles.branchList}>
          {!filtered.length && <PanelEmpty>{t("noMatchingBranches")}</PanelEmpty>}
          {visible.map((branch) => <Control key={branch.name} recipe="row" density="comfortable" className={styles.branchOption} selected={branch.current} aria-current={branch.current ? "true" : undefined} disabled={props.locked || branch.current} onClick={() => props.onSwitch(branch.name)}>
            <UiIcon source={GitBranch} size="detail" />
            <span className={styles.branchCopy}>
              <strong>{branch.name}</strong>
              {(branch.current || branch.upstream) && <small>{branch.current ? t("uncommittedFiles", { count: props.snapshot.files.length }) : branch.upstream}</small>}
            </span>
            {branch.current && <Check size={13} aria-hidden />}
          </Control>)}
          {filtered.length > visible.length && <Notice tone="info" density="compact">{t("sourceControlListLimited", { shown: visible.length, total: filtered.length })}</Notice>}
        </div>
        <Divider className={styles.pickerDivider} />
        <div className={styles.pickerFooter}>
          <Control recipe="row" className={`${styles.actionRow} ${styles.quickBranch}`} disabled={props.locked} onClick={props.onQuickCreate}>
            <Plus size={13} /><span>{t("quickCreateBranch")}</span><code>{props.suggestedBranch}</code>
          </Control>
          <Control recipe="row" className={styles.actionRow} disabled={props.locked} onClick={props.onCustomCreate}>
            <GitBranch size={13} /><span>{t("createAndCheckoutBranch")}</span>
          </Control>
        </div>
      </PopoverContent>
    </PopoverRoot>
    <span className={styles.summaryMeta} aria-label={t("sourceControlSummary", { changes: props.snapshot.files.length, ahead: props.snapshot.branch.ahead, behind: props.snapshot.branch.behind })}>
      <span>{t("changeCount", { count: props.snapshot.files.length })}</span>
      {props.snapshot.branch.ahead > 0 && <span data-direction="ahead">↑{props.snapshot.branch.ahead}</span>}
      {props.snapshot.branch.behind > 0 && <span data-direction="behind">↓{props.snapshot.branch.behind}</span>}
    </span>
    <span className={styles.headerActions}><Control recipe="icon" density="compact" aria-label={t("refresh")} title={t("refresh")} disabled={props.pending} onClick={props.onRefresh}><RefreshCw size={13} /></Control></span>
  </header>;
}

export function SourceControlSummary(props: {
  snapshot: SourceControlSnapshot;
  commitMessage: string;
  setCommitMessage(value: string): void;
  includeUnstaged: boolean;
  setIncludeUnstaged(value: boolean): void;
  remote: string;
  setRemote(value: string): void;
  pending: boolean;
  locked: boolean;
  onCommit(): void;
  onCommitAndPush(): void;
  onPush(): void;
  onOpenChanges(): void;
  onOpenWorktrees(): void;
}) {
  const { t } = useTranslation();
  const stagedCount = props.snapshot.files.filter((file) => file.staged).length;
  const unstagedCount = props.snapshot.files.filter((file) => file.unstaged).length;
  const canCommit = Boolean(props.commitMessage.trim()) && (stagedCount > 0 || (props.includeUnstaged && unstagedCount > 0));
  const canPush = Boolean(props.snapshot.branch.current && (props.snapshot.branch.upstream || props.remote));
  return <div className={styles.commitComposer} aria-busy={props.pending}>
    <TextArea className={styles.commitMessage} appearance="surface" autoGrow minLines={3} maxLines={7} value={props.commitMessage} disabled={props.locked} placeholder={t("commitMessagePlaceholder")} aria-label={t("commitMessage")} onChange={(event) => props.setCommitMessage(event.target.value)} />
    <Checkbox className={styles.commitChoice} checked={props.includeUnstaged} disabled={props.locked || !unstagedCount} label={t("includeUnstagedChanges")} onChange={(event) => props.setIncludeUnstaged(event.target.checked)} />
    {!props.snapshot.branch.upstream && props.snapshot.remotes.length > 0 && <Field label={t("remote")}><ThemedSelect className={styles.remoteSelect} value={props.remote} options={props.snapshot.remotes.map((value) => ({ value, label: value }))} onValueChange={props.setRemote} ariaLabel={t("remote")} disabled={props.locked} /></Field>}
    {!props.snapshot.branch.upstream && props.snapshot.remotes.length === 0 && <Notice tone="info" density="compact">{t("noRemoteConfigured")}</Notice>}
    <div className={styles.actionList}>
      <Control recipe="row" selected={canCommit} className={styles.actionRow} disabled={props.locked || !canCommit} onClick={props.onCommit}><Check size={14} /><span>{t("commit")}</span></Control>
      <Control recipe="row" className={styles.actionRow} disabled={props.locked || !canCommit || !canPush} onClick={props.onCommitAndPush}><Send size={14} /><span>{t("commitAndPush")}</span></Control>
      <Control recipe="row" className={styles.actionRow} disabled={props.locked || !canPush} onClick={props.onPush}><Send size={14} /><span>{t("push")}</span></Control>
    </div>
    <div className={styles.navigation}>
      <Control recipe="row" className={styles.actionRow} onClick={props.onOpenChanges}><FileDiff size={13} /><span>{t("viewChanges")}</span><small className={styles.actionMeta}>{props.snapshot.files.length}</small><ArrowRight size={12} /></Control>
      <Control recipe="row" className={styles.actionRow} onClick={props.onOpenWorktrees}><FolderGit2 size={13} /><span>{t("gitWorktrees")}</span><small className={styles.actionMeta}>{props.snapshot.worktrees.length}</small><ArrowRight size={12} /></Control>
    </div>
  </div>;
}
