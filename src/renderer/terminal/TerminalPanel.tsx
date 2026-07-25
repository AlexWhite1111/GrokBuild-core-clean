import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Control, ResizeHandle, Surface, Text } from "../../ui/components/index.js";
import { terminalDimensions } from "./terminalDimensions.js";
import type { TerminalTab } from "./terminalTabs.js";
import styles from "./TerminalPanel.module.css";

type TerminalStatus = "starting" | "ready" | "closed" | "failed";

export function TerminalPanel({ projectId, projectLabel, open, tabs, activeTabId, onNewTab, onSelectTab, onCloseTab, onClose }: {
  projectId: string;
  projectLabel: string;
  open: boolean;
  tabs: TerminalTab[];
  activeTabId: string | null;
  onNewTab: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const heightRef = useRef(260);
  const [height, setHeight] = useState(260);
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({});
  const activeStatus = activeTabId ? statuses[activeTabId] || "starting" : "closed";

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightRef.current;
    const move = (pointer: PointerEvent) => {
      const next = Math.max(150, Math.min(Math.round(window.innerHeight * .68), startHeight + startY - pointer.clientY));
      heightRef.current = next;
      setHeight(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  return <Surface as="section" appearance="terminal" shape="none" className={styles.panel} data-open={open || undefined} style={{ "--terminal-height": `${height}px` } as CSSProperties}>
    <ResizeHandle orientation="horizontal" onPointerDown={beginResize} />
    <header>
      <span className={styles.project}><TerminalSquare size={13} /><span>{projectLabel}</span></span>
      <div className={styles.tabs} role="tablist" aria-label={t("terminal")}>
        {tabs.map((tab) => <div key={tab.id} className={styles.tab} data-shape="control" data-active={tab.id === activeTabId || undefined} data-status={statuses[tab.id] || "starting"}>
          <Control recipe="text" density="compact" shape="none" role="tab" aria-selected={tab.id === activeTabId} onClick={() => onSelectTab(tab.id)}>{tab.title}</Control>
          <Control recipe="icon" density="compact" shape="none" onClick={() => onCloseTab(tab.id)} aria-label={`${t("close")} ${t("terminal")}`}><X size={11} /></Control>
        </div>)}
      </div>
      <Control recipe="icon" density="compact" shape="none" onClick={onNewTab} aria-label={`${t("add")} ${t("terminal")}`}><Plus size={13} /></Control>
      <Text as="small" tone={activeStatus === "failed" ? "danger" : "muted"} size="micro" className={styles.status}>{activeStatus}</Text>
      <Control recipe="icon" density="compact" shape="none" onClick={onClose} aria-label={`${t("collapsePreview")} ${t("terminal")}`}><X size={13} /></Control>
    </header>
    <div className={styles.terminalStack}>
      {tabs.map((tab) => <TerminalTabView
        key={tab.id}
        projectId={projectId}
        tab={tab}
        open={open}
        active={tab.id === activeTabId}
        onStatus={(status) => setStatuses((current) => current[tab.id] === status ? current : { ...current, [tab.id]: status })}
      />)}
    </div>
  </Surface>;
}

function TerminalTabView({ projectId, tab, open, active, onStatus }: {
  projectId: string;
  tab: TerminalTab;
  open: boolean;
  active: boolean;
  onStatus: (status: TerminalStatus) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const sizeRef = useRef({ columns: 0, rows: 0 });

  const fitAndResize = useCallback(() => {
    const desktop = window.grokDesktop;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!desktop || !terminal || !fit || !host || host.clientWidth < 1 || host.clientHeight < 1) return;
    try { fit.fit(); } catch { return; }
    if (!startedRef.current) return;
    const next = terminalDimensions(terminal.cols, terminal.rows);
    if (next.columns === sizeRef.current.columns && next.rows === sizeRef.current.rows) return;
    sizeRef.current = next;
    void desktop.resizeTerminal({ sessionId: tab.id, ...next }).catch(() => undefined);
  }, [tab.id]);

  useEffect(() => {
    const desktop = window.grokDesktop;
    const host = hostRef.current;
    if (!desktop || !host) { onStatus("failed"); return; }
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: terminalFont(),
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5_000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const dataSubscription = terminal.onData((data) => void desktop.writeTerminal({ sessionId: tab.id, data }).catch(() => undefined));
    const stopData = desktop.onTerminalData((event) => { if (event.sessionId === tab.id) terminal.write(event.data); });
    const stopExit = desktop.onTerminalExit((event) => {
      if (event.sessionId !== tab.id) return;
      startedRef.current = false;
      onStatus(event.error || (event.code !== null && event.code !== 0) ? "failed" : "closed");
      terminal.write(event.error ? `\r\n${event.error}\r\n` : "\r\n[session closed]\r\n");
    });
    const resize = new ResizeObserver(fitAndResize);
    resize.observe(host);
    let disposed = false;
    const frame = requestAnimationFrame(() => {
      fitAndResize();
      const initialSize = terminalDimensions(terminal.cols, terminal.rows);
      void desktop.startTerminal({ sessionId: tab.id, projectId, ...initialSize, run: tab.run }).then(() => {
        if (disposed) { void desktop.stopTerminal(tab.id); return; }
        startedRef.current = true;
        onStatus("ready");
        fitAndResize();
        if (active && open) terminal.focus();
      }).catch((cause) => {
        if (disposed) return;
        onStatus("failed");
        terminal.write(`\r\n${cause instanceof Error ? cause.message : String(cause)}\r\n`);
      });
    });
    return () => {
      disposed = true;
      startedRef.current = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      stopData();
      stopExit();
      dataSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      void desktop.stopTerminal(tab.id).catch(() => undefined);
    };
  }, [fitAndResize, projectId, tab.id]);

  useEffect(() => {
    if (!active || !open) return;
    const frame = requestAnimationFrame(() => {
      fitAndResize();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, fitAndResize, open]);

  return <div ref={hostRef} className={styles.terminal} data-active={active || undefined} role="tabpanel" />;
}

function terminalTheme() {
  return {
    background: "#000000",
    foreground: "#f5f5f7",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#264f78",
    selectionForeground: "#ffffff",
    black: "#000000",
    red: "#cd3131",
    green: "#00a86b",
    yellow: "#c19c00",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#0e9fb5",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  };
}

function terminalFont(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim() || "SFMono-Regular, Menlo, monospace";
}
