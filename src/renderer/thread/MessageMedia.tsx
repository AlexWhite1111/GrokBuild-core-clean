import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PathReferenceSummary, TaskMediaAttachment, TaskMediaLease, UiPreferences } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { Control, Notice, PathChip, Spinner, Surface } from "../../ui/components/index.js";
import { PreviewShell } from "./PreviewShell.js";
import { VisualCanvas, VisualCanvasControls, useVisualCanvasController } from "./VisualCanvas.js";
import { useInlineMediaSizing } from "./useInlineMediaSizing.js";
import styles from "./MessageMedia.module.css";

const mediaWidths = new Map<string, number>();
const mediaAspects = new Map<string, string>();
const MAX_GEOMETRY_ENTRIES = 512;
const IMAGE_SINGLE_CLICK_DELAY_MS = 300;

function useMediaLease(taskId: string, mediaId: string) {
  const { api } = useBootstrap();
  return useQuery({
    queryKey: ["media-lease", taskId, mediaId],
    queryFn: () => api.post<TaskMediaLease>(`/media-scopes/${taskId}/${mediaId}/lease`, { requestId: crypto.randomUUID() }),
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function MessageMedia({ taskId, items, sourceText, density = "body", defaultScale }: {
  taskId: string;
  items: TaskMediaAttachment[];
  sourceText?: string;
  density?: "body" | "compact";
  defaultScale?: number;
}) {
  const queryClient = useQueryClient();
  const preferences = queryClient.getQueryData<UiPreferences>(["ui-preferences"]);
  const preferredScale = defaultScale ?? preferences?.mediaPreviewScale ?? 70;
  const initialSize = preferences?.mediaInitialSize ?? "native";
  const minimumSize = preferences?.mediaMinimumSize ?? 64;
  if (!items.length) return null;
  return <span data-message-media className={`${styles.collection} ${density === "compact" ? styles.compact : ""}`}>
    {items.map((item) => <StableMediaItem key={item.placementId} taskId={taskId} item={item} sourceText={sourceText} defaultScale={preferredScale} initialSize={initialSize} minimumSize={minimumSize} />)}
  </span>;
}

export function RemoteMarkdownImage({ taskId, url, name, anchor, density = "body", defaultScale }: {
  taskId: string;
  url: string;
  name?: string;
  anchor: { start: number; end: number };
  density?: "body" | "compact";
  defaultScale?: number;
}) {
  const { api } = useBootstrap();
  const remote = useQuery({
    queryKey: ["remote-markdown-image", taskId, url, anchor.start, anchor.end],
    queryFn: () => api.post<{ media: TaskMediaAttachment }>(`/media-scopes/${taskId}/remote-image`, {
      requestId: crypto.randomUUID(), url, ...(name ? { name } : {}), anchor,
    }),
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (remote.isPending) return <Surface as="span" appearance="muted" shape="surface" className={styles.loading} aria-label={name || url}><Spinner size="compact" /></Surface>;
  if (!remote.data) return <a data-rich-link className={styles.remoteFallback} href={url} target="_blank" rel="noreferrer">{name || url}</a>;
  return <MessageMedia taskId={taskId} items={[remote.data.media]} sourceText={url} density={density} defaultScale={defaultScale} />;
}

const StableMediaItem = memo(function MediaItem({ taskId, item, sourceText, defaultScale, initialSize, minimumSize }: {
  taskId: string;
  item: TaskMediaAttachment;
  sourceText?: string;
  defaultScale: number;
  initialSize: UiPreferences["mediaInitialSize"];
  minimumSize: number;
}) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const geometryKey = `${item.mediaId}:${item.placementId}`;
  const [inlineWidth, setInlineWidth] = useState<number | null>(() => mediaWidths.get(geometryKey) ?? null);
  const setWidth = useCallback((width: number) => {
    remember(mediaWidths, geometryKey, width);
    setInlineWidth(width);
  }, [geometryKey]);
  const lease = useMediaLease(taskId, item.mediaId);
  if (lease.isPending) return <Surface as="span" appearance="muted" shape="surface" className={styles.loading} aria-label={t("mediaLoading")}><Spinner size="compact" /></Surface>;
  if (lease.isError || !lease.data) return <Notice tone="danger" density="compact" role="alert" className={styles.error}><span>{t("mediaUnavailable")}</span><Control recipe="quiet" density="compact" onClick={() => void lease.refetch()}><RefreshCw size={13} />{t("retry")}</Control></Notice>;

  const url = api.mediaUrl(lease.data.ticket);
  const source = cleanSource(sourceText);
  const revealSource = item.source !== "remote" && window.grokDesktop ? () => {
    if (lease.data.path?.refId) void window.grokDesktop?.revealPath(lease.data.path.refId);
    else if (item.pathRefId) void window.grokDesktop?.revealPath(item.pathRefId);
    else void window.grokDesktop?.revealMedia(taskId, item.mediaId);
  } : undefined;
  const caption = { taskId, item, path: lease.data.path, source, onOpenSource: revealSource };

  if (item.kind === "image") return <ImageMedia
    item={item}
    geometryKey={geometryKey}
    url={url}
    width={inlineWidth}
    defaultScale={defaultScale}
    initialSize={initialSize}
    minimumSize={minimumSize}
    onWidthChange={setWidth}
    caption={caption}
  />;

  if (item.kind === "video") return <VideoMedia item={item} geometryKey={geometryKey} url={url} width={inlineWidth} onWidthChange={setWidth} caption={caption} />;

  return <Surface as="span" appearance="muted" elevation="content" shape="surface" data-message-media-item data-media-id={item.mediaId} className={`${styles.figure} ${styles.audio}`}>
    <audio controls preload="metadata" src={url} />
    <MediaCaption {...caption} />
  </Surface>;
});

function VideoMedia({ item, geometryKey, url, width, onWidthChange, caption }: {
  item: TaskMediaAttachment;
  geometryKey: string;
  url: string;
  width: number | null;
  onWidthChange: (width: number) => void;
  caption: MediaCaptionProps;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  usePauseOutsideThread(videoRef);
  const sizing = useInlineMediaSizing(width, 70, "comfortable", 64, onWidthChange);
  const cachedAspect = mediaAspects.get(geometryKey);
  return <Surface as="span" appearance="muted" elevation="content" shape="surface" data-message-media-item data-media-id={item.mediaId} elementRef={sizing.setFigure} className={`${styles.figure} ${styles.video} ${styles.inlineResizable}`} style={{ width: `${sizing.width * 100}%` }}>
    <video
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      src={url}
      style={cachedAspect ? { "--media-aspect": cachedAspect } as CSSProperties : undefined}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (!video.videoWidth || !video.videoHeight) return;
        const aspect = `${video.videoWidth} / ${video.videoHeight}`;
        remember(mediaAspects, geometryKey, aspect);
        if (video.style.getPropertyValue("--media-aspect") !== aspect) video.style.setProperty("--media-aspect", aspect);
        sizing.fit(video.videoWidth, video.videoHeight);
      }}
    />
    <MediaCaption {...caption} />
  </Surface>;
}

function usePauseOutsideThread(videoRef: { current: HTMLVideoElement | null }): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const root = video.closest<HTMLElement>("[data-thread-scroll]");
    const observer = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting && !video.paused) video.pause();
    }, { root, threshold: 0 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoRef]);
}

