import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Blocks, Bot, Check, ChevronDown, FolderPlus, Plus, Search, Settings, Wifi, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProjectIntents, useWorkspace } from "../api/hooks.js";
import { useLanShare } from "../api/useLanShare.js";
import { openLanSharePopover } from "../app/uiEvents.js";
import { Control, Input, PopoverContent, PopoverRoot, PopoverTrigger, Surface } from "../../ui/components/index.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { CapacityBar } from "./CapacityBar.js";
import { SidebarLink } from "./SidebarLink.js";
import { TaskRow } from "./TaskRow.js";
import { ThemeShortcut } from "./ThemeShortcut.js";
import styles from "./Sidebar.module.css";

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { t } = useTranslation();
  const workspace = useWorkspace().data;
  const projects = useProjectIntents();
  const activeProject = workspace.projects.find((project) => project.active) || workspace.projects[0];
  const [projectQuery, setProjectQuery] = useState("");
  const [removeProject, setRemoveProject] = useState<{ projectId: string; name: string } | null>(null);
  const [workspaceDropActive, setWorkspaceDropActive] = useState(false);
  const [workspaceDropError, setWorkspaceDropError] = useState<string | null>(null);
  const visibleProjects = workspace.projects.filter((project) => `${project.name} ${project.displayPath}`.toLowerCase().includes(projectQuery.toLowerCase()));
  const projectTasks = useMemo(() => workspace.tasks.filter((task) => task.projectId === activeProject?.projectId), [activeProject?.projectId, workspace.tasks]);
  const attention = workspace.tasks.filter((task) => task.needsAttention).length;
  const lanShare = useLanShare();
  useEffect(() => { void window.grokDesktop?.setAttentionCount(attention); }, [attention]);
  const acceptsFinderDrop = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const registerWorkspaceDrop = async (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); setWorkspaceDropActive(false);
    try {
      const files = Array.from(event.dataTransfer.files);
      if (!window.grokDesktop || !files.length) throw new Error(t("dropFilesUnavailable"));
      await window.grokDesktop.registerWorkspaceFolders(files);
      setWorkspaceDropError(null);
    } catch (cause) {
      setWorkspaceDropError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <>
    <Surface
      as="aside"
      appearance="sidebar"
      shape="none"
      className={styles.sidebar}
      aria-label="Task navigation"
      data-workspace-drop={workspaceDropActive || undefined}
      onDragEnter={(event) => { if (!acceptsFinderDrop(event)) return; event.preventDefault(); event.stopPropagation(); setWorkspaceDropActive(true); }}
      onDragOver={(event) => { if (!acceptsFinderDrop(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setWorkspaceDropActive(true); }}
      onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setWorkspaceDropActive(false); }}
      onDrop={(event) => { if (acceptsFinderDrop(event)) void registerWorkspaceDrop(event); }}
    >
      <nav className={styles.primary}>
        <Control recipe="row" className={styles.navButton} asChild>
          <Link to="/new"><Plus size={15} /><span>{t("newTask")}</span></Link>
        </Control>
        <Control recipe="row" className={styles.navButton} onClick={onSearch}>
          <Search size={15} /><span>{t("search")}</span><kbd>⌘K</kbd>
        </Control>
      </nav>
      <section className={`${styles.section} ${styles.projects}`}>
        {activeProject && <>
          <ProjectPicker activeProject={activeProject} projects={visibleProjects} query={projectQuery} onQuery={setProjectQuery} onRemove={setRemoveProject} onActivate={(projectId) => projects.activate.mutate(projectId)} />
          <CapacityBar workspace={workspace} />
          <div className={styles.taskList}>{projectTasks.map((task) => <TaskRow key={task.taskId} task={task} project={activeProject} />)}</div>
        </>}
      </section>
      <nav className={styles.bottom}>
        <Control recipe="row" className={styles.navButton} data-active-icon={lanShare.status.data?.enabled || undefined} onClick={openLanSharePopover}>
          <Wifi size={15} /><span>{t("lanShare")}</span>
        </Control>
        <SidebarLink to="/settings/automations" icon={<Bot size={15} />} label={t("automations")} />
        <SidebarLink to="/settings/extensions/plugins" icon={<Blocks size={15} />} label={t("extensions")} />
        <SidebarLink to="/settings/general" icon={<Settings size={15} />} label={t("settings")} />
        <ThemeShortcut />
      </nav>
      {workspaceDropError && <div className={styles.dropError} role="alert">{workspaceDropError}</div>}
      {workspaceDropActive && <div className={styles.dropOverlay} role="status"><FolderPlus size={20} /><span>{t("dropFoldersToAddProjects")}</span></div>}
    </Surface>
    {removeProject && <SemanticMutationDialog open title={t("removeProject", { name: removeProject.name })} target={removeProject.name} changes={[{ field: t("projects"), before: t("indexed"), after: t("removedFromIndex") }]} warnings={[t("removeProjectConfirm", { name: removeProject.name })]} pending={projects.remove.isPending} destructive onOpenChange={(open) => { if (!open) setRemoveProject(null); }} onApply={() => projects.remove.mutate(removeProject.projectId, { onSuccess: () => setRemoveProject(null) })} />}
  </>;
}

function ProjectPicker({ activeProject, projects, query, onQuery, onRemove, onActivate }: {
  activeProject: { projectId: string; name: string; displayPath: string };
  projects: Array<{ projectId: string; name: string; displayPath: string; active: boolean }>;
  query: string;
  onQuery: (value: string) => void;
  onRemove: (project: { projectId: string; name: string }) => void;
  onActivate: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  return <PopoverRoot>
    <PopoverTrigger asChild>
      <Control recipe="row" className={styles.projectButton}>
        <span className={styles.projectIdentity}><strong>{activeProject.name}</strong><small>{activeProject.displayPath}</small></span>
        <ChevronDown size={12} />
      </Control>
    </PopoverTrigger>
    <PopoverContent className={styles.projectPopover} sideOffset={6} align="start">
      <Input density="compact" autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("searchProject")} />
      <div className={styles.projectOptions}>{projects.map((project) => <ProjectOption key={project.projectId} project={project} onActivate={onActivate} onRemove={onRemove} />)}</div>
      <Control recipe="row" className={styles.openProject} onClick={() => void window.grokDesktop?.chooseProject()}><FolderPlus size={13} />{t("openProject")}</Control>
    </PopoverContent>
  </PopoverRoot>;
}

function ProjectOption({ project, onActivate, onRemove }: {
  project: { projectId: string; name: string; displayPath: string; active: boolean };
  onActivate: (projectId: string) => void;
  onRemove: (project: { projectId: string; name: string }) => void;
}) {
  const { t } = useTranslation();
  return <Surface className={styles.projectOption} appearance="plain" shape="control" interactive selected={project.active}>
    <Control recipe="row" className={styles.projectSelect} onClick={() => onActivate(project.projectId)}>
      <span><strong>{project.name}</strong><small>{project.displayPath}</small></span>{project.active && <Check size={13} />}
    </Control>
    <Control recipe="icon" density="compact" tone="danger" className={styles.removeProject} onClick={() => onRemove({ projectId: project.projectId, name: project.name })} aria-label={t("removeProject", { name: project.name })}><X size={12} /></Control>
  </Surface>;
}
