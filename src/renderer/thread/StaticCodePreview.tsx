import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StaticPreviewKind } from "./codeBlockRegistry.js";
import { THEME_APPLIED_EVENT } from "../../ui/theme/index.js";
import { DiagramViewport } from "./DiagramViewport.js";
import type { VisualCanvasController } from "./VisualCanvas.js";
import { repairMermaidLabelContrast } from "./mermaidLabelContrast.js";
import { mermaidConfiguration } from "./mermaidPreviewPolicy.js";
import { sanitizeSvgMarkup } from "./svgSanitizer.js";
import { SpicePreview } from "./SpicePreview.js";
import styles from "./CodeBlock.module.css";

interface PreviewProps { kind: StaticPreviewKind; source: string; controller?: VisualCanvasController; detail?: boolean; comfortablePercent?: number; minimumSize?: number }

export function StaticCodePreview({ kind, source, controller, detail = false, comfortablePercent, minimumSize }: PreviewProps) {
  if (kind === "mermaid") return <MermaidPreview source={source} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
  if (kind === "svg") return <SvgPreview source={source} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
  if (kind === "dot") return <DotPreview source={source} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
  if (kind === "spice") return <SpicePreview source={source} detail={detail} />;
  return <DataPreview kind={kind} source={source} detail={detail} />;
}

