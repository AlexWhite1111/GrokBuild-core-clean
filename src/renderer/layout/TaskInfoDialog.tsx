import { Check, Copy, Pin } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectSummary, TaskListItem } from "../../shared/contracts.js";
import { Control, Divider, Modal, Text } from "../../ui/components/index.js";
import styles from "./TaskInfoDialog.module.css";

export function TaskInfoDialog({ open, task, project, onOpenChange }: { open: boolean; task: TaskListItem; project: ProjectSummary; onOpenChange(open: boolean): void }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  };
  const rows = [
    [t("projectGroup"), project.name],
    [t("projectPathLabel"), project.displayPath],
    [t("status"), t(`taskState${task.agentState[0].toUpperCase()}${task.agentState.slice(1)}`)],
    [t("pin"), task.pinned ? t("pinnedState") : t("notPinnedState")],
    [t("createdAtLabel"), new Date(task.createdAt).toLocaleString(i18n.language)],
    [t("updatedAtLabel"), new Date(task.updatedAt).toLocaleString(i18n.language)],
  ];
  const title = <>{task.title}{task.pinned && <Text as="span" className={styles.pinned} tone="accent" size="caption"><Pin size={10} fill="currentColor" />{t("pinnedState")}</Text>}</>;
  return <Modal open={open} onOpenChange={(next) => { setCopied(null); onOpenChange(next); }} title={title} closeLabel={t("close")} size="standard">
      <dl className={styles.details}>{rows.map(([label, value]) => <div key={label}><dt><Text tone="muted" size="caption">{label}</Text></dt><dd><Text tone="secondary" font="body" size="label">{value}</Text></dd></div>)}</dl>
      <Divider />
      <section className={styles.identifiers}>
        <Identifier label={t("taskIdLabel")} value={task.taskId} copied={copied === "task"} onCopy={() => void copy("task", task.taskId)} />
        {task.sessionId && <Identifier label={t("sessionIdLabel")} value={task.sessionId} copied={copied === "session"} onCopy={() => void copy("session", task.sessionId!)} />}
      </section>
  </Modal>;
}

function Identifier({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy(): void }) {
  const { t } = useTranslation();
  return <div><span><Text as="small" tone="muted" size="micro">{label}</Text><Text as="code" tone="secondary" font="code" size="caption" truncate>{value}</Text></span><Control recipe="icon" density="compact" onClick={onCopy} aria-label={`${t("copy")} ${label}`}>{copied ? <Check size={12} /> : <Copy size={12} />}</Control></div>;
}
