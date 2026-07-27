import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Code2, ExternalLink, Eye, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocalRunArtifact, LocalRunSnapshot } from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import { useUiPreferences } from "../api/hooks.js";
import { DiagramViewport } from "./DiagramViewport.js";
import { HtmlPreview } from "./HtmlPreview.js";
import { InteractiveRunPreview } from "./InteractiveRunPreview.js";
import { ModelArtifactPreview } from "./ModelArtifactPreview.js";
import { PreviewExpandButton, PreviewShell } from "./PreviewShell.js";
import { sanitizeSvgMarkup } from "./svgSanitizer.js";
import { VisualCanvas, useVisualCanvasController } from "./VisualCanvas.js";
import { Control, Surface, Text } from "../../ui/components/index.js";
import styles from "./CodeBlock.module.css";
import { SpiceRunResult } from "./SpiceRunResult.js";
import { CodeScrollRegion } from "./CodeScrollRegion.js";

export function LocalRunResult({ api, snapshot, error }: { api: ApiClient; snapshot: LocalRunSnapshot | null; error: string | null }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedFigure, setSelectedFigure] = useState<number | null>(null);
  const figures = snapshot?.interactive?.status === "ready" ? snapshot.interactive.figureIds : [];
  const activeFigure = selectedFigure && figures.includes(selectedFigure) ? selectedFigure : figures[0] || null;
  const spice = snapshot?.language === "spice" ? snapshot.spice : null;
  useEffect(() => {
    if (activeFigure !== selectedFigure) setSelectedFigure(activeFigure);
  }, [activeFigure, selectedFigure]);
  if (!snapshot && !error) return null;
  return <Surface appearance="raised" elevation="inset" shape="none" className={styles.runResult} aria-live="polite">
    <div className={styles.runResultHeader}>
      <Control recipe="text" density="compact" shape="none" className={styles.runResultToggle} onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={t(collapsed ? "expandPreview" : "collapsePreview")}>
        <ChevronDown className={collapsed ? styles.chevronCollapsed : ""} size={13} />
        <div className={styles.runMeta}><Text tone="muted" size="label">{snapshot?.status || "error"}</Text>{snapshot && <>{snapshot.spice && <Text tone="muted" size="label">{snapshot.spice.simulator}</Text>}<Text tone="muted" size="label">{t(snapshot.workingDirectory === "project" ? "projectDirectory" : "isolatedDirectory")}</Text>{snapshot.durationMs !== null && <Text tone="muted" size="label">{snapshot.durationMs} ms</Text>}{snapshot.truncated && <Text tone="warning" size="label">truncated</Text>}</>}</div>
      </Control>
      {(activeFigure || spice) && <div className={styles.runResultActions}>
        {figures.length > 1 && figures.map((figureId) => <Control key={figureId} recipe="text" density="compact" selected={figureId === activeFigure} onClick={() => setSelectedFigure(figureId)} aria-label={`Figure ${figureId}`}>{figureId}</Control>)}
        <PreviewExpandButton onClick={() => setDetailOpen(true)} />
      </div>}
    </div>
    {!collapsed && <div className={styles.runResultBody}>
      {error && <CodeScrollRegion data-copy-rendered className={styles.runError}>{error}</CodeScrollRegion>}
      {snapshot && spice
        ? <SpiceRunResult result={spice} log={snapshot.stdout} errorLog={snapshot.stderr} running={snapshot.status === "running"} />
        : <>{snapshot?.stdout && <CodeScrollRegion data-copy-rendered className={styles.runOutput}>{snapshot.stdout}</CodeScrollRegion>}{snapshot?.stderr && <CodeScrollRegion data-copy-rendered className={styles.runError}>{snapshot.stderr}</CodeScrollRegion>}{snapshot && activeFigure && <InteractiveRunPreview api={api} snapshot={snapshot} figureId={activeFigure} />}</>}
      {snapshot?.artifacts.map((artifact) => <ArtifactPreview key={artifact.artifactId} api={api} runId={snapshot.runId} artifact={artifact} />)}
    </div>}
    {snapshot && (activeFigure || spice) && <PreviewShell open={detailOpen} onOpenChange={setDetailOpen} accessibleTitle={activeFigure ? "Matplotlib" : "NGspice"} toolbarTitle={activeFigure ? "Matplotlib" : "NGspice"}>
      {activeFigure ? <InteractiveRunPreview api={api} snapshot={snapshot} figureId={activeFigure} detail /> : spice ? <SpiceRunResult result={spice} log={snapshot.stdout} errorLog={snapshot.stderr} running={snapshot.status === "running"} detail /> : null}
    </PreviewShell>}
  </Surface>;
}