function MermaidPreview({ source, controller, detail, comfortablePercent, minimumSize }: DiagramPreviewProps) {
  const id = `grok-mermaid-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const [state, setState] = useState<string | false | null>(null);
  const themeRevision = useThemeRevision();
  useEffect(() => {
    let active = true;
    setState(null);
    void renderMermaidMarkup(source, id).then((clean) => {
      if (active) setState(clean);
    }).catch(() => { if (active) setState(false); });
    return () => { active = false; };
  }, [id, source, themeRevision]);
  return <PreviewState value={state} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
}

function SvgPreview({ source, controller, detail, comfortablePercent, minimumSize }: DiagramPreviewProps) {
  const svg = useMemo(() => sanitizeSvgMarkup(source), [source]);
  return <PreviewState value={svg || false} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
}

function DotPreview({ source, controller, detail, comfortablePercent, minimumSize }: DiagramPreviewProps) {
  const [state, setState] = useState<string | false | null>(null);
  useEffect(() => {
    let active = true;
    setState(null);
    void import("@viz-js/viz").then(async ({ instance }) => {
      const viz = await instance();
      const clean = sanitizeSvgMarkup(viz.renderString(source, { format: "svg", engine: "dot" }), true);
      if (!clean) throw new Error("Unsafe Graphviz output");
      if (active) setState(clean);
    }).catch(() => { if (active) setState(false); });
    return () => { active = false; };
  }, [source]);
  return <PreviewState value={state} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
}

interface DiagramPreviewProps { source: string; controller?: VisualCanvasController; detail?: boolean; comfortablePercent?: number; minimumSize?: number }

async function renderMermaidMarkup(source: string, id: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize(mermaidConfiguration(mermaidTheme()));
  const rendered = await mermaid.render(id, source);
  const clean = sanitizeSvgMarkup(rendered.svg, true, true);
  if (!clean) throw new Error("Unsafe Mermaid output");
  return repairMermaidLabelContrast(clean);
}

function PreviewState({ value, controller, detail, comfortablePercent, minimumSize }: { value: string | false | null; controller?: VisualCanvasController; detail?: boolean; comfortablePercent?: number; minimumSize?: number }) {
  const { t } = useTranslation();
  if (value === null) return <div className={styles.previewLoading} aria-label={t("loading")} />;
  if (value === false) return <div className={styles.renderError}>{t("renderFailed")}</div>;
  return <DiagramViewport svg={value} controller={controller} detail={detail} comfortablePercent={comfortablePercent} minimumSize={minimumSize} />;
}

function DataPreview({ kind, source, detail }: { kind: Exclude<StaticPreviewKind, "mermaid" | "svg" | "dot" | "spice">; source: string; detail: boolean }) {
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(undefined); setError(false);
    void parseData(kind, source).then((value) => { if (active) setResult(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [kind, source]);
  if (error) return <div className={styles.renderError}>Invalid {kind.toUpperCase()}</div>;
  if (result === undefined) return <div className={styles.previewLoading} />;
  if (kind === "csv" || kind === "tsv") return <DataTable rows={result as string[][]} detail={detail} />;
  if (kind === "notebook") return <NotebookPreview notebook={result as Notebook} detail={detail} />;
  return <pre className={`${styles.dataPreview} ${detail ? styles.detailData : ""}`}><code>{JSON.stringify(result, null, 2)}</code></pre>;
}

async function parseData(kind: string, source: string): Promise<unknown> {
  if (kind === "json") return JSON.parse(source.replace(/^\uFEFF/, ""));
  if (kind === "jsonc") return JSON.parse(normalizeJsonc(source));
  if (kind === "jsonl") return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  if (kind === "yaml") return (await import("yaml")).parse(source);
  if (kind === "toml") return (await import("smol-toml")).parse(source);
  if (kind === "csv" || kind === "tsv") return parseDelimited(source, kind === "tsv" ? "\t" : ",");
  return JSON.parse(source) as Notebook;
}

function parseDelimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < source.length && rows.length < 300; index += 1) {
    const char = source[index];
    if (char === '"') { if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row.slice(0, 50)); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row.slice(0, 50)); }
  return rows;
}

function DataTable({ rows, detail }: { rows: string[][]; detail: boolean }) {
  if (!rows.length) return <div className={styles.renderError}>Empty data</div>;
  return <div className={`${styles.dataTableWrap} ${detail ? styles.detailData : ""}`}><table className={styles.dataTable}><thead><tr>{rows[0].map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

interface Notebook { cells?: Array<{ cell_type?: string; source?: string | string[]; outputs?: Array<{ text?: string | string[]; data?: Record<string, string | string[]> }> }> }
function NotebookPreview({ notebook, detail }: { notebook: Notebook; detail: boolean }) {
  return <div className={`${styles.notebook} ${detail ? styles.detailData : ""}`}>{(notebook.cells || []).slice(0, 100).map((cell, index) => {
    const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source || "";
    return <section key={index}><small>{cell.cell_type || "cell"} {index + 1}</small><pre><code>{source}</code></pre>{(cell.outputs || []).map((output, outputIndex) => {
      const value = Array.isArray(output.text) ? output.text.join("") : output.text || textOutput(output.data);
      return value ? <pre className={styles.notebookOutput} key={outputIndex}>{value}</pre> : null;
    })}</section>;
  })}</div>;
}
function textOutput(data?: Record<string, string | string[]>): string { const value = data?.["text/plain"]; return Array.isArray(value) ? value.join("") : value || ""; }

function mermaidTheme() {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  const surface = color("--color-surface-muted", "#ece8df");
  const raised = color("--color-surface-raised", "#f6f2e9");
  const text = color("--color-text", "#27241f");
  const line = color("--color-text-muted", "#777169");
  const border = color("--color-border-strong", "#9b9489");
  return {
    darkMode: document.documentElement.dataset.appearance === "dark",
    background: "transparent", primaryColor: surface, primaryTextColor: text, primaryBorderColor: border,
    lineColor: line, secondaryColor: raised, secondaryTextColor: text, tertiaryColor: color("--color-surface", "#efeae0"), tertiaryTextColor: text,
    fontFamily: color("--font-ui", "system-ui"), textColor: text, nodeTextColor: text, titleColor: text, mainBkg: surface, nodeBorder: border,
    clusterBkg: raised, clusterBorder: border, actorBkg: raised, actorBorder: border, actorTextColor: text,
    signalColor: line, signalTextColor: text, labelBoxBkgColor: raised, labelTextColor: text, edgeLabelBackground: raised,
    rowOdd: surface, rowEven: raised, attributeBackgroundColorOdd: surface, attributeBackgroundColorEven: raised,
    transitionColor: line, transitionLabelColor: text, stateLabelColor: text, stateBkg: surface,
    stateBorder: border, labelBackgroundColor: raised, compositeBackground: raised, altBackground: surface,
    compositeTitleBackground: raised, compositeBorder: border, innerEndBackground: surface, specialStateColor: line,
    noteBkgColor: raised, noteTextColor: text, noteBorderColor: border,
    pie1: color("--color-accent", "#9a653f"), pie2: surface, pie3: raised, pieTitleTextColor: text,
    taskBkgColor: surface, taskTextColor: text, taskBorderColor: border, activeTaskBkgColor: raised,
    activeTaskLabelColor: text, taskTextDarkColor: text, sectionBkgColor: raised, altSectionBkgColor: surface,
    gridColor: border, todayLineColor: color("--color-accent", "#9a653f"), commitLabelColor: text, commitLabelBackground: raised,
    git0: surface, git1: raised, git2: color("--color-surface", "#efeae0"), git3: surface, gitBranchLabel0: text, gitBranchLabel1: text,
  };
}

function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(THEME_APPLIED_EVENT, refresh);
    return () => window.removeEventListener(THEME_APPLIED_EVENT, refresh);
  }, []);
  return revision;
}

function normalizeJsonc(source: string): string {
  let output = ""; let quoted = false; let escaped = false; let lineComment = false; let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]; const next = source[index + 1];
    if (lineComment) { if (char === "\n") { lineComment = false; output += char; } continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; index += 1; } else if (char === "\n") output += char; continue; }
    if (!quoted && char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (!quoted && char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    output += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
  }
  return stripTrailingJsonCommas(output.replace(/^\uFEFF/, ""));
}

function stripTrailingJsonCommas(source: string): string {
  let output = ""; let quoted = false; let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!quoted && char === ",") {
      let cursor = index + 1;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      if (source[cursor] === "}" || source[cursor] === "]") continue;
    }
    output += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
  }
  return output;
}