function ImageMedia({ item, geometryKey, url, width, defaultScale, initialSize, minimumSize, onWidthChange, caption }: {
  item: TaskMediaAttachment;
  geometryKey: string;
  url: string;
  width: number | null;
  defaultScale: number;
  initialSize: UiPreferences["mediaInitialSize"];
  minimumSize: number;
  onWidthChange: (width: number) => void;
  caption: MediaCaptionProps;
}) {
  const { t } = useTranslation();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const singleClickTimer = useRef<number | null>(null);
  const sizing = useInlineMediaSizing(width, defaultScale, initialSize, minimumSize, onWidthChange);
  const cachedAspect = mediaAspects.get(geometryKey);
  useEffect(() => () => {
    if (singleClickTimer.current !== null) window.clearTimeout(singleClickTimer.current);
  }, []);
  const cancelSingleClick = () => {
    if (singleClickTimer.current === null) return;
    window.clearTimeout(singleClickTimer.current);
    singleClickTimer.current = null;
  };
  return <>
    <Surface
      as="span"
      appearance="muted"
      elevation="content"
      shape="surface"
      data-message-media-item
      data-media-id={item.mediaId}
      elementRef={sizing.setFigure}
      onWheel={sizing.pinchZoom}
      className={`${styles.figure} ${styles.inlineResizable}`}
      style={{ width: `${sizing.width * 100}%` }}
    >
        <Control
          recipe="text"
          hover="none"
          shape="none"
          className={styles.imageButton}
          style={cachedAspect ? { "--media-aspect": cachedAspect } as CSSProperties : undefined}
          data-sized={cachedAspect ? "true" : undefined}
          aria-label={t("openImage", { name: item.name })}
          onClick={(event) => {
            if (event.detail === 0) { setLightboxOpen(true); return; }
            cancelSingleClick();
            singleClickTimer.current = window.setTimeout(() => {
              singleClickTimer.current = null;
              setLightboxOpen(true);
            }, IMAGE_SINGLE_CLICK_DELAY_MS);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelSingleClick();
            sizing.cycleSize();
          }}
        >
          <img src={url} alt={item.name} decoding="async" onLoad={(event) => {
            const image = event.currentTarget;
            if (!image.naturalWidth || !image.naturalHeight) return;
            const aspect = `${image.naturalWidth} / ${image.naturalHeight}`;
            remember(mediaAspects, geometryKey, aspect);
            const button = image.parentElement;
            if (button) {
              button.dataset.sized = "true";
              button.style.setProperty("--media-aspect", aspect);
            }
            sizing.fit(image.naturalWidth, image.naturalHeight);
          }} />
        </Control>
      <MediaCaption {...caption} />
    </Surface>
    <ZoomableImage open={lightboxOpen} onOpenChange={setLightboxOpen} src={url} alt={item.name} sourceChip={<MediaPathChip {...caption} />} />
  </>;
}

