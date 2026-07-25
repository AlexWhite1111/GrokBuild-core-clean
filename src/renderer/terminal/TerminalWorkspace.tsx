import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProjectSummary, TerminalShell } from "../../shared/contracts.js";
import { TerminalPanel } from "./TerminalPanel.js";
import {
  addShellRunTab,
  closeTerminalTab,
  createTerminalWorkspace,
  openManualTerminalTab,
  selectTerminalTab,
  setTerminalPanelOpen,
  switchTerminalProject,
} from "./terminalTabs.js";
import styles from "./TerminalWorkspace.module.css";

interface ProjectTerminalContextValue {
  available: boolean;
  open: boolean;
  toggle(): void;
  runShell(shell: TerminalShell, code: string): void;
}

const ProjectTerminalContext = createContext<ProjectTerminalContextValue>({
  available: false,
  open: false,
  toggle: () => undefined,
  runShell: () => undefined,
});

export function useProjectTerminal(): ProjectTerminalContextValue {
  return useContext(ProjectTerminalContext);
}

export function TerminalWorkspaceProvider({ activeProjectId, projects, children }: {
  activeProjectId: string | null;
  projects: ProjectSummary[];
  children: ReactNode;
}) {
  const [state, setState] = useState(createTerminalWorkspace);
  const activeProject = activeProjectId ? projects.find((project) => project.projectId === activeProjectId) || null : null;
  const scoped = Boolean(activeProject && state.projectId === activeProject.projectId);
  const storedProject = state.projectId ? projects.find((project) => project.projectId === state.projectId) || null : null;

  useEffect(() => {
    if (activeProjectId) setState((current) => switchTerminalProject(current, activeProjectId));
  }, [activeProjectId]);
  useEffect(() => {
    if (state.projectId && !projects.some((project) => project.projectId === state.projectId)) setState(createTerminalWorkspace());
  }, [projects, state.projectId]);

  const toggle = useCallback(() => {
    if (!activeProjectId) return;
    setState((current) => {
      const project = switchTerminalProject(current, activeProjectId);
      if (project.open) return setTerminalPanelOpen(project, false);
      return project.tabs.length > 0
        ? setTerminalPanelOpen(project, true)
        : openManualTerminalTab(project, crypto.randomUUID());
    });
  }, [activeProjectId]);
  const runShell = useCallback((shell: TerminalShell, code: string) => {
    if (!activeProjectId || !code.trim()) return;
    setState((current) => addShellRunTab(switchTerminalProject(current, activeProjectId), crypto.randomUUID(), shell, code));
  }, [activeProjectId]);
  const context = useMemo<ProjectTerminalContextValue>(() => ({
    available: Boolean(window.grokDesktop && activeProject),
    open: scoped && state.open,
    toggle,
    runShell,
  }), [activeProject, runShell, scoped, state.open, toggle]);

  return <ProjectTerminalContext.Provider value={context}>
    <div className={styles.workspace}>
      <div className={styles.content}>{children}</div>
      {storedProject && <TerminalPanel
        projectId={storedProject.projectId}
        projectLabel={storedProject.name}
        open={scoped && state.open}
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onNewTab={() => setState((current) => openManualTerminalTab(current, crypto.randomUUID()))}
        onSelectTab={(id) => setState((current) => selectTerminalTab(current, id))}
        onCloseTab={(id) => setState((current) => closeTerminalTab(current, id))}
        onClose={() => setState((current) => setTerminalPanelOpen(current, false))}
      />}
    </div>
  </ProjectTerminalContext.Provider>;
}
