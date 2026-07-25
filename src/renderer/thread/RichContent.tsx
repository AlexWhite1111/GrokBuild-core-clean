import { memo } from "react";
import { DEFAULT_RICH_TEXT_RENDER_POLICY, richTextMediaPresentation, type PathReferenceSummary, type PortableRichTextDocument, type RichTextLocalLink, type RichTextRenderPolicy, type TaskMediaAttachment } from "../../shared/contracts.js";
import { MediaPathChip, MessageMedia } from "./MessageMedia.js";
import { RichText, type RichTextDensity, type RichTextFlow } from "./RichText.js";

const EMPTY_PATHS: PathReferenceSummary[] = [];
const EMPTY_MEDIA: TaskMediaAttachment[] = [];

export const RichContent = memo(function RichContent({ taskId, text, paths = EMPTY_PATHS, media = EMPTY_MEDIA, document, localLinks, renderPolicy = DEFAULT_RICH_TEXT_RENDER_POLICY, mediaScale, density = "body", flow = "block", className = "", portable = true, streaming = false, streamingKey }: {
  taskId?: string;
  text: string;
  paths?: PathReferenceSummary[];
  media?: TaskMediaAttachment[];
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
  const embeddedPathIds = new Set(paths.filter((path) => text.includes(path.serializedPath)).map((path) => path.refId || path.displayPath));
  const detached = media.filter((item) => !item.anchor && (!item.pathRefId || !embeddedPathIds.has(item.pathRefId)));
  const inlineMedia = detached.filter((item) => richTextMediaPresentation(renderPolicy, item) === "inline");
  const linkedMedia = detached.filter((item) => richTextMediaPresentation(renderPolicy, item) === "link");
  const textMedia = detached.filter((item) => richTextMediaPresentation(renderPolicy, item) === "text");
  return <>
    {text ? <RichText taskId={taskId} className={className} text={text} paths={paths} media={media} document={document} localLinks={localLinks} renderPolicy={renderPolicy} mediaScale={mediaScale} density={density} flow={flow} portable={portable} streaming={streaming} streamingKey={streamingKey} /> : null}
    {taskId && inlineMedia.length ? <MessageMedia taskId={taskId} items={inlineMedia} density={density} defaultScale={mediaScale} /> : null}
    {taskId && linkedMedia.map((item) => <span key={item.placementId}><MediaPathChip taskId={taskId} item={item} source={null} /></span>)}
    {textMedia.map((item) => <span key={item.placementId}>{item.name}</span>)}
  </>;
});
