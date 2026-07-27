import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskContinuationOrigin, TaskDetailProjection, TaskMessageBlock, TaskScrollAnchor, TaskUiState } from "../../shared/contracts.js";
import { projectTaskExecution } from "../../shared/taskExecutionStatus.js";
import { useNavigate } from "react-router-dom";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useUiPreferences } from "../api/hooks.js";
import { Control } from "../../ui/components/index.js";
import { GrokGoalOutcomeBlock, GrokTurnBlock } from "./GrokTurnBlock.js";
import { GrokTurnFlow } from "./GrokTurnFlow.js";
import { MessageBlock } from "./MessageBlock.js";
import { createTurnTimelineProjector, type TimelineItem } from "./turnPresentation.js";
import styles from "./TaskThread.module.css";
import { ConversationForkIcon } from "./ConversationForkIcon.js";
import {
  createThreadScrollAnchor,
  resolveThreadScrollAnchorIndex,
  sameThreadScrollAnchor,
  threadAtBottom,
  threadFollowAfterScroll,
  threadLatestControl,
  threadRowResizeAdjustsScroll,
} from "./threadScroll.js";

type ContinuationItem = { id: string; kind: "continuation"; origin: TaskContinuationOrigin };
type ThreadItem = TimelineItem | ContinuationItem;
type SavedTaskUiState = { taskId: string; value: TaskUiState | null };

