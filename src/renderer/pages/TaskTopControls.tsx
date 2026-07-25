import { PanelBottom, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { Control, UiIcon } from "../../ui/components/index.js";
import styles from "./TaskPage.module.css";

export function TaskTopControls({
  sourceControl,
  terminalOpen,
  contextOpen,
  terminalLabel,
  contextLabel,
  onToggleTerminal,
  onToggleContext,
  groupLabel,
}: {
  sourceControl: ReactNode;
  terminalOpen: boolean;
  contextOpen: boolean;
  terminalLabel: string;
  contextLabel: string;
  groupLabel: string;
  onToggleTerminal: () => void;
  onToggleContext: () => void;
}) {
  return <div className={styles.topControls} role="group" aria-label={groupLabel} data-task-top-controls>
    {sourceControl}
    {window.grokDesktop && <Control recipe="icon" density="titlebar" shape="none" className={styles.topControl} data-active-icon={terminalOpen || undefined} aria-pressed={terminalOpen} aria-label={terminalLabel} title={terminalLabel} onClick={onToggleTerminal}><UiIcon source={PanelBottom} /></Control>}
    <Control recipe="icon" density="titlebar" shape="none" className={styles.topControl} data-active-icon={contextOpen || undefined} aria-pressed={contextOpen} aria-label={contextLabel} title={contextLabel} onClick={onToggleContext}><UiIcon source={PanelRight} /></Control>
  </div>;
}
