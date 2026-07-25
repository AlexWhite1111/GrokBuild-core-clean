import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import type { PreviewPrepareResponse } from "../../shared/contracts.js";
import { needsModuleScript, previewRemoteImportMap } from "../../shared/previewModules.js";
import { useOptionalBootstrap } from "../api/BootstrapContext.js";
import { THEME_APPLIED_EVENT } from "../../ui/theme/index.js";
import styles from "./CodeBlock.module.css";

type PreparedPreview =
  | { kind: "loading" }
  | { kind: "url"; value: string }
  | { kind: "document"; value: string };

export function HtmlPreview({
  language,
  source,
  taskId,
  detail = false,
  embedded = false,
  className,
  style: suppliedStyle,
  ...props
}: {
  language: string;
  source: string;
  taskId?: string;
  detail?: boolean;
  embedded?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const id = useId();
  const bootstrap = useOptionalBootstrap();
  const host = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const visible = useRef(true);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [contentHeight, setContentHeight] = useState(() => initialPreviewHeight(embedded));
  const fallbackDocument = useMemo(() => previewDocument(language, source, id, embedded), [embedded, id, language, source]);
  const [prepared, setPrepared] = useState<PreparedPreview>(() => bootstrap ? { kind: "loading" } : { kind: "document", value: fallbackDocument });

  useEffect(() => {
    let current = true;
    const request = new AbortController();
    setConsoleLines([]);
    setContentHeight(initialPreviewHeight(embedded));
    if (!bootstrap) {
      setPrepared({ kind: "document", value: fallbackDocument });
      return () => { current = false; };
    }
    const prepare = async () => {
      setPrepared({ kind: "loading" });
      let response: PreviewPrepareResponse;
      try {
        response = await bootstrap.api.post<PreviewPrepareResponse>("/preview/prepare", { language, source, embedded, ...(taskId ? { taskId } : {}) }, request.signal);
      } catch (firstError) {
        if (!current || request.signal.aborted) return;
        if (!isTransportFailure(firstError)) {
          setConsoleLines([`preview: ${firstError instanceof Error ? firstError.message : String(firstError)}`]);
          setPrepared({ kind: "document", value: fallbackDocument });
          return;
        }
        await delay(PREVIEW_RETRY_MS);
        if (!current || request.signal.aborted) return;
        try {
          response = await bootstrap.api.post<PreviewPrepareResponse>("/preview/prepare", { language, source, embedded, ...(taskId ? { taskId } : {}) }, request.signal);
        } catch (secondError) {
          if (!current || request.signal.aborted) return;
          if (!isTransportFailure(secondError)) setConsoleLines([`preview: ${secondError instanceof Error ? secondError.message : String(secondError)}`]);
          setPrepared({ kind: "document", value: fallbackDocument });
          return;
        }
      }
      if (!current) return;
      const url = new URL(response.path, new URL(bootstrap.api.bootstrap.apiBaseUrl).origin);
      url.searchParams.set("instance", id);
      setPrepared({ kind: "url", value: url.toString() });
    };
    const timer = window.setTimeout(() => void prepare(), PREVIEW_SETTLE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
      request.abort();
    };
  }, [bootstrap, embedded, fallbackDocument, id, language, source, taskId]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || !isPreviewMessage(event.data, id)) return;
      if (event.data.type === "console") setConsoleLines((lines) => [...lines.slice(-99), event.data.value]);
      else if (event.data.type === "resize" && !detail) setContentHeight(normalizePreviewHeight(event.data.value, embedded));
      else if (event.data.type === "ready") syncFrame(iframe.current, id, visible.current);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [detail, embedded, id]);

  useEffect(() => {
    const syncTheme = () => postControl(iframe.current, id, "theme", previewThemeSnapshot());
    window.addEventListener(THEME_APPLIED_EVENT, syncTheme);
    return () => window.removeEventListener(THEME_APPLIED_EVENT, syncTheme);
  }, [id]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let intersecting = true;
    const publish = () => {
      visible.current = intersecting && document.visibilityState !== "hidden";
      postControl(iframe.current, id, "visibility", visible.current);
    };
    const observer = new IntersectionObserver((entries) => {
      intersecting = Boolean(entries[0]?.isIntersecting);
      publish();
    }, { rootMargin: "160px" });
    observer.observe(node);
    const visibilityChange = () => publish();
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, [id]);

  useEffect(() => () => postControl(iframe.current, id, "dispose", true), [id, prepared]);

  const heightStyle = detail ? undefined : { "--html-preview-height": `${contentHeight}px` } as CSSProperties;
  const style = { ...suppliedStyle, ...heightStyle };
  return <div
    {...props}
    ref={host}
    className={`${styles.webPreview} ${className || ""}`}
    data-detail={detail || undefined}
    data-embedded={embedded || undefined}
    style={style}
  >
    {prepared.kind === "loading"
      ? <div className={styles.previewLoading} />
      : <iframe
          ref={iframe}
          title="HTML preview"
          sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
          allow="autoplay; clipboard-read; clipboard-write; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={() => syncFrame(iframe.current, id, visible.current)}
          {...(prepared.kind === "url" ? { src: prepared.value } : { srcDoc: prepared.value })}
        />}
    {consoleLines.length > 0 && <pre data-copy-rendered className={styles.previewConsole}>{consoleLines.join("\n")}</pre>}
  </div>;
}

