import { ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ComposerRichTextPreviewResponse } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { Control, PathChip, UiIcon } from "../../ui/components/index.js";
import { MediaPathChip, MessageMedia } from "../thread/MessageMedia.js";
import type { ContextResourceItem } from "./contextProjection.js";
import styles from "./ContextResourceView.module.css";

export function ContextResourceView({ item, taskId, projectId, removable, onRemove }: {
  item: ContextResourceItem;
  taskId: string;
  projectId: string;
  removable: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const previewable = Boolean(item.media || item.path && ["image", "media"].includes(item.path.kind));
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<ComposerRichTextPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const scopeId = useMemo(() => crypto.randomUUID(), [item.id]);

  useEffect(() => {
    if (!expanded || item.media || !item.path || preview || previewError) return;
    let current = true;
    void api.post<ComposerRichTextPreviewResponse>("/render/composer-preview", {
      requestId: crypto.randomUUID(),
      scopeId,
      projectId,
      document: { version: 1, nodes: [{ type: "path", refId: item.path.refId }] },
    }).then((value) => { if (current) setPreview(value); })
      .catch((cause) => { if (current) setPreviewError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [api, expanded, item.media, item.path, preview, previewError, projectId, scopeId]);

  const media = item.media ? [item.media] : preview?.media || [];
  const mediaScope = item.media ? taskId : scopeId;

  return <div className={styles.resource} data-expanded={expanded || undefined} data-invalid={!item.valid || undefined}>
    <div className={styles.row}>
      {item.media
        ? <MediaPathChip taskId={taskId} item={item.media} path={item.path} source={null} label={item.name} />
        : item.path
          ? <PathChip path={item.path} label={item.name} title={item.detail} onOpen={() => reveal(item, taskId)} />
          : null}
      {previewable && <Control recipe="icon" density="compact" className={styles.disclosure} onClick={() => setExpanded((value) => !value)} aria-label={expanded ? t("collapsePreview") : t("expandPreview")}><UiIcon source={ChevronDown} size="detail" /></Control>}
      {removable && <Control recipe="icon" density="compact" className={styles.remove} onClick={onRemove} aria-label={t("removeResource")}><UiIcon source={X} size="detail" /></Control>}
    </div>
    {expanded && <div className={styles.preview}>
      {media.length > 0 ? <MessageMedia taskId={mediaScope} items={media} sourceText={item.path?.displayPath} density="compact" />
        : previewError ? <small>{previewError}</small>
          : <small>{t("mediaLoading")}</small>}
    </div>}
  </div>;
}

function reveal(item: ContextResourceItem, taskId: string): void {
  if (item.path?.refId) void window.grokDesktop?.revealPath(item.path.refId);
  else if (item.media?.mediaId) void window.grokDesktop?.revealMedia(taskId, item.media.mediaId);
}
