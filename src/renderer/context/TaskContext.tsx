import { ChevronRight, Paperclip, Plus, Square, X } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ContextHistoryItem, PathReferenceSummary, SavedContextResource, TaskDetailProjection, WorkItemSnapshot } from "../../shared/contracts.js";
import { firstMarkdownHeading } from "../design/markdownTitle.js";
import { snapshotDroppedFiles } from "../files/dropFiles.js";
import { Collapsible } from "../../ui/primitives/index.js";
import { Control, Notice, operationalGlyphs, PanelEmpty, PanelRow, PanelSection, PATH_CHIP_MIME, ResizeHandle, SegmentedControl, Surface, UiIcon, readPathChipTransfer } from "../../ui/components/index.js";
import { ContextResourceView } from "./ContextResourceView.js";
import { projectTaskContext, sameTaskResourceInputs, type TaskContextProjection } from "./contextProjection.js";
import { localizedSubagentTitle } from "./subagentTitle.js";
import { TaskTodoGroup } from "./TaskTodoGroup.js";
import { useRightRailResize } from "../layout/useRightRailResize.js";
import styles from "./TaskContext.module.css";

export type ContextSectionId = "planning" | "work" | "context";

interface TaskContextProps {
  detail: TaskDetailProjection;
  savedResources: SavedContextResource[];
  focus: ContextSectionId;
  width: number;
  onWidthChange: (value: number) => void;
  onFocusChange: (section: ContextSectionId) => void;
  onClose: () => void;
  onOpenPlan: () => void;
  onOpenChild: (item: WorkItemSnapshot) => void;
  canStopWork?: (item: WorkItemSnapshot) => boolean;
  onStopWork?: (item: WorkItemSnapshot) => void;
  workStopPending?: boolean;
  canCancelTodo?: boolean;
  todoCancelPending?: boolean;
  onCancelTodo?: () => void;
  onAddResources: (paths: PathReferenceSummary[]) => void;
  onRemoveResource: (path: PathReferenceSummary) => void;
}