type PreviewSize = { height: number; viewport: number };

type PreviewMessage =
  | { channel: "grok-build-preview"; id: string; type: "console"; value: string }
  | { channel: "grok-build-preview"; id: string; type: "resize"; value: number | PreviewSize }
  | { channel: "grok-build-preview"; id: string; type: "ready"; value: unknown };

function isPreviewMessage(value: unknown, id: string): value is PreviewMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== "grok-build-preview" || message.id !== id) return false;
  return message.type === "console" && typeof message.value === "string"
    || message.type === "resize" && isPreviewSize(message.value)
    || message.type === "ready";
}

function isPreviewSize(value: unknown): value is number | PreviewSize {
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  const size = value as Record<string, unknown>;
  return typeof size.height === "number" && Number.isFinite(size.height)
    && typeof size.viewport === "number" && Number.isFinite(size.viewport);
}

function syncFrame(frame: HTMLIFrameElement | null, id: string, visible: boolean): void {
  postControl(frame, id, "theme", previewThemeSnapshot());
  postControl(frame, id, "visibility", visible && document.visibilityState !== "hidden");
}

function postControl(frame: HTMLIFrameElement | null, id: string, type: "theme" | "visibility" | "dispose", value: unknown): void {
  frame?.contentWindow?.postMessage({ channel: "grok-build-preview-control", id, type, value }, "*");
}

