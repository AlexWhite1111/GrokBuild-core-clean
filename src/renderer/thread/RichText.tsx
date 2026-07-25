import { Fragment, memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  richTextMediaPresentation,
  type PathReferenceSummary,
  type PortableRichTextDocument,
  type RichTextLevel,
  type RichTextLocalLink,
  type RichTextMediaPlacement,
  type RichTextRenderPolicy,
  type TaskMediaAttachment,
} from "../../shared/contracts.js";
import { parseRichTextDocument, RICH_EXECUTABLE_CODE_TAG, RICH_LIVE_HTML_TAG, RICH_STATIC_HTML_TAG } from "../../shared/richTextPipeline.js";
import { RICH_EXTERNAL_CODE_LINK_TAG, RICH_LOCAL_LINK_TAG, RICH_MEDIA_TAG, RICH_REMOTE_MEDIA_TAG } from "../../shared/richTextMedia.js";
import { usePortableRichText } from "../api/PortableRichTextContext.js";
import { PathChip } from "../../ui/components/index.js";
import { CodeBlock } from "./CodeBlock.js";
import { InlineHtml } from "./InlineHtml.js";
import { MediaPathChip, MessageMedia, RemoteMarkdownImage } from "./MessageMedia.js";
import { annotateMarkdownSourceBlocks, copySelectedMarkdown, markdownSourceRange } from "./richTextMarkdownCopy.js";
import {
  finalizeStreamingRichText,
  initialStreamingRichText,
  updateStreamingRichText,
  type StreamingRichTextState,
} from "./streamingRichText.js";
import styles from "./RichText.module.css";

type RichComponents = Partial<Components>;
const EMPTY_PATHS: PathReferenceSummary[] = [];
const EMPTY_MEDIA: TaskMediaAttachment[] = [];
const EMPTY_LOCAL_LINKS: RichTextLocalLink[] = [];

const components: RichComponents = {
  table({ node: _node, ...props }) {
    return <div className={styles.tableViewport} data-rich-table-viewport="true" data-shape="control"><table {...props} /></div>;
  },
  code({ className, children, node: _node, ...props }) {
    return <code {...props} className={`${styles.inlineCode} ${className || ""}`} data-shape="detail">{children}</code>;
  },
  mark({ node: _node, ...props }) {
    return <mark {...props} data-shape="detail" />;
  },
  kbd({ node: _node, ...props }) {
    return <kbd {...props} data-shape="control" />;
  },
  a({ href, children, node: _node, ...props }) {
    const safeHref = safeExternalHref(href);
    return safeHref ? <a {...props} data-rich-link href={safeHref} target="_blank" rel="noreferrer">{children}</a> : <span {...props}>{children}</span>;
  },
};
const inlineComponents: RichComponents = {
  ...components,
  p({ className, node: _node, ...props }) {
    return <span {...props} className={`${styles.inlineParagraph} ${className || ""}`} />;
  },
};
export type RichTextDensity = "body" | "compact";
export type RichTextFlow = "block" | "inline";

