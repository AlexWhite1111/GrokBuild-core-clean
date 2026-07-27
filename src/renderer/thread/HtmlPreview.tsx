import { useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import type { PreviewPrepareResponse } from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import { THEME_APPLIED_EVENT } from "../../ui/theme/index.js";
import styles from "./CodeBlock.module.css";
import { CodeScrollRegion } from "./CodeScrollRegion.js";
import { scrollThreadByWheel } from "./threadScroll.js";

type PreparedPreview =
  | { kind: "loading" }
  | { kind: "url"; value: string }
  | { kind: "failed" };

export function HtmlPreview({
  api,
  language,
  source,
  taskId,
  detail = false,
  embedded = false,
  className,
  style: suppliedStyle,
  ...props
}: {
  api: ApiClient;
  language: string;
  source: string;
  taskId?: string;
  detail?: boolean;
  embedded?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const visible = useRef(true);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [contentHeight, setContentHeight] = useState(() => initialPreviewHeight(embedded));
  const [prepared, setPrepared] = useState<PreparedPreview>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    const request = new AbortController();
    setConsoleLines([]);
    setContentHeight(initialPreviewHeight(embedded));
    const prepare = async () => {
      setPrepared({ kind: "loading" });
      let response: PreviewPrepareResponse;
      try {
        response = await api.post<PreviewPrepareResponse>("/preview/prepare", { language, source, embedded, ...(taskId ? { taskId } : {}) }, request.signal);
      } catch (firstError) {
        if (!current || request.signal.aborted) return;
        if (!isTransportFailure(firstError)) {
          setConsoleLines([`preview: ${firstError instanceof Error ? firstError.message : String(firstError)}`]);
          setPrepared({ kind: "failed" });
          return;
        }
        await delay(PREVIEW_RETRY_MS);
        if (!current || request.signal.aborted) return;
        try {
          response = await api.post<PreviewPrepareResponse>("/preview/prepare", { language, source, embedded, ...(taskId ? { taskId } : {}) }, request.signal);
        } catch (secondError) {
          if (!current || request.signal.aborted) return;
          setConsoleLines([`preview: ${secondError instanceof Error ? secondError.message : String(secondError)}`]);
          setPrepared({ kind: "failed" });
          return;
        }
      }
      if (!current) return;
      const url = new URL(response.path, new URL(api.bootstrap.apiBaseUrl).origin);
      url.searchParams.set("instance", id);
      url.searchParams.set("detail", detail ? "1" : "0");
      setPrepared({ kind: "url", value: url.toString() });
    };
    const timer = window.setTimeout(() => void prepare(), PREVIEW_SETTLE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
      request.abort();
    };
  }, [api, detail, embedded, id, language, source, taskId]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || !isPreviewMessage(event.data, id)) return;
      if (event.data.type === "console") setConsoleLines((lines) => [...lines.slice(-99), event.data.value]);
      else if (event.data.type === "resize" && !detail) setContentHeight(normalizePreviewHeight(event.data.value, embedded));
      else if (event.data.type === "ready") syncFrame(iframe.current, id, visible.current);
      else if (event.data.type === "thread-wheel" && !detail) {
        scrollThreadByWheel(iframe.current, event.data.value);
      }
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
    {prepared.kind === "loading" && <div className={styles.previewLoading} />}
    {prepared.kind === "url" && <iframe
          ref={iframe}
          title="HTML preview"
          sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
          allow="autoplay; clipboard-read; clipboard-write; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={() => syncFrame(iframe.current, id, visible.current)}
          src={prepared.value}
        />}
    {consoleLines.length > 0 && <CodeScrollRegion data-copy-rendered className={styles.previewConsole}>{consoleLines.join("\n")}</CodeScrollRegion>}
  </div>;
}

type PreviewSize = { height: number; viewport: number };

type PreviewMessage =
  | { channel: "grok-build-preview"; id: string; type: "console"; value: string }
  | { channel: "grok-build-preview"; id: string; type: "resize"; value: number | PreviewSize }
  | { channel: "grok-build-preview"; id: string; type: "ready"; value: unknown }
  | { channel: "grok-build-preview"; id: string; type: "thread-wheel"; value: { deltaY: number; deltaMode: number } };

function isPreviewMessage(value: unknown, id: string): value is PreviewMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== "grok-build-preview" || message.id !== id) return false;
  return message.type === "console" && typeof message.value === "string"
    || message.type === "resize" && isPreviewSize(message.value)
    || message.type === "ready"
    || message.type === "thread-wheel"
      && isThreadWheel(message.value);
}

function isPreviewSize(value: unknown): value is number | PreviewSize {
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  const size = value as Record<string, unknown>;
  return typeof size.height === "number" && Number.isFinite(size.height)
    && typeof size.viewport === "number" && Number.isFinite(size.viewport);
}

function isThreadWheel(value: unknown): value is { deltaY: number; deltaMode: number } {
  if (!value || typeof value !== "object") return false;
  const wheel = value as Record<string, unknown>;
  return typeof wheel.deltaY === "number" && typeof wheel.deltaMode === "number";
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

function initialPreviewHeight(embedded = false): number { return embedded ? 1 : 160; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
function isTransportFailure(error: unknown): boolean { return error instanceof TypeError && /fetch|network|load/i.test(error.message); }
function normalizePreviewHeight(value: number | PreviewSize, embedded = false): number {
  const height = typeof value === "number" ? value : value.height;
  return Math.max(embedded ? 1 : 160, Math.ceil(height));
}

const THEME_VARIABLE_PREFIXES = ["--color-", "--font-", "--radius-", "--syntax-", "--diff-", "--ansi-", "--motion-"];
const PREVIEW_SETTLE_MS = 360;
const PREVIEW_RETRY_MS = 180;
