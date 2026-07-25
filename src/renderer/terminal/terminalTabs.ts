import type { TerminalRunRequest, TerminalShell } from "../../shared/contracts.js";

export interface TerminalTab {
  id: string;
  title: string;
  run?: TerminalRunRequest;
}

export interface TerminalWorkspaceState {
  projectId: string | null;
  open: boolean;
  activeTabId: string | null;
  tabs: TerminalTab[];
}

export function createTerminalWorkspace(): TerminalWorkspaceState {
  return { projectId: null, open: false, activeTabId: null, tabs: [] };
}

export function switchTerminalProject(state: TerminalWorkspaceState, projectId: string): TerminalWorkspaceState {
  return state.projectId === projectId
    ? state
    : { projectId, open: false, activeTabId: null, tabs: [] };
}

export function openManualTerminalTab(state: TerminalWorkspaceState, id: string): TerminalWorkspaceState {
  return appendTab(state, { id, title: "zsh" });
}

export function addShellRunTab(state: TerminalWorkspaceState, id: string, language: string, code: string): TerminalWorkspaceState {
  const shell = terminalShell(language);
  return appendTab(state, { id, title: terminalTabTitle(code, shell), run: { shell, code } });
}

export function closeTerminalTab(state: TerminalWorkspaceState, id: string): TerminalWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const activeTabId = state.activeTabId === id
    ? tabs[Math.min(index, tabs.length - 1)]?.id || null
    : state.activeTabId;
  return { ...state, tabs, activeTabId, open: tabs.length > 0 && state.open };
}

export function setTerminalPanelOpen(state: TerminalWorkspaceState, open: boolean): TerminalWorkspaceState { return { ...state, open }; }

export function selectTerminalTab(state: TerminalWorkspaceState, id: string): TerminalWorkspaceState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, activeTabId: id } : state;
}

function appendTab(state: TerminalWorkspaceState, tab: TerminalTab): TerminalWorkspaceState {
  return { ...state, open: true, activeTabId: tab.id, tabs: [...state.tabs, tab] };
}

function terminalShell(language: string): TerminalShell {
  const normalized = language.trim().toLowerCase();
  if (normalized === "bash" || normalized === "sh") return normalized;
  return "zsh";
}

function terminalTabTitle(code: string, fallback: TerminalShell): string {
  const line = code.split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("#!"));
  const title = (line || fallback).replace(/^\$\s*/, "").replace(/\s+/g, " ");
  return title.length > 36 ? `${title.slice(0, 35)}…` : title;
}