export const RichText = memo(function RichText({
  taskId,
  text,
  paths = EMPTY_PATHS,
  media = EMPTY_MEDIA,
  level = "media",
  document,
  localLinks,
  renderPolicy = DEFAULT_RICH_TEXT_RENDER_POLICY,
  mediaScale,
  density = "body",
  flow = "block",
  className = "",
  portable = true,
  streaming = false,
  streamingKey = "default",
}: {
  taskId?: string;
  text: string;
  paths?: PathReferenceSummary[];
  media?: TaskMediaAttachment[];
  level?: RichTextLevel;
  document?: PortableRichTextDocument;
  localLinks?: RichTextLocalLink[];
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
  density?: RichTextDensity;
  flow?: RichTextFlow;
  className?: string;
  portable?: boolean;
  streaming?: boolean;
  streamingKey?: string;
}) {
  const framedText = useAnimationFrameText(text, streaming, streamingKey);
  const placements = useMemo<RichTextMediaPlacement[]>(() => media.flatMap((item) => item.anchor ? [{
    kind: item.kind,
    syntax: item.syntax || "structured",
    anchor: item.anchor,
  }] : []), [media]);
  const portableResponse = usePortableRichText(framedText, level, !document && portable, taskId, placements, renderPolicy);
  const streamState = useRef<{ key: string; value: StreamingRichTextState } | null>(null);
  const fallbackDocument = useMemo(() => {
    if (document) return document;
    const policy = { level, mediaPlacements: placements, renderPolicy } as const;
    const holder = streamState.current;
    if (streaming) {
      const value = holder?.key === streamingKey
        ? updateStreamingRichText(holder.value, framedText, policy)
        : initialStreamingRichText(framedText, policy);
      streamState.current = { key: streamingKey, value };
      return value.tree;
    }
    if (holder?.key === streamingKey) {
      const value = finalizeStreamingRichText(holder.value, framedText, policy);
      streamState.current = null;
      return value.tree;
    }
    return parseRichTextDocument(framedText, policy);
  }, [document, framedText, level, placements, renderPolicy, streaming, streamingKey]);
  const baseRenderer = flow === "inline" ? inlineComponents : components;
  const responseLinks = portableResponse?.localLinks;
  const resolvedLinks = localLinks?.length ? localLinks : responseLinks?.length ? responseLinks : EMPTY_LOCAL_LINKS;
  const renderer = useMemo(() => richComponents(baseRenderer, {
    taskId,
    text: framedText,
    paths,
    media,
    localLinks: resolvedLinks,
    renderPolicy,
    mediaScale,
    density,
    streaming,
  }), [baseRenderer, density, framedText, media, mediaScale, paths, renderPolicy, resolvedLinks, streaming, taskId]);
  const richDocument = document || portableResponse?.document || fallbackDocument;
  const sourceDocument = useMemo(() => annotateMarkdownSourceBlocks(richDocument, framedText), [framedText, richDocument]);
  const markdown = useMemo(() => toJsxRuntime(sourceDocument, { Fragment, jsx, jsxs, components: renderer, passNode: true }), [renderer, sourceDocument]);
  const copyMarkdown = (event: ClipboardEvent<HTMLElement>) => copySelectedMarkdown(event, framedText);
  return <div className={`${styles.richText} ${density === "compact" ? styles.compact : ""} ${flow === "inline" ? styles.inlineFlow : ""} ${className}`} onCopy={copyMarkdown}>{markdown}</div>;
});

function useAnimationFrameText(text: string, streaming: boolean, key: string): string {
  const [frame, setFrame] = useState(() => ({ key, text }));
  const latest = useRef({ key, text });
  const request = useRef<number | null>(null);
  latest.current = { key, text };
  useEffect(() => {
    if (!streaming) {
      if (request.current != null) cancelAnimationFrame(request.current);
      request.current = null;
      return;
    }
    if (frame.key === key && frame.text === text || request.current != null) return;
    request.current = requestAnimationFrame(() => {
      request.current = null;
      setFrame(latest.current);
    });
  }, [frame.key, frame.text, key, streaming, text]);
  useEffect(() => () => {
    if (request.current != null) cancelAnimationFrame(request.current);
  }, []);
  return !streaming || frame.key !== key ? text : frame.text;
}