export function TaskContext(props: TaskContextProps) {
  const { t } = useTranslation();
  const { detail, savedResources = [], focus } = props;
  const { snapshot } = detail;
  const projection = useStableTaskContextProjection(detail, savedResources);
  const activeAgents = useMemo(
    () => projection.activeWork.filter((item) => item.kind === "agent"),
    [projection.activeWork],
  );
  const history = useMemo(
    () => historyForSection(projection.history, focus),
    [focus, projection.history],
  );
  const resources = useMemo(
    () => [...projection.inputs, ...projection.artifacts]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [projection.artifacts, projection.inputs],
  );
  const savedPathKeys = useMemo(
    () => new Set(savedResources.map((item) => pathKey(item.path))),
    [savedResources],
  );
  const [dropActive, setDropActive] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const { liveWidth, beginResize, resizeWithKeyboard } = useRightRailResize(props);
  const sectionOptions = (["planning", "work", "context"] as const).map((value) => ({
    value,
    label: value === "work" ? t("subagent") : t(value),
    icon: value === "planning" ? operationalGlyphs.todo : value === "work" ? operationalGlyphs.subagent : Paperclip,
  }));

  const chooseResources = async () => {
    const paths = await window.grokDesktop?.choosePaths("files", snapshot.projectId) || [];
    if (paths.length) props.onAddResources(paths);
  };
  const dropResources = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const path = readPathChipTransfer(event.dataTransfer);
    if (path) { setDropError(null); props.onAddResources([path]); return; }
    const files = event.dataTransfer ? snapshotDroppedFiles(event.dataTransfer) : [];
    if (!files.length || !window.grokDesktop) { setDropError(t("dropFilesUnavailable")); return; }
    void window.grokDesktop.registerDroppedFiles(files, snapshot.projectId).then((paths) => {
      setDropError(null);
      if (paths.length) props.onAddResources(paths);
      else setDropError(t("dropFilesUnavailable"));
    }).catch((cause) => setDropError(cause instanceof Error ? cause.message : t("dropFilesUnavailable")));
  };

  return <Surface as="aside" appearance="drawer" elevation="none" shape="none" aria-label={t("taskContext")} className={styles.panel} data-context-resource-drop-target data-drop-active={dropActive || undefined} style={{ "--context-width": `${liveWidth}px` } as CSSProperties}
    onDragEnter={(event) => { if (acceptsResourceDrop(event.dataTransfer)) { event.preventDefault(); setDropActive(true); } }}
    onDragOver={(event) => { if (acceptsResourceDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropActive(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }} onDrop={dropResources}>
    <ResizeHandle orientation="vertical" side="start" tabIndex={0} aria-label={t("resizeContext")} aria-valuemin={280} aria-valuemax={520} aria-valuenow={liveWidth} onPointerDown={beginResize} onKeyDown={resizeWithKeyboard} />
    <header className={styles.navigation}><SegmentedControl value={focus} options={sectionOptions} onChange={props.onFocusChange} ariaLabel={t("taskContext")} /></header>
    <div className={styles.sections}>
      {dropError && <Notice tone="danger" density="compact" role="alert">{dropError}<Control recipe="icon" density="detail" tone="danger" onClick={() => setDropError(null)} aria-label={t("close")}><X size={11} /></Control></Notice>}
      {focus === "planning" && <>
        <PanelSection icon={operationalGlyphs.plan} title={t("plan")} active={snapshot.workMode === "plan" || snapshot.gates.some((gate) => gate.kind === "planReview")}>
          <PanelRow title={firstMarkdownHeading(snapshot.plan.document?.content, t("plan"))} trailing={<UiIcon source={ChevronRight} size="detail" />} wrap contentText onClick={props.onOpenPlan} />
        </PanelSection>
        {projection.currentTodo && <TaskTodoGroup group={projection.currentTodo} cancellable={props.canCancelTodo} cancelPending={props.todoCancelPending} onCancel={props.onCancelTodo} />}
      </>}
      {focus === "work" && <PanelSection icon={operationalGlyphs.subagent} title={t("subagent")} count={activeAgents.length || undefined} active={activeAgents.some((item) => item.status === "pending" || item.status === "running")}>
        <div className={styles.agentList} aria-label={t("subagent")} data-agent-list>
          {activeAgents.map((item) => <AgentRow key={item.id} item={item} onOpen={props.onOpenChild} canStop={props.canStopWork?.(item) === true} stopPending={props.workStopPending} onStop={props.onStopWork} />)}
          {!activeAgents.length && <PanelEmpty>{t("noRunningTasks")}</PanelEmpty>}
        </div>
      </PanelSection>}
      {focus === "context" && <PanelSection icon={Paperclip} title={t("context")} count={resources.length || undefined} action={{ label: t("addResource"), onClick: () => void chooseResources(), icon: Plus }}>
        <Surface appearance="plain" shape="surface" selected={dropActive} className={styles.resourceDrop}>
          {resources.map((item) => <ContextResourceView key={item.id} item={item} taskId={snapshot.taskId} projectId={snapshot.projectId} removable={Boolean(item.path && savedPathKeys.has(pathKey(item.path)))} onRemove={item.path ? () => props.onRemoveResource(item.path!) : undefined} />)}
          {!resources.length && <PanelEmpty>{t("dropFilesHere")}</PanelEmpty>}
        </Surface>
      </PanelSection>}
      <History items={history} onOpenChild={props.onOpenChild} />
    </div>
    {dropActive && <div className={styles.dropOverlay} role="status"><UiIcon source={Paperclip} size="prominent" /><span>{t("dropContextHere")}</span></div>}
  </Surface>;
}

function History({ items, onOpenChild }: { items: ContextHistoryItem[]; onOpenChild: (item: WorkItemSnapshot) => void }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const rounds = groupHistoryRounds(items);
  return <section className={styles.history} aria-label={t("history")} data-context-history>
    <header className={styles.historyDivider}><span>{t("history")}</span><span>{items.length}</span></header>
    {rounds.map((round, index) => <HistoryRound key={`${round.id}:${index === 0 ? "latest" : "older"}`} round={round} latest={index === 0} onOpenChild={onOpenChild} />)}
  </section>;
}

interface HistoryRoundModel { id: string; occurredAt: string; items: ContextHistoryItem[] }

function HistoryRound({ round, latest, onOpenChild }: { round: HistoryRoundModel; latest: boolean; onOpenChild: (item: WorkItemSnapshot) => void }) {
  const { t } = useTranslation();
  return <Collapsible defaultOpen={latest}>{({ open, toggle }) => <section className={styles.historyRound} data-history-round={round.id} data-open={open || undefined}>
    <Control recipe="row" density="compact" className={styles.historyRoundHeader} aria-expanded={open} onClick={toggle}>
      <UiIcon source={ChevronRight} size="detail" className={styles.historyRoundChevron} />
      <span className={styles.historyRoundTitle}>{t(latest ? "previousRound" : "earlierRound")}</span>
      <time className={styles.historyRoundTime}>{formatTime(round.occurredAt)}</time>
      {round.items.length > 1 && <span className={styles.historyRoundCount}>{round.items.length}</span>}
    </Control>
    {open && <div className={styles.historyRoundBody}>{round.items.map((item) => <HistoryRow key={item.id} item={item} onOpenChild={onOpenChild} />)}</div>}
  </section>}</Collapsible>;
}

function AgentRow({ item, onOpen, canStop, stopPending, onStop }: { item: WorkItemSnapshot; onOpen: (item: WorkItemSnapshot) => void; canStop: boolean; stopPending?: boolean; onStop?: (item: WorkItemSnapshot) => void }) {
  const { t } = useTranslation();
  const openable = Boolean(item.childSessionId);
  const title = localizedSubagentTitle(item.title, t("subagent"));
  const activity = item.currentActivity && item.currentActivity !== item.title ? item.currentActivity : undefined;
  const actions = canStop && onStop ? [{ label: t("stopSubagent"), onClick: () => onStop(item), icon: Square, tone: "danger" as const, disabled: stopPending }] : [];
  return <div className={styles.agentItem} data-agent-status={item.status} data-running={item.status === "pending" || item.status === "running" || undefined}><PanelRow icon={operationalGlyphs.subagent} title={title} detail={activity} trailing={openable ? <UiIcon source={ChevronRight} size="detail" /> : undefined} actions={actions} tone={workStatusTone(item.status)} contentText onClick={openable ? () => onOpen(item) : undefined} /></div>;
}

function HistoryRow({ item, onOpenChild }: { item: ContextHistoryItem; onOpenChild: (item: WorkItemSnapshot) => void }) {
  const { t } = useTranslation();
  if (item.kind === "todo") return <TaskTodoGroup group={item.todo} />;
  if (item.kind === "plan") return <PanelRow icon={operationalGlyphs.plan} title={item.title || t("plan")} detail={item.status} wrap contentText />;
  const openable = Boolean(item.work.childSessionId);
  return <PanelRow icon={operationalGlyphs.subagent} title={localizedSubagentTitle(item.work.title, t("subagent"))} trailing={openable ? <UiIcon source={ChevronRight} size="detail" /> : undefined} onClick={openable ? () => onOpenChild(item.work) : undefined} tone={workStatusTone(item.work.status)} wrap contentText />;
}

function groupHistoryRounds(items: ContextHistoryItem[]): HistoryRoundModel[] {
  const rounds = new Map<string, HistoryRoundModel>();
  for (const item of items) {
    const id = item.turnId || `item:${item.id}`;
    const round = rounds.get(id);
    if (round) {
      round.items.push(item);
      if (item.occurredAt > round.occurredAt) round.occurredAt = item.occurredAt;
    } else rounds.set(id, { id, occurredAt: item.occurredAt, items: [item] });
  }
  return [...rounds.values()].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function historyForSection(items: ContextHistoryItem[], section: ContextSectionId): ContextHistoryItem[] {
  if (section === "planning") return items.filter((item) => item.kind !== "work");
  if (section === "work") return items.filter((item) => item.kind === "work" && item.work.kind === "agent");
  return [];
}
function workStatusTone(status: WorkItemSnapshot["status"]): "neutral" | "accent" | "success" | "warning" | "danger" { return status === "unconfirmed" ? "neutral" : status === "pending" || status === "running" ? "accent" : status === "completed" ? "success" : status === "failed" ? "danger" : "warning"; }
function formatTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function pathKey(path: Pick<PathReferenceSummary, "withinProject" | "displayPath">): string { return `${path.withinProject ? "project" : "external"}:${path.displayPath}`; }
function acceptsResourceDrop(transfer: DataTransfer): boolean { const types = Array.from(transfer.types); return types.includes(PATH_CHIP_MIME) || types.includes("Files"); }

function useStableTaskContextProjection(
  detail: TaskDetailProjection,
  savedResources: SavedContextResource[],
): TaskContextProjection {
  const cache = useRef<{
    detail: TaskDetailProjection;
    savedResources: SavedContextResource[];
    projection: TaskContextProjection;
  } | null>(null);
  const previous = cache.current;
  const resourcesStable = Boolean(
    previous
    && previous.savedResources === savedResources
    && sameTaskResourceInputs(previous.detail.messages, detail.messages),
  );
  if (
    previous
    && resourcesStable
    && previous.detail.context === detail.context
  ) return previous.projection;

  const projection = resourcesStable && previous
    ? {
        ...detail.context,
        inputs: previous.projection.inputs,
        artifacts: previous.projection.artifacts,
      }
    : projectTaskContext(detail, savedResources);
  cache.current = { detail, savedResources, projection };
  return projection;
}
