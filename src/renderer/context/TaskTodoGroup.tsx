import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TodoEntrySnapshot, TodoGroupSnapshot } from "../../shared/contracts.js";
import { typographyScope } from "../../ui/core/index.js";
import { Control, StatusDot, Text, UiIcon } from "../../ui/components/index.js";
import styles from "./TaskTodoGroup.module.css";

export function TaskTodoGroup({ group, cancellable = false, cancelPending = false, onCancel }: {
  group: TodoGroupSnapshot;
  cancellable?: boolean;
  cancelPending?: boolean;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const officialStatusUnchanged = group.state === "archived"
    && group.entries.some((item) => item.status === "pending" || item.status === "inProgress");
  return <section className={styles.group} data-todo-group={group.state} data-cancellable={cancellable || undefined} {...typographyScope("content")} aria-label={t("todos")}>
    <ol className={styles.list}>
      {group.entries.map((item) => <TodoItem key={item.id} item={item} group={group} />)}
    </ol>
    {officialStatusUnchanged && <Text as="p" className={styles.officialStatus} tone="muted" size="caption">{t("todoOfficialStatusUnchanged")}</Text>}
    {cancellable && onCancel && <Control recipe="icon" density="detail" tone="danger" iconOnly className={styles.cancel} aria-label={t("cancelTodoGroup")} title={t("cancelTodoGroup")} disabled={cancelPending} onClick={onCancel}><UiIcon source={X} size="detail" /></Control>}
  </section>;
}

function TodoItem({ item, group }: { item: TodoEntrySnapshot; group: TodoGroupSnapshot }) {
  const status = item.status;
  const active = group.state === "active" && status === "inProgress";
  return <li className={styles.item} data-todo-item data-status={status}>
    <StatusDot className={styles.marker} tone={statusTone(status)} appearance={status === "completed" || status === "failed" ? "solid" : "hollow"} pulse={active} />
    <Text as="span" className={styles.label} tone="secondary" font="body" size="body">{item.content}</Text>
  </li>;
}

function statusTone(status: TodoEntrySnapshot["status"]): "neutral" | "accent" | "success" | "warning" | "danger" {
  return status === "inProgress" || status === "completed" ? "accent" : status === "failed" ? "danger" : status === "cancelled" ? "warning" : "neutral";
}
