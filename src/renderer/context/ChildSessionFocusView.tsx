import { Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChildSessionDetail, WorkItemSnapshot } from "../../shared/contracts.js";
import { typographyScope } from "../../ui/core/index.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { TaskThread } from "../thread/TaskThread.js";
import { Control, Notice, Spinner, Text, UiIcon, WorkspaceDetail } from "../../ui/components/index.js";
import { localizedSubagentTitle } from "./subagentTitle.js";
import styles from "./ChildSessionFocusView.module.css";

export function ChildSessionFocusView({ taskId, item, onClose, canStop = false, stopPending = false, onStop }: {
  taskId: string;
  item: WorkItemSnapshot;
  onClose: () => void;
  canStop?: boolean;
  stopPending?: boolean;
  onStop?: () => void;
}) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const [detail, setDetail] = useState<ChildSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = item.childSessionId;

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!sessionId) return;
    let current = true;
    void api.get<ChildSessionDetail>(`/tasks/${taskId}/children/${encodeURIComponent(sessionId)}`).then((value) => {
      if (current && value.sessionId === sessionId) setDetail(value);
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { current = false; };
  }, [api, item.updatedAt, sessionId, taskId]);

  const subagentTitle = localizedSubagentTitle(item.title, t("subagent"));
  const actions = <>{canStop && onStop && <Control recipe="icon" density="titlebar" tone="danger" iconOnly aria-label={t("stopSubagent")} disabled={stopPending} onClick={onStop}><UiIcon source={Square} /></Control>}<Control recipe="icon" density="titlebar" iconOnly aria-label={t("closeSubagent")} onClick={onClose}><UiIcon source={X} /></Control></>;
  return <WorkspaceDetail actions={actions}>
    {detail?.transcriptAvailable && detail.detail ? <TaskThread detail={detail.detail} persistScroll={false} /> : <div className={styles.fallback} {...typographyScope("content")}>
      {!detail && !error && <Spinner />}
      {error && <Notice tone="danger">{error}</Notice>}
      {detail && !error && <Text as="strong" font="body" size="title" weight="semibold">{subagentTitle}</Text>}
    </div>}
  </WorkspaceDetail>;
}