function richComponents(base: RichComponents, context: {
  taskId?: string;
  text: string;
  paths: PathReferenceSummary[];
  media: TaskMediaAttachment[];
  localLinks: RichTextLocalLink[];
  renderPolicy: RichTextRenderPolicy;
  mediaScale?: number;
  density: RichTextDensity;
  streaming: boolean;
}): RichComponents {
  const { taskId, text, paths, media, localLinks, renderPolicy, mediaScale, density, streaming } = context;
  const byDisplayPath = new Map(paths.map((path) => [path.displayPath, path]));
  const code: NonNullable<RichComponents["code"]> = ({ className, children, node, ...props }) => {
    const value = plainText(children);
    const path = !className ? byDisplayPath.get(value) : undefined;
    if (!path) return <code {...props} className={`${styles.inlineCode} ${className || ""}`} data-shape="detail">{children}</code>;
    const pathIdentity = path.refId || path.displayPath;
    const pathMedia = media.find((item) => item.pathRefId === pathIdentity);
    const bounds = nodeOffsets(node);
    const placementKey = bounds ? `${pathMedia?.placementId}:${bounds.start}:${bounds.end}` : pathMedia?.placementId;
    if (!taskId || !pathMedia) return <InlinePath path={path} />;
    const presentation = richTextMediaPresentation(renderPolicy, pathMedia);
    if (presentation === "inline") return <MessageMedia key={placementKey} taskId={taskId} items={[pathMedia]} sourceText={path.displayPath} density={density} defaultScale={mediaScale} />;
    if (presentation === "link") return <MediaReference taskId={taskId} item={pathMedia} source={path.displayPath} />;
    return <code {...props} className={`${styles.inlineCode} ${className || ""}`} data-shape="detail">{children}</code>;
  };
  const renderer = {
    ...base,
    pre({ node, ...props }: { node?: unknown; [key: string]: unknown }) {
      const block = codeFence(node);
      return block
        ? <CodeBlock {...block} taskId={taskId} compact={density === "compact"} streaming={streaming} markdownSource={markdownSourceRange(props)} />
        : <pre {...props} />;
    },
    code,
    [RICH_EXECUTABLE_CODE_TAG]({ source, language, node: _node }: { source?: unknown; language?: unknown; node?: unknown }) {
      return typeof source === "string" && source.trim()
        ? <CodeBlock
            language={typeof language === "string" ? language : "javascript"}
            code={source}
            taskId={taskId}
            compact={density === "compact"}
            implicit
            streaming={streaming}
            markdownSource={nodeOffsets(_node) || undefined}
          />
        : null;
    },
    [RICH_STATIC_HTML_TAG]({ source, node: _node, ...props }: { source?: unknown; node?: unknown }) {
      return typeof source === "string" && source.trim()
        ? <InlineHtml {...props} source={source} />
        : null;
    },
    [RICH_LIVE_HTML_TAG]({ source, node: _node, ...props }: { source?: unknown; node?: unknown }) {
      return typeof source === "string" && source.trim()
        ? <CodeBlock
            {...props}
            language="html"
            code={source}
            taskId={taskId}
            compact={density === "compact"}
            implicit
            streaming={streaming}
            markdownSource={nodeOffsets(_node) || undefined}
          />
        : null;
    },
    [RICH_MEDIA_TAG]({ node }: { node?: unknown }) {
      const bounds = nodeOffsets(node);
      const item = bounds ? media.find((candidate) => candidate.anchor?.start === bounds.start && candidate.anchor.end === bounds.end) : undefined;
      if (taskId && item) {
        const source = mediaSource(text, item);
        const presentation = richTextMediaPresentation(renderPolicy, item);
        if (presentation === "inline") return <MessageMedia key={item.placementId} taskId={taskId} items={[item]} sourceText={source} density={density} defaultScale={mediaScale} />;
        if (presentation === "link") return <MediaReference taskId={taskId} item={item} source={source} />;
      }
      const fallback = bounds ? text.slice(bounds.start, bounds.end) : "";
      return fallback ? <span>{fallback}</span> : null;
    },
    [RICH_LOCAL_LINK_TAG]({ node, children }: { node?: unknown; children?: ReactNode }) {
      const bounds = nodeOffsets(node);
      const link = bounds ? localLinks.find((candidate) => candidate.anchor.start === bounds.start && candidate.anchor.end === bounds.end) : undefined;
      if (!link) return <span>{children}</span>;
      if (!window.grokDesktop) return <span className={styles.localLinkUnavailable}>{children}</span>;
      return <button data-rich-link type="button" title={link.path.displayPath} onClick={() => void window.grokDesktop?.revealPath(link.path.refId)}>{children}</button>;
    },
    [RICH_EXTERNAL_CODE_LINK_TAG]({ node, children }: { node?: unknown; children?: ReactNode }) {
      const bounds = nodeOffsets(node);
      const href = safeExternalHref(bounds ? inlineCodeSource(text.slice(bounds.start, bounds.end)) : plainText(children));
      return href ? <a data-rich-link href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
    },
    [RICH_REMOTE_MEDIA_TAG]({ node, children }: { node?: unknown; children?: ReactNode }) {
      const href = safeRemoteImageHref(plainText(children));
      const bounds = nodeOffsets(node);
      if (!href) return null;
      if (!bounds || !taskId) return <a data-rich-link href={href} target="_blank" rel="noreferrer">{bounds ? remoteImageAlt(text, bounds) || href : href}</a>;
      return <RemoteMarkdownImage
        taskId={taskId}
        url={href}
        name={remoteImageAlt(text, bounds)}
        anchor={bounds}
        density={density}
        defaultScale={mediaScale}
      />;
    },
  };
  return renderer as RichComponents;
}

