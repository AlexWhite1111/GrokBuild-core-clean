import { useEffect, useState } from "react";
import { Pause, Pencil, Play, Target, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskGoalState } from "../../shared/contracts.js";
import { Control } from "../../ui/components/index.js";
import styles from "./Composer.module.css";

export function ComposerGoalBar({ goal, editing, onEdit, onCancelEdit, onAction }: {
  goal: TaskGoalState;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAction: (action: "pause" | "resume" | "clear") => Promise<void>;
}) {
  const { t } = useTranslation();
  const duration = formatDuration(useGoalElapsed(goal));
  return <div className={styles.goalBar} data-thread-goal={goal.status} aria-label={t("activeGoal")}>
    <Target size={14} aria-hidden />
    <div className={styles.goalCopy}>
      <strong>{t(goal.status === "paused" ? "goalPaused" : "goalPursuing")}</strong>
      <span className={styles.goalObjective} title={goal.objective || undefined}>{goal.objective}</span>
      <time className={styles.goalTime} aria-label={t("goalElapsed", { duration })}>{duration}</time>
    </div>
    <div className={styles.goalActions}>
      {editing
        ? <Control recipe="icon" density="detail" shape="round" onClick={onCancelEdit} aria-label={t("cancelGoalEdit")} title={t("cancelGoalEdit")}><X size={13} /></Control>
        : <>
          <Control recipe="icon" density="detail" shape="round" onClick={onEdit} aria-label={t("editGoal")} title={t("editGoal")}><Pencil size={12} /></Control>
          <Control recipe="icon" density="detail" shape="round" onClick={() => void onAction(goal.status === "paused" ? "resume" : "pause")} aria-label={t(goal.status === "paused" ? "resumeGoal" : "pauseGoal")} title={t(goal.status === "paused" ? "resumeGoal" : "pauseGoal")}>{goal.status === "paused" ? <Play size={12} /> : <Pause size={12} />}</Control>
          <Control recipe="icon" density="detail" shape="round" tone="danger" onClick={() => void onAction("clear")} aria-label={t("clearGoal")} title={t("clearGoal")}><Trash2 size={12} /></Control>
        </>}
    </div>
  </div>;
}

function useGoalElapsed(goal: TaskGoalState): number {
  const [now, setNow] = useState(() => Date.now());
  const running = goal.status === "active";
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [goal.updatedAt, running]);
  const checkpoint = goal.updatedAt ? Date.parse(goal.updatedAt) : Number.NaN;
  const live = running && Number.isFinite(checkpoint) ? Math.max(0, now - checkpoint) / 1_000 : 0;
  return Math.max(0, (goal.timeUsedSeconds || 0) + live);
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}
