import type { TFunction } from "i18next";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ProcessGroupModel, ToolEvent, ToolStatus } from "../../ui/core/index.js";
import type { RichTextRenderPolicy } from "../../shared/contracts.js";
import type { SessionLifecycleKind, SessionLifecycleState } from "../../shared/sessionLifecycle.js";
import { ProcessGroup } from "../../ui/patterns/index.js";
import { RichContent } from "./RichContent.js";
import type { ProcessGroupSegment, SessionLifecycleSegment, ToolStepPresentation, TurnSegment } from "./turnPresentation.js";
import styles from "./GrokTurnFlow.module.css";

export const GrokTurnFlow = memo(function GrokTurnFlow({ taskId, segments, renderPolicy, mediaScale, running, processExpanded = true }: {
  taskId?: string;
  segments: TurnSegment[];
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
  running: boolean;
  processExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const collapsedReplyId = [...segments].reverse().find((segment) => segment.kind === "assistant" && segment.final)?.id
    || [...segments].reverse().find((segment) => segment.kind === "assistant")?.id
    || segments.at(-1)?.id;
  const visibleSegments = processExpanded
    ? segments
    : segments.filter((segment) => segment.id === collapsedReplyId);
  const processModels = new Map<string, ProcessGroupModel>();
  for (const segment of visibleSegments) {
    if (segment.kind !== "assistant") processModels.set(segment.id, segment.kind === "processGroup" ? processGroupModel(segment, t) : lifecycleModel(segment, t));
  }
  let activeProcessId: string | null = null;
  const latestSegment = visibleSegments.at(-1);
  if (latestSegment && latestSegment.kind !== "assistant" && processModels.get(latestSegment.id)?.status === "running") activeProcessId = latestSegment.id;

  return <div className={styles.flow} data-turn-flow>
    {visibleSegments.map((segment) => {
      return <div key={segment.id} className={segment.kind === "assistant" ? styles.messageSegment : styles.processSegment} data-turn-segment={segment.kind} data-message-block={segment.kind === "assistant" ? segment.message.protocol?.messageId || segment.message.blockId : undefined} data-final-reply={segment.kind === "assistant" && segment.final || undefined}>
        {segment.kind === "assistant"
          ? <RichContent taskId={taskId} className={styles.prose} text={segment.message.text} paths={segment.message.paths} media={segment.message.media} renderPolicy={renderPolicy} mediaScale={mediaScale} portable={!running} streaming={segment.message.streaming} streamingKey={segment.message.blockId} />
          : <ProcessGroup model={processModels.get(segment.id)!} live={segment.id === activeProcessId} />}
      </div>;
    })}
  </div>;
});

function processGroupModel(group: ProcessGroupSegment, t: TFunction): ProcessGroupModel {
  const view = processGroupView(group, t);
  const items: ToolEvent[] = [];
  for (const item of group.items) {
    if (item.kind === "toolRun") {
      items.push(...item.steps.map((step) => ({
        id: step.id,
        label: step.label,
        kind: step.icon,
        status: toolStatus(step.status),
        detail: step.detail || step.name || step.label,
        detailFormat: "code" as const,
      })));
    } else if (item.kind === "thought") {
      items.push({
        id: item.id,
        label: oneLine(item.message.text) || t("thought"),
        kind: "thought",
        status: item.message.streaming ? "running" : "success",
        detail: item.message.text,
        detailFormat: "text",
      });
    } else {
      items.push(...lifecycleModel(item, t).items);
    }
  }
  return {
    id: group.id,
    label: view.label,
    kind: view.icon,
    status: view.status,
    items,
  };
}

function processGroupView(group: ProcessGroupSegment, t: TFunction) {
  const steps = group.items.flatMap((item) => item.kind === "toolRun" ? item.steps : []);
  const latest = group.items.at(-1);
  const live = latestRunning(group, t);
  const failed = steps.some((step) => step.status === "failed") || group.items.some((item) => item.kind === "sessionLifecycle" && item.status === "failed");
  const cancelled = steps.some((step) => step.status === "cancelled") || group.items.some((item) => item.kind === "sessionLifecycle" && item.status === "cancelled");
  const settled = steps.filter((step) => step.status !== "running");
  const completedSummary = settled.length ? groupedToolLabel(settled) : "";
  const label = live
    ? [completedSummary, live.label].filter(Boolean).join(" · ")
    : steps.length === 1
      ? steps[0].label
      : steps.length
        ? groupedToolLabel(steps)
        : latest?.kind === "sessionLifecycle"
          ? lifecycleLabel(latest.lifecycle, latest.status, t)
          : group.items.length > 1
            ? `${t("thought")} × ${group.items.length}`
            : latest?.kind === "thought" ? oneLine(latest.message.text) || t("thought") : t("thought");
  const icon = live?.icon || (steps.length ? groupIcon(steps) : latest?.kind === "sessionLifecycle" ? lifecycleIcon(latest.lifecycle, latest.status) : "thought");
  return { label, icon, status: live ? "running" : failed ? "error" : cancelled ? "cancelled" : "success" } as const;
}

function latestRunning(group: ProcessGroupSegment, t: TFunction): { icon: ToolStepPresentation["icon"]; label: string } | undefined {
  for (const item of [...group.items].reverse()) {
    if (item.kind === "toolRun") {
      const step = [...item.steps].reverse().find((candidate) => candidate.status === "running");
      if (step) return step;
    } else if (item.kind === "thought" && item.message.streaming) {
      return { icon: "thought", label: oneLine(item.message.text) || t("thinkingNow") };
    } else if (item.kind === "sessionLifecycle" && item.status === "running") {
      return { icon: lifecycleIcon(item.lifecycle, item.status), label: lifecycleLabel(item.lifecycle, item.status, t) };
    }
  }
}

function lifecycleModel(value: SessionLifecycleSegment, t: TFunction): ProcessGroupModel {
  const label = `${lifecycleLabel(value.lifecycle, value.status, t)}${value.detail ? ` · ${value.detail}` : ""}`;
  const kind = lifecycleIcon(value.lifecycle, value.status);
  const status = toolStatus(value.status);
  return { id: value.id, label, kind, status, items: [{ id: value.id, label, kind, status }] };
}

function lifecycleIcon(kind: SessionLifecycleKind, status: SessionLifecycleState): ToolEvent["kind"] {
  if (kind === "contextCompact") return "compact";
  if (kind === "memoryFlush") return "memory";
  if (kind === "retry") return "retry";
  if (kind === "connection") return status === "completed" ? "reconnect" : "disconnect";
  if (kind === "recovery") return "reconnect";
  return "generic";
}

function groupIcon(steps: ToolStepPresentation[]): ToolStepPresentation["icon"] {
  const icons = new Set(steps.map((step) => step.icon));
  return icons.size === 1 ? steps[0]?.icon || "generic" : "tools";
}

function groupedToolLabel(steps: ToolStepPresentation[]): string {
  const order: ToolStepPresentation["icon"][] = [];
  const counts = new Map<ToolStepPresentation["icon"], number>();
  for (const step of steps) {
    if (!counts.has(step.icon)) order.push(step.icon);
    counts.set(step.icon, (counts.get(step.icon) || 0) + 1);
  }
  return order.map((icon) => actionCount(icon, counts.get(icon) || 0)).join(", ");
}

function actionCount(icon: ToolStepPresentation["icon"], count: number): string {
  const wording: Partial<Record<ToolStepPresentation["icon"], [string, string]>> = {
    list: ["Listed", "directory"], read: ["Read", "file"], search: ["Searched", "pattern"], web: ["Browsed", "page"], image: ["Viewed", "image"],
    edit: ["Edited", "file"], command: ["Ran", "command"], subagent: ["Ran", "subagent"], wait: ["Waited for", "task"],
  };
  const [verb, noun] = wording[icon] || ["Used", "tool"];
  return `${verb} ${count} ${noun}${count === 1 ? "" : "s"}`;
}

function lifecycleLabel(kind: SessionLifecycleKind, status: SessionLifecycleState, t: TFunction): string {
  if (kind === "contextCompact") return t(status === "running" ? "contextCompacting" : status === "failed" ? "contextCompactFailed" : status === "cancelled" ? "contextCompactCancelled" : "contextCompacted");
  if (kind === "memoryFlush") return t(status === "running" ? "memoryFlushRunning" : status === "failed" ? "memoryFlushFailed" : "memoryFlushCompleted");
  if (kind === "retry") return t(status === "running" ? "modelRetrying" : status === "failed" ? "modelRetryFailed" : "modelRetryComplete");
  if (kind === "recovery") return t(status === "running" ? "sessionRecovering" : status === "failed" ? "sessionRecoveryFailed" : "sessionRecovered");
  if (kind === "connection") return t(status === "completed" ? "connectionRestored" : "connectionInterrupted");
  return t("modelChanged");
}

function oneLine(value: string): string { return value.replace(/\s+/g, " ").trim(); }

function toolStatus(status: ToolStepPresentation["status"] | SessionLifecycleState): ToolStatus {
  if (status === "running") return "running";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  return "pending";
}
