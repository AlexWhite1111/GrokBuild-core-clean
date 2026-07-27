import { memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Archive, Download, Info, MoreHorizontal, Pause, Pencil, Pin, PinOff, Play, Square, X } from "lucide-react";
import type { TaskListItem, WorkspaceProjection } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { Control, FormDialog, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Notice, StatusDot, type FeedbackTone } from "../../ui/components/index.js";
import { TaskInfoDialog } from "./TaskInfoDialog.js";
import styles from "./Sidebar.module.css";

function TaskRowComponent({ task, project }: { task: TaskListItem; project: WorkspaceProjection["projects"][number] }) {
  const { t, i18n } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState<string | null>(null);
  const update = (workspace: WorkspaceProjection) => client.setQueryData(["workspace"], workspace);
  const mutateWorkspace = async (path: string, body: Record<string, unknown>): Promise<void> => {
    update(await api.post<WorkspaceProjection>(path, { requestId: crypto.randomUUID(), ...body }));
  };
  const rename = async () => { const next = title.trim(); if (next && next !== task.title) await mutateWorkspace(`/tasks/${task.taskId}/rename`, { title: next }); setRenameOpen(false); };
  const exportTask = async () => { const value = await api.post<{ fileName: string; markdown: string }>(`/tasks/${task.taskId}/export`, { requestId: crypto.randomUUID() }); download(value.fileName, value.markdown); };
  const archive = async () => {
    await mutateWorkspace(`/tasks/${task.taskId}/archive`, { archived: true });
    if (location.pathname === `/tasks/${encodeURIComponent(task.taskId)}`) navigate("/new");
  };
  const run = (operation: () => Promise<void>) => void operation().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  return <>
    <div className={styles.taskRowShell}>
      <Control asChild recipe="row" className={styles.taskRow}>
        <NavLink to={`/tasks/${task.taskId}`}>
          <span className={styles.taskTitleLine}>
            <StatusDot tone={taskStateTone(task.agentState)} appearance={task.agentState === "unloaded" ? "hollow" : "solid"} pulse={task.agentState === "running" || task.agentState === "gate"} label={taskStateLabel(task.agentState, t)} />
            <span className={styles.taskTitle}>{task.title}</span>
            {task.pinned && <span className={styles.taskPin} aria-label={t("pinnedState")}><Pin size={9} fill="currentColor" /></span>}
          </span>
          <span className={styles.taskMeta}>{task.naturalStatus || relativeTime(task.updatedAt, i18n.language)}</span>
        </NavLink>
      </Control>
      <MenuRoot><MenuTrigger asChild><Control recipe="icon" density="compact" className={styles.taskMenuButton} aria-label={t("taskActions", { name: task.title })}><MoreHorizontal size={14} /></Control></MenuTrigger>
        <MenuContent sideOffset={4} align="end">
          <MenuItem onSelect={() => run(() => mutateWorkspace(`/tasks/${task.taskId}/pin`, { pinned: !task.pinned }))}>{task.pinned ? <PinOff size={12} /> : <Pin size={12} />}{task.pinned ? t("unpin") : t("pin")}</MenuItem>
          {task.agentState === "unloaded" ? <MenuItem onSelect={() => run(async () => { await api.post(`/tasks/${task.taskId}/resume`, { requestId: crypto.randomUUID() }); void client.invalidateQueries({ queryKey: ["workspace"] }); void client.invalidateQueries({ queryKey: ["task", task.taskId] }); })}><Play size={12} />{t("resumeTask")}</MenuItem> : task.canStop ? <MenuItem onSelect={() => run(async () => { await api.post(`/tasks/${task.taskId}/cancel`, { requestId: crypto.randomUUID() }); })}><Square size={12} />{t("stop")}</MenuItem> : <MenuItem onSelect={() => run(() => mutateWorkspace(`/tasks/${task.taskId}/sleep`, {}))}><Pause size={12} />{t("sleepTask")}</MenuItem>}
          <MenuItem onSelect={() => { setTitle(task.title); setRenameOpen(true); }}><Pencil size={12} />{t("rename")}</MenuItem>
          <MenuItem onSelect={() => run(exportTask)}><Download size={12} />{t("export")}</MenuItem>
          <MenuItem onSelect={() => setInfoOpen(true)}><Info size={12} />{t("taskInfo")}</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => run(archive)}><Archive size={12} />{t("archive")}</MenuItem>
        </MenuContent>
      </MenuRoot>
      {error && <Notice tone="danger" density="compact" role="alert" className={styles.actionError}><span>{error}</span><Control recipe="icon" density="detail" tone="danger" aria-label={t("close")} onClick={() => setError(null)}><X size={11} /></Control></Notice>}
    </div>
    <TaskInfoDialog open={infoOpen} task={task} project={project} onOpenChange={setInfoOpen} />
    <FormDialog open={renameOpen} title={t("renameTask")} fields={[{ id: "title", label: t("task"), value: title }]} onOpenChange={setRenameOpen} onFieldChange={(_, value) => setTitle(value)} onApply={() => run(rename)} />
  </>;
}

export const TaskRow = memo(TaskRowComponent);

function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
function relativeTime(value: string, locale: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(locale, formatter);
  }
  if (seconds < 60) return formatter.format(-seconds, "second");
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return formatter.format(-Math.floor(seconds / 3600), "hour");
  return new Date(value).toLocaleDateString();
}
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
function taskStateLabel(state: TaskListItem["agentState"], t: (key: string) => string): string {
  return t(`taskState${state[0].toUpperCase()}${state.slice(1)}`);
}
function taskStateTone(state: TaskListItem["agentState"]): FeedbackTone {
  if (state === "idle" || state === "running") return "success";
  if (state === "gate") return "warning";
  if (state === "failed") return "danger";
  return "neutral";
}
