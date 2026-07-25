import type { z } from "zod";
import { ComposerRichTextPreviewRequestSchema, type ComposerRichTextPreviewResponse } from "../../shared/contracts.js";
import type { MediaArtifactStore } from "../media/MediaArtifactStore.js";
import type { PathReferenceStore } from "../security/PathReferenceStore.js";
import type { RichTextRenderService } from "./RichTextRenderService.js";
import { resolveRichTextLocalLinks } from "./richTextLocalLinks.js";

export function renderComposerRichTextPreview(
  input: z.infer<typeof ComposerRichTextPreviewRequestSchema>,
  projectPath: string,
  paths: PathReferenceStore,
  mediaStore: MediaArtifactStore,
  richText: RichTextRenderService,
): ComposerRichTextPreviewResponse {
  const resolved = paths.resolveDocument(input.document);
  const media = [
    ...mediaStore.registerPathReferences(input.scopeId, projectPath, resolved.paths),
    ...mediaStore.discoverInText(input.scopeId, projectPath, resolved.displayPrompt),
  ];
  const placements = media.flatMap((item) => item.anchor ? [{ kind: item.kind, syntax: item.syntax || "structured" as const, anchor: item.anchor }] : []);
  const rendered = richText.render(resolved.displayPrompt, "media", placements, input.policy);
  const portable = resolveRichTextLocalLinks(rendered, resolved.displayPrompt, projectPath, paths, input.policy);
  return {
    scopeId: input.scopeId,
    text: resolved.displayPrompt,
    paths: resolved.paths,
    media,
    document: portable.document,
    localLinks: portable.localLinks,
  };
}