export function TaskThread({ detail, bottomInset = 0, onRetry, onEdit, onFork, composerHasDraft = false, persistScroll = true }: { detail: TaskDetailProjection; bottomInset?: number; onRetry?: (message: TaskMessageBlock) => Promise<void> | void; onEdit?: (message: TaskMessageBlock) => void; onFork?: () => Promise<void> | void; composerHasDraft?: boolean; persistScroll?: boolean }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const navigate = useNavigate();
  const preferences = useUiPreferences().data;
  const parent = useRef<HTMLDivElement>(null);
  const anchorTimer = useRef<number | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const pendingAnchor = useRef<{ taskId: string; value: TaskScrollAnchor } | null>(null);
  const submittedAnchor = useRef<TaskScrollAnchor | null>(null);
  const restoring = useRef(true);
  const followLatest = useRef(true);
  const previousScrollTop = useRef(0);
  const [savedState, setSavedState] = useState<SavedTaskUiState | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [topEdge, setTopEdge] = useState(false);
  const [expandedProcesses, setExpandedProcesses] = useState<Record<string, boolean>>({});
  const timelineProjector = useRef<ReturnType<typeof createTurnTimelineProjector> | null>(null);
  if (!timelineProjector.current) timelineProjector.current = createTurnTimelineProjector();
  const projectedItems = timelineProjector.current(detail);
  const items = continuationItems(projectedItems, detail.snapshot.continuedFrom);
  const processExecutions = useMemo(() => new Set(projectedItems
    .filter((item): item is Extract<TimelineItem, { kind: "assistant" }> => item.kind === "assistant")
    .filter((item) => item.turn.segments.some((segment) => segment.kind !== "assistant"))
    .map((item) => item.turn.promptExecutionId)), [projectedItems]);
  const latestGrokItemId = useMemo(() => [...projectedItems].reverse().find((item) =>
    item.kind === "assistant" && item.turn.segments.some((segment) => segment.kind === "assistant" && segment.final && Boolean(segment.message.text.trim())))?.id,
  [projectedItems]);
  const stateLoaded = savedState?.taskId === detail.snapshot.taskId;
  const paddingEnd = composerThreadInset(bottomInset);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    getItemKey: (index) => items[index]?.id || index,
    estimateSize: (index) => items[index]?.kind === "assistant" ? 118 : items[index]?.kind === "lifecycle" || items[index]?.kind === "goal" ? 34 : items[index]?.kind === "continuation" ? 48 : 92,
    overscan: 8,
    paddingEnd,
    anchorTo: "end",
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    threadRowResizeAdjustsScroll(item, instance.scrollOffset ?? 0);
  const totalSize = virtualizer.getTotalSize();
  const scrollToLatest = useCallback(() => {
    if (items.length) virtualizer.scrollToEnd();
  }, [items.length, virtualizer]);
  const persistPendingAnchor = useCallback(() => {
    if (anchorTimer.current != null) window.clearTimeout(anchorTimer.current);
    anchorTimer.current = null;
    const pending = pendingAnchor.current;
    if (!pending || !persistScroll) return;
    pendingAnchor.current = null;
    if (sameThreadScrollAnchor(submittedAnchor.current, pending.value)) return;
    submittedAnchor.current = pending.value;
    void api.post(`/ui/tasks/${pending.taskId}`, {
      requestId: crypto.randomUUID(),
      scrollAnchor: pending.value,
    }).catch(() => {
      if (sameThreadScrollAnchor(submittedAnchor.current, pending.value)) {
        submittedAnchor.current = null;
      }
    });
  }, [api, persistScroll]);
  useLayoutEffect(() => {
    const element = parent.current;
    if (!element || !stateLoaded || restoring.current || !items.length) return;
    const bottom = threadAtBottom(element);
    if (!followLatest.current) {
      setAtBottom(bottom);
      return;
    }
    if (!bottom) scrollToLatest();
  }, [detail.snapshot.taskId, items.length, scrollToLatest, stateLoaded, totalSize]);
  useEffect(() => {
    let current = true;
    restoring.current = true;
    followLatest.current = true;
    previousScrollTop.current = 0;
    submittedAnchor.current = null;
    setSavedState(null);
    setAtBottom(true);
    if (!persistScroll) {
      setSavedState({ taskId: detail.snapshot.taskId, value: null });
      return () => { current = false; };
    }
    void api.get<TaskUiState>(`/ui/tasks/${detail.snapshot.taskId}`).then((state) => {
      if (!current) return;
      submittedAnchor.current = state.scrollAnchor;
      setSavedState({ taskId: detail.snapshot.taskId, value: state });
    }).catch(() => {
      if (!current) return;
      setSavedState({ taskId: detail.snapshot.taskId, value: null });
    });
    return () => {
      current = false;
      persistPendingAnchor();
    };
  }, [api, detail.snapshot.taskId, persistPendingAnchor, persistScroll]);
  useEffect(() => setExpandedProcesses({}), [detail.snapshot.taskId]);
  useLayoutEffect(() => {
    if (
      !stateLoaded
      || !items.length
      || !restoring.current
    ) return;
    // Close the restoration gate before scrolling. TanStack Virtual may publish
    // a synchronous measurement update from scrollToIndex; leaving the gate
    // open lets this layout effect re-enter during rapid task switches until
    // React aborts the entire root with a maximum-update-depth error.
    restoring.current = false;
    if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
    const anchor = savedState?.value?.scrollAnchor;
    if (!anchor || anchor.followLatest) {
      followLatest.current = true;
      setAtBottom(true);
      scrollToLatest();
      return;
    }
    const index = resolveThreadScrollAnchorIndex(items, anchor);
    followLatest.current = false;
    setAtBottom(false);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = requestAnimationFrame(() => {
        const row = virtualizer.getVirtualItems().find((item) => item.index === index);
        if (row) {
          virtualizer.scrollToOffset(Math.max(0, row.start + anchor.offset));
          previousScrollTop.current = parent.current?.scrollTop || 0;
        }
        restoreFrame.current = null;
      });
    });
    virtualizer.scrollToIndex(index, { align: "start" });
  }, [items, savedState, scrollToLatest, stateLoaded, virtualizer]);
  useEffect(() => {
    const element = parent.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => setTopEdge(element.scrollTop > 4));
    return () => cancelAnimationFrame(frame);
  }, [items.length]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") persistPendingAnchor(); };
    window.addEventListener("blur", persistPendingAnchor);
    window.addEventListener("pagehide", persistPendingAnchor);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", persistPendingAnchor);
      window.removeEventListener("pagehide", persistPendingAnchor);
      document.removeEventListener("visibilitychange", onVisibility);
      persistPendingAnchor();
    };
  }, [persistPendingAnchor]);
  useEffect(() => () => {
    if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
  }, []);
  const onScroll = () => {
    const element = parent.current;
    if (!element) return;
    const previous = previousScrollTop.current;
    previousScrollTop.current = element.scrollTop;
    const bottom = threadAtBottom(element);
    setTopEdge(element.scrollTop > 4);
    setAtBottom(bottom);
    if (restoring.current || restoreFrame.current != null) return;
    followLatest.current = threadFollowAfterScroll(
      followLatest.current,
      previous,
      element.scrollTop,
      bottom,
    );
    const visible = virtualizer.getVirtualItems().find((row) => row.end > element.scrollTop + 1) || virtualizer.getVirtualItems()[0];
    if (visible) {
      const scrollAnchor = createThreadScrollAnchor(items, visible.index, element.scrollTop, visible.start, followLatest.current);
      if (sameThreadScrollAnchor(submittedAnchor.current, scrollAnchor)) return;
      pendingAnchor.current = { taskId: detail.snapshot.taskId, value: scrollAnchor };
      if (anchorTimer.current != null) window.clearTimeout(anchorTimer.current);
      anchorTimer.current = window.setTimeout(persistPendingAnchor, 240);
    }
  };
  const latest = () => {
    followLatest.current = true;
    setAtBottom(true);
    scrollToLatest();
  };
  const latestControl = threadLatestControl(atBottom, projectTaskExecution(detail.snapshot).busy);

  return <div className={styles.frame} style={{ "--thread-bottom-inset": `${paddingEnd}px` } as CSSProperties}>
    <div
      ref={parent}
      data-thread-scroll
      className={styles.scroller}
      tabIndex={0}
      aria-label={t("thread")}
      onScroll={onScroll}
      onWheel={(event) => { if (event.deltaY < 0) followLatest.current = false; }}
    >
      <div className={styles.virtual} style={{ height: `${totalSize}px` }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          const processAvailable = item.kind === "assistant" && processExecutions.has(item.turn.promptExecutionId);
          const processExpanded = item.kind === "assistant"
            ? expandedProcesses[item.turn.promptExecutionId] ?? !preferences.collapseWorkProcessByDefault
            : true;
          return <div key={item.id} ref={virtualizer.measureElement} data-index={row.index} data-item-id={item.id} className={styles.item} style={{ top: `${row.start}px` }}>
            <div className={styles.row}>
              {item.kind === "continuation"
                ? <div className={styles.continuation}><span aria-hidden /><Control recipe="text" density="compact" shape="none" hover="color" onClick={() => navigate(`/tasks/${item.origin.taskId}`)} aria-label={t("continuedFromChat", { defaultValue: "Continued from chat" })} title={item.origin.title}><ConversationForkIcon width={13} height={13} /><span>{t("continuedFromChat", { defaultValue: "Continued from chat" })}</span></Control><span aria-hidden /></div>
                : item.kind === "user"
                ? <MessageBlock taskId={detail.snapshot.taskId} message={item.message} renderPolicy={preferences.richTextRenderPolicy} mediaScale={preferences.mediaPreviewScale} onRetry={onRetry} onEdit={item.message.protocol?.promptIndex != null ? onEdit : undefined} composerHasDraft={composerHasDraft} />
                : item.kind === "assistant"
                  ? <GrokTurnBlock taskId={detail.snapshot.taskId} turn={item.turn} renderPolicy={preferences.richTextRenderPolicy} mediaScale={preferences.mediaPreviewScale} presentation={preferences.grokMessagePresentation} processAvailable={processAvailable} processExpanded={processExpanded} onToggleProcess={() => setExpandedProcesses((current) => ({ ...current, [item.turn.promptExecutionId]: !processExpanded }))} onFork={item.id === latestGrokItemId ? onFork : undefined} />
                  : item.kind === "goal"
                    ? <GrokGoalOutcomeBlock value={item.presentation} />
                  : <div data-session-lifecycle-cluster><GrokTurnFlow taskId={detail.snapshot.taskId} segments={item.segments} renderPolicy={preferences.richTextRenderPolicy} mediaScale={preferences.mediaPreviewScale} running={item.segments.some((segment) => segment.status === "running")} /></div>}
            </div>
          </div>;
        })}
      </div>
    </div>
    <div className={`${styles.edgeTop} ${topEdge ? styles.edgeVisible : ""}`} aria-hidden />
    {latestControl !== "hidden" && <Control recipe="floating" shape="round" density="action" iconOnly className={styles.latest} onClick={latest} aria-label={t("backToLatest")}>
      {latestControl === "activity" ? <span className={styles.latestActivity} aria-hidden><span /><span /><span /></span> : <ArrowDown size={15} />}
    </Control>}
  </div>;
}

function composerThreadInset(stackHeight: number): number {
  return Math.ceil(Math.max(0, stackHeight));
}

function continuationItems(items: TimelineItem[], origin: TaskContinuationOrigin | null | undefined): ThreadItem[] {
  if (!origin) return items;
  const marker: ContinuationItem = { id: `continued-from:${origin.taskId}:${origin.ordinal}`, kind: "continuation", origin };
  if (!origin.boundaryBlockId) return [marker, ...items];
  const boundary = items.findIndex((item) => timelineItemContainsBlock(item, origin.boundaryBlockId!));
  if (boundary < 0) return [marker, ...items];
  return [...items.slice(0, boundary + 1), marker, ...items.slice(boundary + 1)];
}

function timelineItemContainsBlock(item: TimelineItem, blockId: string): boolean {
  if (item.kind === "user") return item.message.blockId === blockId;
  if (item.kind !== "assistant") return false;
  return item.turn.segments.some((segment) => segment.kind === "assistant" && segment.message.blockId === blockId);
}