function ZoomableImage({ open, onOpenChange, src, alt, sourceChip }: { open: boolean; onOpenChange: (open: boolean) => void; src: string; alt: string; sourceChip: ReactNode }) {
  const controller = useVisualCanvasController("fit");
  const [natural, setNatural] = useState({ width: 1600, height: 900 });
  return <PreviewShell open={open} onOpenChange={onOpenChange} accessibleTitle={alt} actions={<VisualCanvasControls controller={controller} tone="inverse" />} bottomStart={sourceChip} tone="inverse" contentClassName={styles.lightboxBody}>
    <VisualCanvas ariaLabel={alt} className={styles.zoomStage} contentClassName={styles.zoomContent} controller={controller} naturalWidth={natural.width} naturalHeight={natural.height} detail>
      <img className={styles.zoomImage} src={src} alt={alt} draggable={false} onLoad={(event) => {
        const image = event.currentTarget;
        if (image.naturalWidth && image.naturalHeight) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
      }} />
    </VisualCanvas>
  </PreviewShell>;
}

interface MediaCaptionProps {
  taskId: string;
  item: TaskMediaAttachment;
  path?: PathReferenceSummary;
  source: string | null;
  onOpenSource?: () => void;
}

function MediaCaption({ taskId, item, path, source, onOpenSource }: MediaCaptionProps) {
  return <span className={styles.caption}>
    <MediaPathChip taskId={taskId} item={item} path={path} source={source} onOpenSource={onOpenSource} />
  </span>;
}

export function MediaPathChip(props: MediaCaptionProps & { label?: string }) {
  if (props.item.source === "remote" && props.source) return <RemoteMediaSource href={props.source} label={props.label} />;
  return <LeasedMediaPathChip {...props} />;
}

function RemoteMediaSource({ href, label }: { href: string; label?: string }) {
  return <a data-rich-link className={styles.remoteSource} href={href} target="_blank" rel="noreferrer" title={href}>{label || href}</a>;
}

function LeasedMediaPathChip(props: MediaCaptionProps & { label?: string }) {
  const lease = useMediaLease(props.taskId, props.item.mediaId);
  const path = lease.data?.path || props.path;
  const onOpenSource = path?.valid && window.grokDesktop
    ? () => void window.grokDesktop?.revealPath(path.refId)
    : props.onOpenSource;
  return <ResolvedMediaPathChip {...props} path={path} onOpenSource={onOpenSource} />;
}

function ResolvedMediaPathChip({ item, path: registered, source, onOpenSource }: MediaCaptionProps & { label?: string }) {
  const displayPath = source || item.name;
  const fallback: PathReferenceSummary = {
    refId: item.pathRefId || item.mediaId,
    name: item.name,
    displayPath,
    serializedPath: `\`${displayPath.replaceAll("`", "\\`")}\``,
    sizeBytes: item.sizeBytes,
    kind: item.kind === "image" ? "image" : "media",
    withinProject: !displayPath.startsWith("/") && !/^[a-z]:[\\/]/i.test(displayPath),
    valid: false,
    isDirectory: false,
  };
  const path = registered || fallback;
  return <PathChip
    path={path}
    onOpen={path.valid ? onOpenSource : undefined}
  />;
}

function cleanSource(source: string | undefined): string | null {
  const value = source?.trim();
  if (!value) return null;
  if (value.length >= 2 && value.startsWith("`") && value.endsWith("`")) return value.slice(1, -1);
  return value;
}

function remember<T>(target: Map<string, T>, key: string, value: T): void {
  target.delete(key);
  target.set(key, value);
  if (target.size > MAX_GEOMETRY_ENTRIES) target.delete(target.keys().next().value!);
}