function ArtifactPreview({ api, runId, artifact }: { api: ApiClient; runId: string; artifact: LocalRunArtifact }) {
  const { t } = useTranslation();
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    let active = true; let objectUrl: string | null = null;
    const path = `/local-runs/${runId}/artifacts/${artifact.artifactId}`;
    const textual = ["svg", "html", "json", "csv", "text"].includes(artifact.kind);
    void (textual ? api.text(path) : api.blob(path).then((blob) => { objectUrl = URL.createObjectURL(blob); return objectUrl; }))
      .then((value) => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, artifact.artifactId, artifact.kind, runId]);
  if (error) return <div className={styles.renderError}>{artifact.name}: unavailable</div>;
  if (data === null) return <div className={styles.previewLoading} />;
  const textual = ["svg", "html", "json", "csv", "text"].includes(artifact.kind);
  const caption = <div className={styles.artifactHeader}><Text as="figcaption" tone="muted" size="label" truncate>{artifact.name}</Text><div>
    {textual && <Control recipe="icon" density="compact" selected={raw} onClick={() => setRaw((value) => !value)} aria-label={t(raw ? "artifactPreview" : "artifactSource")}>{raw ? <Eye size={13} /> : <Code2 size={13} />}</Control>}
    {window.grokDesktop && <><Control recipe="icon" density="compact" onClick={() => void artifactAction("open")} aria-label={t("openArtifact")}><ExternalLink size={13} /></Control><Control recipe="icon" density="compact" onClick={() => void artifactAction("reveal")} aria-label={t("revealArtifact")}><FolderOpen size={13} /></Control></>}
  </div></div>;
  if (raw && textual) return <Artifact caption={caption}><CodeScrollRegion data-copy-rendered className={styles.runOutput}>{prettyText(artifact.kind, data)}</CodeScrollRegion></Artifact>;
  if (artifact.kind === "image") return <Artifact caption={caption}><ArtifactImage src={data} alt={artifact.name} /></Artifact>;
  if (artifact.kind === "audio") return <Artifact caption={caption}><audio controls preload="metadata" src={data} /></Artifact>;
  if (artifact.kind === "video") return <Artifact caption={caption}><video controls preload="metadata" data-shape="control" src={data} /></Artifact>;
  if (artifact.kind === "model3d") return <Artifact caption={caption}><ModelArtifactPreview src={data} name={artifact.name} /></Artifact>;
  if (artifact.kind === "svg") {
    const svg = sanitizeSvgMarkup(data);
    return <Artifact caption={caption}>{svg ? <DiagramViewport svg={svg} /> : <div className={styles.renderError}>SVG unavailable</div>}</Artifact>;
  }
  if (artifact.kind === "html") return <Artifact caption={caption}><HtmlPreview api={api} language="html" source={data} /></Artifact>;
  if (artifact.kind === "pdf") return <Artifact caption={caption}><iframe className={styles.pdfArtifact} data-shape="control" src={data} title={artifact.name} /></Artifact>;
  return <Artifact caption={caption}><CodeScrollRegion data-copy-rendered className={styles.runOutput}>{prettyText(artifact.kind, data)}</CodeScrollRegion></Artifact>;

  function artifactAction(action: "open" | "reveal") {
    return window.grokDesktop?.runArtifactAction({ runId, artifactId: artifact.artifactId, action }).catch(() => setError(true));
  }
}

function ArtifactImage({ src, alt }: { src: string; alt: string }) {
  const preferences = useUiPreferences().data;
  const controller = useVisualCanvasController(preferences?.mediaInitialSize || "native");
  const [natural, setNatural] = useState({ width: 1024, height: 768 });
  return <VisualCanvas
    ariaLabel={alt}
    className={styles.artifactVisual}
    controller={controller}
    naturalWidth={natural.width}
    naturalHeight={natural.height}
    comfortablePercent={preferences?.mediaPreviewScale}
    minimumSize={preferences?.mediaMinimumSize}
  >
    <img src={src} alt={alt} draggable={false} onLoad={(event) => {
      const image = event.currentTarget;
      if (image.naturalWidth && image.naturalHeight) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    }} />
  </VisualCanvas>;
}

function Artifact({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return <Surface as="figure" appearance="plain" elevation="inset" shape="none" className={styles.artifact}>{caption}<div className={styles.artifactContent}>{children}</div></Surface>;
}

function prettyText(kind: LocalRunArtifact["kind"], value: string): string {
  if (kind !== "json") return value;
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}
