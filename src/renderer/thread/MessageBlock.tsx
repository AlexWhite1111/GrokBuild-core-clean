import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleHelp, Copy, Pencil, RotateCw, X } from "lucide-react";
import type { RichTextRenderPolicy, TaskMessageBlock } from "../../shared/contracts.js";
import { typographyScope } from "../../ui/core/index.js";
import { Control, MenuContent, MenuItem, MenuRoot, MenuTrigger, PathChip, Spinner, Surface } from "../../ui/components/index.js";
import { RichContent } from "./RichContent.js";
import styles from "./MessageBlock.module.css";
import { themeCandidateFromMarkdown } from "../themes/themeCandidate.js";
import { ThemeCandidateAction } from "../themes/ThemeCandidateAction.js";

export const MessageBlock = memo(function MessageBlock({ taskId, message, renderPolicy, mediaScale, onRetry, onEdit, composerHasDraft = false }: { taskId?: string; message: TaskMessageBlock; renderPolicy?: RichTextRenderPolicy; mediaScale?: number; onRetry?: (message: TaskMessageBlock) => Promise<void> | void; onEdit?: (message: TaskMessageBlock) => void; composerHasDraft?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const canEdit = message.role === "user" && message.protocol?.promptIndex != null && Boolean(onEdit);
  const theme = message.role === "assistant" && !message.streaming ? themeCandidateFromMarkdown(message.text) : null;
  const mediaPathIds = new Set(message.media?.flatMap((item) => item.pathRefId ? [item.pathRefId] : []) || []);
  const detachedPaths = message.paths?.filter((item) => !message.text.includes(item.serializedPath) && !mediaPathIds.has(item.refId || item.displayPath)) || [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(message));
      setCopied(true); window.setTimeout(() => setCopied(false), 1_200);
    } catch { setCopied(false); }
  };
  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try { await onRetry(message); } catch { /* Task page owns the visible error. */ } finally { setRetrying(false); }
  };
  return <article className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`} data-delivery={message.delivery} {...typographyScope("content")}>
    <Surface appearance={message.role === "user" ? "messageUser" : "message"} elevation="content" shape="surface" className={styles.surface}>
      <CollapsibleUserContent message={message}>
        <MessageContent taskId={taskId} message={message} renderPolicy={renderPolicy} mediaScale={mediaScale} />
        {detachedPaths.length ? <div className={styles.paths}>{detachedPaths.map((item) => <PathChip key={`${item.refId}:${item.displayPath}`} path={item} onOpen={window.grokDesktop ? () => void window.grokDesktop?.revealPath(item.refId) : undefined} />)}</div> : null}
      </CollapsibleUserContent>
    </Surface>
    {theme && <ThemeCandidateAction theme={theme} />}
    <div className={styles.messageMeta}>
      <Control recipe="icon" density="detail" onClick={() => void copy()} aria-label={t("copyMessage")} title={t("copyMessage")}>{copied ? <Check size={12} /> : <Copy size={12} />}</Control>
      {canEdit && (composerHasDraft ? <MenuRoot>
        <MenuTrigger asChild><Control recipe="icon" density="detail" aria-label={t("editMessage")} title={t("editMessage")}><Pencil size={11} /></Control></MenuTrigger>
        <MenuContent align="end" sideOffset={5}>
          <MenuItem onSelect={() => onEdit?.(message)}><Pencil size={12} />{t("replaceDraft")}</MenuItem>
          <MenuItem><X size={12} />{t("keepDraft")}</MenuItem>
        </MenuContent>
      </MenuRoot> : <Control recipe="icon" density="detail" onClick={() => onEdit?.(message)} aria-label={t("editMessage")} title={t("editMessage")}><Pencil size={11} /></Control>)}
      {message.delivery === "unknown" && <span className={styles.deliveryUnknown} role="status" aria-label={t("sendUnconfirmed")} title={t("sendUnconfirmed")}><CircleHelp size={11} /></span>}
      {message.delivery === "failed" && <span className={styles.deliveryFailed} role="status" aria-label={t("sendFailed")} title={t("sendFailed")}><CircleAlert size={11} /></span>}
      {message.delivery === "failed" && onRetry && <Control recipe="icon" density="detail" onClick={() => void retry()} disabled={retrying} aria-label={t("retrySend")} title={t("retrySend")}>{retrying ? <Spinner size="compact" /> : <RotateCw size={11} />}</Control>}
      <time className={styles.timeText} dateTime={message.createdAt} aria-label={t("messageTime", { time: time(message.createdAt) })}>{time(message.createdAt)}</time>
    </div>
  </article>;
});

function CollapsibleUserContent({ message, children }: { message: TaskMessageBlock; children: ReactNode }) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [message.blockId]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || message.role !== "user") { setOverflowing(false); return; }
    const measure = () => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.5;
      const limit = lineHeight * 10;
      element.style.setProperty("--message-collapse-height", `${limit}px`);
      setOverflowing(element.scrollHeight > limit + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.role, message.text, message.paths, message.media]);
  if (message.role !== "user") return children;
  return <>
    <div ref={content} className={styles.userContent} data-collapsed={overflowing && !expanded || undefined} data-user-message-content>{children}</div>
    {overflowing && <div className={styles.expandRow}>
      <Control recipe="icon" density="detail" onClick={() => setExpanded((value) => !value)} aria-label={t(expanded ? "collapsePreview" : "expandPreview")} aria-expanded={expanded} title={t(expanded ? "collapsePreview" : "expandPreview")}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Control>
    </div>}
  </>;
}

function MessageContent({ taskId, message, renderPolicy, mediaScale }: { taskId?: string; message: TaskMessageBlock; renderPolicy?: RichTextRenderPolicy; mediaScale?: number }) {
  return <RichContent taskId={taskId} className={styles.content} text={message.text} paths={message.paths} media={message.media} renderPolicy={renderPolicy} mediaScale={mediaScale} portable={!message.streaming} streaming={message.streaming} streamingKey={message.blockId} />;
}

function time(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function copyText(message: TaskMessageBlock): string {
  const detached = message.paths?.filter((item) => !message.text.includes(item.serializedPath));
  return [message.text, detached?.map((item) => item.serializedPath).join(" ")].filter(Boolean).join("\n\n");
}
