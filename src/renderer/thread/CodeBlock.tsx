import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Check, ChevronDown, Code2, Copy, FolderOpen, Play, Square, WrapText } from "lucide-react";
import { useOptionalBootstrap } from "../api/BootstrapContext.js";
import { DEFAULT_CODE_PREVIEW_POLICY, parseSpiceNetlist, type LocalRunLanguage } from "../../shared/contracts.js";
import { useUiPreferences } from "../api/hooks.js";
import { codeCapability, codeDefaultView, webCodePreviewEnabled } from "./codeBlockRegistry.js";
import { HtmlPreview } from "./HtmlPreview.js";
import { LocalRunResult } from "./LocalRunResult.js";
import { PreviewExpandButton, PreviewShell } from "./PreviewShell.js";
import { StaticCodePreview } from "./StaticCodePreview.js";
import { useLocalRun } from "./useLocalRun.js";
import { Control, Surface } from "../../ui/components/index.js";
import { VisualCanvasControls, useVisualCanvasController, type VisualCanvasController } from "./VisualCanvas.js";
import { highlightCodeSource } from "./codeSyntax.js";
import { CodeScrollRegion } from "./CodeScrollRegion.js";
import { useProjectTerminal } from "../terminal/TerminalWorkspace.js";
import styles from "./CodeBlock.module.css";