export function previewThemeSnapshot(): { appearance: "light" | "dark"; variables: Record<string, string> } {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const variables: Record<string, string> = {};
  for (let index = 0; index < computed.length; index += 1) {
    const name = computed.item(index);
    if (!THEME_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const value = computed.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  return { appearance: root.dataset.appearance === "dark" ? "dark" : "light", variables };
}

function previewDocument(language: string, source: string, id: string, embedded: boolean): string {
  const normalized = language.toLowerCase();
  const runtime = `<script>${previewBridge(id)}</script>`;
  const head = `${previewHead()}${previewRemoteImportMap(source)}${runtime}`;
  if (normalized === "html" || normalized === "htm") return completeHtmlDocument(promoteModuleScripts(source), head, embedded);
  const body = normalized === "javascript" || normalized === "js" ? `${SCRIPT_BODY}<script${needsModuleScript(source) ? ' type="module"' : ""}>${escapeScript(source)}</script>`
    : normalized === "css" ? `<style>${source.replace(/<\/style/gi, "<\\/style")}</style>${SAMPLE_BODY}`
    : `<pre>${escapeHtml(source)}</pre>`;
  const baseStyle = embedded ? EMBED_STYLE : BASE_STYLE;
  return `<!doctype html><html><head>${head}<style>${baseStyle}</style></head><body>${body}</body></html>`;
}

function completeHtmlDocument(source: string, head: string, embedded: boolean): string {
  if (!/<html(?:\s|>)/i.test(source)) {
    const style = embedded ? EMBED_STYLE : BASE_STYLE;
    return `<!doctype html><html><head>${head}<style>${style}</style></head><body>${source}</body></html>`;
  }
  let document = source;
  if (/<head(?:\s|>)/i.test(document)) document = document.replace(/<head([^>]*)>/i, (match) => `${match}${head}`);
  else document = document.replace(/<html([^>]*)>/i, (match) => `${match}<head>${head}</head>`);
  return document;
}

function promoteModuleScripts(source: string): string {
  return source.replace(/<script(?![^>]*\btype\s*=)([^>]*)>([\s\S]*?)<\/script>/gi, (full, attributes: string, code: string) => (
    needsModuleScript(code) ? `<script type="module"${attributes}>${code}</script>` : full
  ));
}

function previewBridge(id: string): string {
  return `(()=>{const send=(type,value)=>parent.postMessage({channel:'grok-build-preview',id:${JSON.stringify(id)},type,value},'*');const text=v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}};const resize=()=>send('resize',{height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),viewport:innerHeight});for(const level of ['log','info','warn','error']){const original=console[level];console[level]=(...args)=>{send('console',level+': '+args.map(text).join(' '));original.apply(console,args)}};addEventListener('error',event=>send('console','error: '+event.message));new ResizeObserver(resize).observe(document.documentElement);addEventListener('load',resize,true);addEventListener('DOMContentLoaded',()=>send('ready',{}),{once:true});requestAnimationFrame(resize)})();`;
}

function initialPreviewHeight(embedded = false): number { return embedded ? 1 : Math.max(320, Math.round(window.innerHeight * .6)); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
function isTransportFailure(error: unknown): boolean { return error instanceof TypeError && /fetch|network|load/i.test(error.message); }
function normalizePreviewHeight(value: number | PreviewSize, embedded = false): number {
  const height = typeof value === "number" ? value : value.height;
  const viewport = typeof value === "number" ? 0 : value.viewport;
  const stableHeight = viewport > 0 && height - viewport <= 64 ? viewport : height;
  return Math.max(embedded ? 1 : 160, Math.ceil(stableHeight));
}
function escapeScript(value: string): string { return value.replace(/<\/script/gi, "<\\/script"); }
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function previewHead(): string { return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`; }

const THEME_VARIABLE_PREFIXES = ["--color-", "--font-", "--radius-", "--syntax-", "--diff-", "--ansi-", "--motion-"];
const PREVIEW_SETTLE_MS = 360;
const PREVIEW_RETRY_MS = 180;
const BASE_STYLE = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:18px;color:var(--color-text,#292620);background:var(--color-canvas,#f5f0e5);font:14px/1.55 var(--font-body,system-ui,-apple-system,sans-serif)}button,input,select,textarea{font:inherit}img,svg,video,canvas{max-width:100%;height:auto}`;
const EMBED_STYLE = `html,body{margin:0;padding:0;background:transparent}`;
const SCRIPT_BODY = `<main id="app"><h2>JavaScript Preview</h2><p>Use <code>document.getElementById('app')</code> to render here.</p></main>`;
const SAMPLE_BODY = `<main id="app" class="preview-root"><h2>Preview</h2><p>Typography, form controls and table styles are rendered here.</p><p><button>Button</button> <input placeholder="Input"> <select><option>Option</option></select></p><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Sample</td><td>42</td></tr></tbody></table></main>`;
