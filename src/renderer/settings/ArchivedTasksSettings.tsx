import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArchiveRestore, Search, Trash2 } from "lucide-react";
import type { TaskListItem, WorkspaceProjection } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useWorkspace } from "../api/hooks.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { Control, Input, Notice, Spinner, Surface, Text } from "../../ui/components/index.js";
import styles from "./SettingsPanels.module.css";

interface TaskDeletePreview {
  token: string;
  title: string;
  warning: string;
}

type PendingDelete = TaskDeletePreview & { task: TaskListItem };

export function ArchivedTasksSettings() {
  const { t, i18n } = useTranslation();
  const { api } = useBootstrap();
  const workspace = useWorkspace().data;
  const client = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const searchQuery = useDeferredValue(searchText.trim());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const archived = useQuery({
    queryKey: ["archived-tasks", searchQuery],
    queryFn: () => api.get<{ tasks: TaskListItem[] }>(`/tasks/archived${searchQuery ? `?query=${encodeURIComponent(searchQuery)}` : ""}`),
  });
  const restore = useMutation({
    mutationFn: (task: TaskListItem) => api.post<WorkspaceProjection>(`/tasks/${task.taskId}/archive`, {
      requestId: crypto.randomUUID(),
      archived: false,
    }),
    onSuccess: (nextWorkspace) => {
      client.setQueryData(["workspace"], nextWorkspace);
      void client.invalidateQueries({ queryKey: ["archived-tasks"] });
    },
  });
  const previewDelete = useMutation({
    mutationFn: async (task: TaskListItem): Promise<PendingDelete> => ({
      task,
      ...await api.get<TaskDeletePreview>(`/tasks/${task.taskId}/delete-preview`),
    }),
    onSuccess: setPendingDelete,
  });
  const permanentlyDelete = useMutation({
    mutationFn: () => api.post<WorkspaceProjection>(`/tasks/${pendingDelete!.task.taskId}/delete`, {
      requestId: crypto.randomUUID(),
      confirmation: pendingDelete!.token,
    }),
    onSuccess: (nextWorkspace) => {
      const taskId = pendingDelete?.task.taskId;
      client.setQueryData(["workspace"], nextWorkspace);
      setPendingDelete(null);
      void client.invalidateQueries({ queryKey: ["archived-tasks"] });
      if (taskId) void window.grokDesktop?.releaseTextClips(`task:${taskId}`).catch(() => undefined);
    },
  });
  const projectNames = new Map(workspace.projects.map((project) => [project.projectId, project.name]));
  const error = archived.error || restore.error || previewDelete.error || permanentlyDelete.error;

  return <div className={styles.stack}>
    <div className={styles.archiveSearch}>
      <Search size={14} />
      <Input
        appearance="surface"
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        placeholder={t("searchArchivedTasks")}
        aria-label={t("searchArchivedTasks")}
      />
      {archived.isFetching && <Spinner size="compact" />}
    </div>
    {error && <Notice tone="danger">{error instanceof Error ? error.message : String(error)}</Notice>}
    <Surface className={styles.archiveList} appearance="surface" elevation="content">
      {archived.isPending
        ? <div className={styles.archiveEmpty}><Spinner /></div>
        : archived.data?.tasks.length
          ? archived.data.tasks.map((task) => <div className={styles.archiveRow} key={task.taskId}>
            <div className={styles.archiveIdentity}>
              <Text as="strong" size="body" weight="semibold" truncate>{task.title}</Text>
              <div className={styles.archiveMeta}>
                <Text as="span" tone="secondary" size="caption" truncate>{projectNames.get(task.projectId) || t("projectGroup")}</Text>
                <Text as="time" tone="muted" size="caption" dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleString(i18n.language)}</Text>
              </div>
            </div>
            <div className={styles.archiveActions}>
              <Control recipe="quiet" disabled={restore.isPending || previewDelete.isPending || permanentlyDelete.isPending} onClick={() => restore.mutate(task)}>
                <ArchiveRestore size={13} />{t("restore")}
              </Control>
              <Control recipe="danger" disabled={restore.isPending || previewDelete.isPending || permanentlyDelete.isPending} onClick={() => previewDelete.mutate(task)}>
                <Trash2 size={13} />{t("deletePermanently")}
              </Control>
            </div>
          </div>)
          : <Text as="div" className={styles.archiveEmpty} tone="muted" size="label">{t("noArchivedTasks")}</Text>}
    </Surface>
    {pendingDelete && <SemanticMutationDialog
      open
      title={`${t("deletePermanently")} · ${pendingDelete.title}`}
      target={pendingDelete.task.sessionId || pendingDelete.task.taskId}
      changes={[{ field: t("sessionLabel"), before: pendingDelete.task.sessionId || pendingDelete.task.taskId, after: t("deleted") }]}
      warnings={[t("permanentDeleteWarning")]}
      destructive
      pending={permanentlyDelete.isPending}
      onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      onApply={() => permanentlyDelete.mutate()}
    />}
  </div>;
}