export function CodeBlock({
  language,
  code,
  taskId,
  compact = false,
  implicit = false,
  streaming = false,
  markdownSource,
}: {
  language?: string;
  code: string;
  taskId?: string;
  compact?: boolean;
  implicit?: boolean;
  streaming?: boolean;
  markdownSource?: { start: number; end: number };
}) {
  const { t } = useTranslation();
  const preferences = useUiPreferences().data;
  const bootstrap = useOptionalBootstrap();
  const terminal = useProjectTerminal();
  const capability = codeCapability(language, code);
  const previewPolicy = preferences?.codePreview || DEFAULT_CODE_PREVIEW_POLICY;
  const webPreview = webCodePreviewEnabled(capability, code, previewPolicy, Boolean(bootstrap));
  const defaultView = codeDefaultView(capability, webPreview, streaming);
  const displayLanguage = capability.language === "spice" ? "spice" : language || "text";
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<"preview" | "source">(defaultView);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renderRevision, setRenderRevision] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [runDirectory, setRunDirectory] = useState<"isolated" | "project">("isolated");
  const inlineVisual = useVisualCanvasController(preferences?.mediaInitialSize || "native");
  const detailVisual = useVisualCanvasController("fit");
  const localLanguage: LocalRunLanguage | null = capability.execute === "python" || capability.execute === "spice" ? capability.execute : null;
  const localRun = useLocalRun(localLanguage ? bootstrap?.api || null : null, code, runDirectory, localLanguage || "python");
  const spiceUsesProject = useMemo(() => localLanguage === "spice" && parseSpiceNetlist(code).hasExternalReferences, [code, localLanguage]);
  const running = localRun.snapshot?.status === "running";
  const canRun = !streaming && (localLanguage ? Boolean(bootstrap) : Boolean(capability.preview) || webPreview || (capability.execute === "shell" && terminal.available));
  const visualPreview = view === "preview" && (capability.preview === "mermaid" || capability.preview === "svg" || capability.preview === "dot");
  const highlightedSource = useMemo(() => highlightCodeSource(code, capability.language), [capability.language, code]);
  useLayoutEffect(() => {
    setView(defaultView);
    setRenderRevision(0);
    setDetailOpen(false);
  }, [capability.language, defaultView]);
  useEffect(() => { if (spiceUsesProject && !localRun.snapshot) setRunDirectory("project"); }, [localRun.snapshot, spiceUsesProject]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  };
  const execute = () => {
    if (localLanguage) { void (running ? localRun.stop() : localRun.run()); return; }
    if (capability.execute === "shell") { terminal.runShell(capability.language === "bash" || capability.language === "sh" ? capability.language : "zsh", code); return; }
    setRenderRevision((value) => value + 1);
    setView("preview");
  };
  const content = (detail: boolean, controller: VisualCanvasController) => {
    return view === "preview" && webPreview && bootstrap
      ? <HtmlPreview key={`${renderRevision}:${detail ? "detail" : "inline"}`} api={bootstrap.api} language={capability.language} source={code} taskId={taskId} detail={detail} embedded={implicit && !detail} />
      : view === "preview" && capability.preview
        ? <StaticCodePreview key={renderRevision} kind={capability.preview} source={code} controller={controller} detail={detail} comfortablePercent={preferences?.mediaPreviewScale} minimumSize={preferences?.mediaMinimumSize} />
        : detail
          ? <pre className={`${wrap ? styles.wrap : ""} ${styles.detailSource}`}><code className={styles.highlightedSource} dangerouslySetInnerHTML={{ __html: highlightedSource }} /></pre>
          : <CodeScrollRegion data-shape="control" className={wrap ? styles.wrap : ""}><code className={styles.highlightedSource} dangerouslySetInnerHTML={{ __html: highlightedSource }} /></CodeScrollRegion>;
  };
  const actions = (detail: boolean) => {
    if (detail && visualPreview) return <VisualCanvasControls controller={detailVisual} />;
    return <>
      {localLanguage && <Control recipe="icon" density="compact" selected={runDirectory === "project"} disabled={running} onClick={() => setRunDirectory((value) => value === "isolated" ? "project" : "isolated")} aria-label={t(runDirectory === "isolated" ? "runInIsolated" : "runInProject")}>{runDirectory === "isolated" ? <Box size={13} /> : <FolderOpen size={13} />}</Control>}
      {canRun && <Control recipe="icon" density="compact" onClick={execute} aria-label={t(running ? "stop" : "run")}>{running ? <Square size={12} /> : <Play size={13} />}</Control>}
      {view === "preview" && (capability.preview || webPreview) && <Control recipe="icon" density="compact" onClick={() => setView("source")} aria-label={t("sourceCode")}><Code2 size={13} /></Control>}
      {view === "source" && <Control recipe="icon" density="compact" selected={wrap} onClick={() => setWrap((value) => !value)} aria-label={t("wrap")}><WrapText size={13} /></Control>}
      <Control recipe="icon" density="compact" onClick={() => void copy()} aria-label={t("copy")}>{copied ? <Check size={13} /> : <Copy size={13} />}</Control>
      {!detail && <PreviewExpandButton onClick={() => setDetailOpen(true)} />}
    </>;
  };

  if (implicit) return <div
    className={`${styles.block} ${styles.implicitBlock} ${compact ? styles.compact : ""}`}
    {...(markdownSource ? {
      "data-md-source-start": String(markdownSource.start),
      "data-md-source-end": String(markdownSource.end),
    } : {})}
  >
    {webPreview && <div className={styles.implicitAction}>
      <Control
        recipe="icon"
        density="compact"
        selected={view === "source"}
        onClick={() => setView((current) => current === "preview" ? "source" : "preview")}
        aria-label={t(view === "preview" ? "sourceCode" : "preview")}
      >
        <Code2 size={13} />
      </Control>
    </div>}
    {content(false, inlineVisual)}
  </div>;

  return <>
    <Surface
      appearance="code"
      elevation="content"
      shape={compact ? "control" : "surface"}
      className={`${styles.block} ${compact ? styles.compact : ""}`}
      {...(markdownSource ? {
        "data-md-source-start": String(markdownSource.start),
        "data-md-source-end": String(markdownSource.end),
      } : {})}
    >
      <div className={styles.toolbar}>
        <Control recipe="text" density="compact" shape="none" className={styles.collapse} onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={t(collapsed ? "expandCode" : "collapseCode")}><ChevronDown className={collapsed ? styles.chevronCollapsed : ""} size={13} /><span>{displayLanguage}</span></Control>
        <div className={styles.toolbarActions}>{actions(false)}</div>
      </div>
      {!collapsed && content(false, inlineVisual)}
    </Surface>
    {localLanguage && bootstrap && <LocalRunResult api={bootstrap.api} snapshot={localRun.snapshot} error={localRun.error} />}
    <PreviewShell open={detailOpen} onOpenChange={setDetailOpen} accessibleTitle={`${displayLanguage} ${t("preview")}`} toolbarTitle={displayLanguage} actions={actions(true)}>
      <div className={styles.detailContent}>{content(true, detailVisual)}</div>
    </PreviewShell>
  </>;
}