function MediaReference({ taskId, item, source }: { taskId: string; item: TaskMediaAttachment; source?: string }) {
  return <span className={styles.mediaReference}><MediaPathChip taskId={taskId} item={item} source={cleanMediaSource(source)} /></span>;
}

function InlinePath({ path }: { path: PathReferenceSummary }) {
  return <PathChip path={path} onOpen={window.grokDesktop ? () => void window.grokDesktop?.revealPath(path.refId) : undefined} />;
}

function plainText(children: ReactNode): string {
  return Array.isArray(children) ? children.map(plainText).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";
}

function nodeOffsets(value: unknown): { start: number; end: number } | null {
  const node = value as { position?: { start?: { offset?: unknown }; end?: { offset?: unknown } } } | undefined;
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && start >= 0 && end >= start ? { start, end } : null;
}

function mediaSource(text: string, item: TaskMediaAttachment): string | undefined {
  const start = item.anchor?.sourceStart;
  const end = item.anchor?.sourceEnd;
  return typeof start === "number" && typeof end === "number" && start >= 0 && end > start && end <= text.length ? text.slice(start, end) : undefined;
}

function cleanMediaSource(value: string | undefined): string | null {
  const source = value?.trim();
  if (!source) return null;
  return source.startsWith("`") && source.endsWith("`") ? source.slice(1, -1) : source;
}

function inlineCodeSource(value: string): string {
  const source = value.trim();
  const ticks = /^(`+)([\s\S]*?)\1$/.exec(source);
  return (ticks?.[2] || source).trim();
}

function safeExternalHref(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value, "https://grok.invalid");
    if (url.origin === "https://grok.invalid" || !["http:", "https:", "mailto:"].includes(url.protocol)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function safeRemoteImageHref(value: unknown): string | undefined {
  const href = safeExternalHref(value);
  if (!href) return undefined;
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" ? href : undefined;
  } catch {
    return undefined;
  }
}

function remoteImageAlt(text: string, bounds: { start: number; end: number }): string | undefined {
  const fragment = text.slice(bounds.start, bounds.end);
  const match = /^!\[([^\]\n]*)\]/.exec(fragment.trim());
  return match?.[1]?.trim() || undefined;
}


function codeFence(node: unknown): { language?: string; code: string } | null {
  const pre = node as { children?: Array<{ type?: string; tagName?: string; properties?: { className?: unknown }; children?: Array<{ type?: string; value?: string }> }> } | undefined;
  const code = pre?.children?.[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  const classes = Array.isArray(code.properties?.className) ? code.properties.className.map(String) : [];
  const language = classes.map((item) => /^language-(.+)$/.exec(item)?.[1]).find(Boolean);
  const value = code.children?.map((child) => child.type === "text" ? child.value || "" : "").join("") || "";
  return { ...(language ? { language } : {}), code: value.replace(/\n$/, "") };
}
