import type { Root } from "hast";
import { z } from "zod";
import { ComposerInputDocumentSchema, type PathReferenceSummary, type TaskMediaAttachment } from "./task.js";

const RichTextLevelSchema = z.enum(["safe", "media"]);
export type RichTextLevel = z.infer<typeof RichTextLevelSchema>;

export const MEDIA_PREVIEW_SCALE_MIN = 5;
export const MEDIA_PREVIEW_SCALE_MAX = 200;

const MediaPresentationSchema = z.enum(["inline", "link", "text"]);
export type MediaPresentation = z.infer<typeof MediaPresentationSchema>;
const ReferencePresentationSchema = z.enum(["link", "text"]);

export const DEFAULT_RICH_TEXT_RENDER_POLICY = {
  version: 2,
  recognition: {
    localMarkdownLinks: true,
    localMarkdownMedia: true,
    localBarePaths: true,
    localInlineCodePaths: true,
    webInlineCodeUrls: true,
    remoteMarkdownImages: true,
  },
  presentation: {
    nativeMedia: { image: "inline", video: "inline", audio: "inline" },
    localMedia: { image: "inline", video: "inline", audio: "inline" },
    localMarkdownLinks: "link",
    localBarePaths: "link",
    localInlineCodePaths: "link",
    webInlineCodeUrls: "link",
    remoteMarkdownImages: "inline",
  },
} as const;

const LegacyRichTextRenderPolicySchema = z.object({
  version: z.literal(1),
  structuredMedia: z.object({
    image: MediaPresentationSchema,
    video: MediaPresentationSchema,
    audio: MediaPresentationSchema,
  }),
  localReferences: z.object({
    explicitMarkdown: z.boolean(),
    bareStandalone: z.boolean(),
    fallbackLink: z.boolean(),
  }),
  remoteMedia: z.enum(["link", "text"]),
});

const RichTextRenderPolicyV2Schema = z.object({
  version: z.literal(2),
  recognition: z.object({
    localMarkdownLinks: z.boolean(),
    localMarkdownMedia: z.boolean(),
    localBarePaths: z.boolean(),
    localInlineCodePaths: z.boolean(),
    webInlineCodeUrls: z.boolean(),
    remoteMarkdownImages: z.boolean(),
  }),
  presentation: z.object({
    nativeMedia: z.object({ image: MediaPresentationSchema, video: MediaPresentationSchema, audio: MediaPresentationSchema }),
    localMedia: z.object({ image: MediaPresentationSchema, video: MediaPresentationSchema, audio: MediaPresentationSchema }),
    localMarkdownLinks: ReferencePresentationSchema,
    localBarePaths: ReferencePresentationSchema,
    localInlineCodePaths: ReferencePresentationSchema,
    webInlineCodeUrls: ReferencePresentationSchema,
    remoteMarkdownImages: MediaPresentationSchema,
  }),
});

/** Reads legacy preferences once and projects only the field-level V2 contract. */
export const RichTextRenderPolicySchema = z.union([RichTextRenderPolicyV2Schema, LegacyRichTextRenderPolicySchema]).transform((policy) => {
  if (policy.version === 2) return policy;
  const markdownLinks = policy.localReferences.explicitMarkdown;
  const barePaths = policy.localReferences.bareStandalone;
  return RichTextRenderPolicyV2Schema.parse({
    ...DEFAULT_RICH_TEXT_RENDER_POLICY,
    recognition: {
      ...DEFAULT_RICH_TEXT_RENDER_POLICY.recognition,
      localMarkdownLinks: markdownLinks,
      localMarkdownMedia: markdownLinks,
      localBarePaths: barePaths,
    },
    presentation: {
      ...DEFAULT_RICH_TEXT_RENDER_POLICY.presentation,
      nativeMedia: policy.structuredMedia,
      localMedia: policy.structuredMedia,
      localMarkdownLinks: policy.localReferences.fallbackLink && markdownLinks ? "link" : "text",
      localBarePaths: policy.localReferences.fallbackLink && barePaths ? "link" : "text",
      remoteMarkdownImages: policy.remoteMedia === "text" ? "text" : "inline",
    },
  });
});
export type RichTextRenderPolicy = z.infer<typeof RichTextRenderPolicyV2Schema>;

export function richTextMediaPresentation(policy: RichTextRenderPolicy, item: Pick<TaskMediaAttachment, "source" | "kind">): MediaPresentation {
  if (item.source === "acp") return policy.presentation.nativeMedia[item.kind];
  if (item.source === "remote") return policy.presentation.remoteMarkdownImages;
  return policy.presentation.localMedia[item.kind];
}

const RichTextAnchorSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sourceStart: z.number().int().nonnegative().optional(),
  sourceEnd: z.number().int().positive().optional(),
}).refine((value) => value.end > value.start, "Rich-text anchor must have positive length.");

const RichTextMediaPlacementSchema = z.object({
  kind: z.enum(["image", "audio", "video"]),
  syntax: z.enum(["explicit", "bare", "structured"]).default("structured"),
  anchor: RichTextAnchorSchema,
});
export type RichTextMediaPlacement = z.infer<typeof RichTextMediaPlacementSchema>;

export interface RichTextLocalLink {
  path: PathReferenceSummary;
  anchor: { start: number; end: number };
  syntax: "markdown" | "bare" | "code";
}

export const RichTextRenderRequestSchema = z.object({
  text: z.string().max(200_000),
  level: RichTextLevelSchema.default("media"),
  taskId: z.string().uuid().optional(),
  placements: z.array(RichTextMediaPlacementSchema).max(1_024).default([]),
  policy: RichTextRenderPolicySchema.default(DEFAULT_RICH_TEXT_RENDER_POLICY),
});

export const ComposerRichTextPreviewRequestSchema = z.object({
  requestId: z.string().uuid(),
  scopeId: z.string().uuid(),
  projectId: z.string().min(1).max(128),
  document: ComposerInputDocumentSchema,
  policy: RichTextRenderPolicySchema.default(DEFAULT_RICH_TEXT_RENDER_POLICY),
});

export const RemoteMarkdownImageRequestSchema = z.object({
  requestId: z.string().uuid(),
  url: z.string().url().max(8_192),
  name: z.string().trim().min(1).max(512).optional(),
  anchor: RichTextAnchorSchema,
});

export type PortableRichTextDocument = Root;

export interface RichTextRenderResponse {
  document: PortableRichTextDocument;
  localLinks: RichTextLocalLink[];
}

export interface ComposerRichTextPreviewResponse extends RichTextRenderResponse {
  scopeId: string;
  text: string;
  paths: PathReferenceSummary[];
  media: TaskMediaAttachment[];
}
