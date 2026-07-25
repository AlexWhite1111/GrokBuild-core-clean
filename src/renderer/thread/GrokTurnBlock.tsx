import { Check, CheckCircle2, CircleAlert, CircleX, Copy } from "lucide-react";
import { memo, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { themeCandidateFromMarkdown } from "../themes/themeCandidate.js";
import { ThemeCandidateAction } from "../themes/ThemeCandidateAction.js";
import { Control, DisclosureGlyph, Surface, Text } from "../../ui/components/index.js";
import { GrokTurnFlow } from "./GrokTurnFlow.js";
import type { GoalOutcomePresentation, GrokTurnPresentation } from "./turnPresentation.js";
import type { RichTextRenderPolicy } from "../../shared/contracts.js";
import { typographyScope } from "../../ui/core/index.js";
import styles from "./MessageBlock.module.css";
import { ConversationForkIcon } from "./ConversationForkIcon.js";

interface GrokTurnBlockProps { taskId?: string; turn: GrokTurnPresentation; renderPolicy?: RichTextRenderPolicy; mediaScale?: number; presentation?: "document" | "bubble"; processAvailable?: boolean; processExpanded?: boolean; onToggleProcess?: () => void; onFork?: () => Promise<void> | void }

export const GrokTurnBlock = memo(function GrokTurnBlock({ taskId, turn, renderPolicy, mediaScale, presentation = "document", processAvailable = false, processExpanded = false, onToggleProcess, onFork }: GrokTurnBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const answerText = turn.segments.flatMap((segment) => segment.kind === "assistant" && segment.final ? [segment.message.text] : []).filter(Boolean).join("\n\n");
  const theme = turn.outcome !== "running" && answerText ? themeCandidateFromMarkdown(answerText) : null;
  const durationMs = useLiveDuration(turn);
  const latestSegment = turn.segments.at(-1);
  const statusLive = turn.outcome === "running" && (
    !processAvailable
    || !processExpanded
    || latestSegment?.kind === "assistant" && latestSegment.message.streaming
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch { setCopied(false); }
  };
  return <article className={`${styles.message} ${styles.assistant}`} data-grok-presentation={presentation} {...typographyScope("content")}>
    <Surface appearance={presentation === "bubble" ? "message" : "plain"} elevation={presentation === "bubble" ? "content" : "none"} shape={presentation === "bubble" ? "surface" : "none"} className={styles.surface}>
      <TurnStatus turn={turn} durationMs={durationMs} collapsible={processAvailable} expanded={processExpanded} live={statusLive} onToggle={onToggleProcess} />
      <GrokTurnFlow taskId={taskId} segments={turn.segments} renderPolicy={renderPolicy} mediaScale={mediaScale} running={turn.outcome === "running"} processExpanded={processExpanded} />
      {turn.goalOutcomes.map((goal, index) => <GoalOutcomeRow key={`${goal.outcome}:${goal.objective || ""}:${index}`} value={goal} />)}
    </Surface>
    {theme && <ThemeCandidateAction theme={theme} />}
    {answerText && <div className={styles.messageMeta}><Control recipe="icon" density="detail" onClick={() => void copy()} aria-label={t("copyMessage")} title={t("copyMessage")}>{copied ? <Check size={12} /> : <Copy size={12} />}</Control>{onFork && <Control recipe="icon" density="detail" onClick={() => void onFork()} aria-label={t("forkConversation")} title={t("forkConversation")}><ConversationForkIcon width={12} height={12} /></Control>}{copied && <Text as="span" tone="success" size="caption" role="status">{t("copied")}</Text>}<Text as="time" tone="muted" size="caption" dateTime={turn.startedAt}>{time(turn.startedAt)}</Text></div>}
  </article>;
}, sameTurnBlockProps);

function sameTurnBlockProps(left: GrokTurnBlockProps, right: GrokTurnBlockProps): boolean {
  return left.taskId === right.taskId
    && left.turn === right.turn
    && left.renderPolicy === right.renderPolicy
    && left.mediaScale === right.mediaScale
    && left.presentation === right.presentation
    && left.processAvailable === right.processAvailable
    && left.processExpanded === right.processExpanded
    && left.onFork === right.onFork;
}

function GoalOutcomeRow({ value }: { value: GoalOutcomePresentation }) {
  const { t } = useTranslation();
  const Icon = value.outcome === "completed" ? CheckCircle2 : value.outcome === "cleared" || value.outcome === "cancelled" ? CircleX : CircleAlert;
  const duration = value.durationSeconds == null ? null : formatGoalSeconds(value.durationSeconds);
  const label = value.outcome === "completed" && duration
    ? t("goalCompletedIn", { duration })
    : t(value.outcome === "completed" ? "goalCompleted"
      : value.outcome === "cleared" ? "goalCleared"
        : value.outcome === "cancelled" ? "goalCancelled"
          : value.outcome === "failed" ? "goalFailed"
            : value.outcome === "interrupted" ? "goalInterrupted" : "goalEnded");
  return <div className={styles.goalOutcomeRow} data-goal-outcome={value.outcome} title={value.objective || undefined}>
    <Icon size={14} aria-hidden />
    <span>{label}</span>
  </div>;
}

function TurnStatus({ turn, durationMs, collapsible, expanded, live, onToggle }: {
  turn: GrokTurnPresentation;
  durationMs: number | null;
  collapsible: boolean;
  expanded: boolean;
  live: boolean;
  onToggle?: () => void;
}) {
  const { t } = useTranslation();
  if (!turn.showStatus || turn.outcome === "unknown") return null;
  const label = turn.outcome === "running" ? t("workingFor", { duration: formatDuration(durationMs) })
    : turn.outcome === "completed" ? t("workedFor", { duration: formatDuration(turn.durationMs) })
      : turn.outcome === "stopped" ? t("stoppedAfter", { duration: formatDuration(turn.durationMs) })
        : t("failedAfter", { duration: formatDuration(turn.durationMs) });
  if (collapsible && onToggle) return <Control recipe="text" density="body" shape="none" hover="color" className={styles.turnStatus} data-outcome={turn.outcome} data-process-live-summary={live || undefined} onClick={onToggle} aria-label={label} aria-expanded={expanded}>
    <span data-process-label={label}>{label}</span>
    <DisclosureGlyph className={expanded ? styles.turnStatusOpen : ""} />
  </Control>;
  return <div className={styles.turnStatus} data-outcome={turn.outcome} data-process-live-summary={live || undefined} aria-label={label}>
    <span data-process-label={label}>{label}</span>
  </div>;
}

function useLiveDuration(turn: GrokTurnPresentation): number | null {
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    if (turn.outcome !== "running") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turn.outcome, turn.startedAt]);
  if (turn.durationMs != null) return turn.durationMs;
  const started = Date.parse(turn.startedAt);
  return Number.isFinite(started) ? Math.max(0, now - started) : null;
}

function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round(value / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatGoalSeconds(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function time(value: string): string { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
