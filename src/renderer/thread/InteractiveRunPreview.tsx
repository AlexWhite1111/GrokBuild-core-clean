import { useEffect, useMemo, useRef } from "react";
import type { LocalRunSnapshot } from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import { THEME_APPLIED_EVENT } from "../../ui/theme/index.js";
import { previewThemeSnapshot } from "./HtmlPreview.js";
import styles from "./CodeBlock.module.css";

export function InteractiveRunPreview({ api, snapshot, figureId, detail = false }: {
  api: ApiClient;
  snapshot: LocalRunSnapshot;
  figureId: number;
  detail?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = useMemo(() => {
    const path = snapshot.interactive?.path;
    if (!path) return "";
    const value = new URL(path, new URL(api.bootstrap.apiBaseUrl).origin);
    value.searchParams.set("figure", String(figureId));
    if (detail) value.searchParams.set("detail", "1");
    return value.toString();
  }, [api.bootstrap.apiBaseUrl, detail, figureId, snapshot.interactive?.path]);

  useEffect(() => {
    const publishTheme = () => frame.current?.contentWindow?.postMessage({
      channel: "grok-build-interactive-control",
      type: "theme",
      ...previewThemeSnapshot(),
    }, "*");
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { channel?: string; runId?: string; type?: string } | null;
      if (message?.channel !== "grok-build-interactive" || message.runId !== snapshot.runId) return;
      if (message.type === "ready") { publishTheme(); return; }
    };
    window.addEventListener("message", receive);
    window.addEventListener(THEME_APPLIED_EVENT, publishTheme);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener(THEME_APPLIED_EVENT, publishTheme);
    };
  }, [api.bootstrap.apiBaseUrl, snapshot.runId]);

  if (!url) return null;
  return <div className={styles.interactivePreview} data-detail={detail || undefined}>
    <iframe
      ref={frame}
      src={url}
      title={`Matplotlib figure ${figureId}`}
      sandbox="allow-downloads allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts"
      allow="autoplay; clipboard-read; clipboard-write; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="no-referrer"
      onLoad={() => frame.current?.contentWindow?.postMessage({
        channel: "grok-build-interactive-control",
        type: "theme",
        ...previewThemeSnapshot(),
      }, "*")}
    />
  </div>;
}
