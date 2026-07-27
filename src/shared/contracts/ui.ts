import { z } from "zod";
import { NewTaskDraftKeySchema, PathReferenceSummarySchema } from "./task.js";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  MEDIA_PREVIEW_SCALE_MAX,
  MEDIA_PREVIEW_SCALE_MIN,
  RichTextRenderPolicySchema,
} from "./richText.js";
import {
  CORNER_RADIUS_DEFAULT,
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_MIN,
  cornerRadiusFromLegacyScale,
} from "../themeGeometry.js";

export const FONT_WEIGHT_DEFAULT = 450;
export const FONT_WEIGHT_MIN = 300;
export const FONT_WEIGHT_MAX = 700;
const STREAMING_FRAME_INTERVAL_DEFAULT = 50;
const STREAMING_FRAME_INTERVAL_MIN = 17;
const STREAMING_FRAME_INTERVAL_MAX = 1_000;
export const STREAMING_FRAME_INTERVAL_STEPS = [
  1_000,
  750,
  500,
  333,
  250,
  200,
  150,
  100,
  67,
  50,
  40,
  33,
  25,
  20,
  17,
] as const;

export const DEFAULT_CODE_PREVIEW_POLICY = {
  interactive: true,
  languages: {
    html: true,
    css: true,
    javascript: true,
    typescript: true,
  },
} as const;

const CodePreviewPolicySchema = z.object({
  interactive: z.boolean(),
  languages: z.object({
    html: z.boolean(),
    css: z.boolean(),
    javascript: z.boolean(),
    typescript: z.boolean(),
  }),
});
export type CodePreviewPolicy = z.infer<typeof CodePreviewPolicySchema>;

export const SavedContextResourceSchema = z.object({
  path: PathReferenceSummarySchema,
  addedAt: z.string().datetime(),
});
export type SavedContextResource = z.infer<typeof SavedContextResourceSchema>;

const UiPreferencesObjectSchema = z.object({
  sidebarOpen: z.boolean(),
  sidebarWidth: z.number().int().min(216).max(360).default(252),
  lastRoute: z.string().regex(/^\/(?:new|tasks\/[0-9a-f-]{36})$/i).default("/new"),
  readingWidth: z.union([z.literal(0), z.number().int().min(640).max(1600)]),
  readingWidthCustom: z.number().int().min(640).max(1600).default(800),
  timestamps: z.enum(["hover", "always"]),
  layoutScale: z.number().int().min(70).max(140).default(100),
  lineSpacing: z.number().int().min(80).max(160).default(100),
  letterSpacing: z.number().int().min(-8).max(20).default(0),
  grokMessagePresentation: z.enum(["document", "bubble"]).default("document"),
  fontScale: z.number().int().min(70).max(180).default(100),
  fontWeight: z.number().int().min(FONT_WEIGHT_MIN).max(FONT_WEIGHT_MAX).default(FONT_WEIGHT_DEFAULT),
  fontFamilyScope: z.enum(["global", "conversation", "content"]).default("global"),
  cornerRadius: z.number().int().min(CORNER_RADIUS_MIN).max(CORNER_RADIUS_MAX).default(CORNER_RADIUS_DEFAULT),
  sendShortcut: z.enum(["enter", "commandEnter"]).default("enter"),
  mediaPreviewScale: z.number().int().min(MEDIA_PREVIEW_SCALE_MIN).max(MEDIA_PREVIEW_SCALE_MAX).default(70),
  mediaInitialSize: z.enum(["native", "smaller", "larger", "comfortable"]).default("native"),
  mediaMinimumSize: z.number().int().min(48).max(240).default(64),
  locale: z.enum(["zh-CN", "en-US"]),
  contextWidth: z.number().int().min(280).max(520).default(380),
  showContextUsage: z.boolean().default(true),
  collapseWorkProcessByDefault: z.boolean().default(true),
  streamingFrameIntervalMs: z.number().int()
    .min(STREAMING_FRAME_INTERVAL_MIN)
    .max(STREAMING_FRAME_INTERVAL_MAX)
    .default(STREAMING_FRAME_INTERVAL_DEFAULT),
  codePreview: CodePreviewPolicySchema.default(DEFAULT_CODE_PREVIEW_POLICY),
  richTextRenderPolicy: RichTextRenderPolicySchema.default(DEFAULT_RICH_TEXT_RENDER_POLICY),
});
export const UiPreferencesSchema = z.preprocess(
  migrateLegacyUiPreferences,
  UiPreferencesObjectSchema,
);
export type UiPreferences = z.infer<typeof UiPreferencesSchema>;

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  sidebarOpen: true,
  sidebarWidth: 252,
  lastRoute: "/new",
  readingWidth: 800,
  readingWidthCustom: 800,
  timestamps: "hover",
  layoutScale: 100,
  lineSpacing: 100,
  letterSpacing: 0,
  grokMessagePresentation: "document",
  fontScale: 100,
  fontWeight: FONT_WEIGHT_DEFAULT,
  fontFamilyScope: "global",
  cornerRadius: CORNER_RADIUS_DEFAULT,
  sendShortcut: "enter",
  mediaPreviewScale: 70,
  mediaInitialSize: "native",
  mediaMinimumSize: 64,
  locale: "zh-CN",
  contextWidth: 380,
  showContextUsage: true,
  collapseWorkProcessByDefault: true,
  streamingFrameIntervalMs: STREAMING_FRAME_INTERVAL_DEFAULT,
  codePreview: DEFAULT_CODE_PREVIEW_POLICY,
  richTextRenderPolicy: DEFAULT_RICH_TEXT_RENDER_POLICY,
};

export const UiPreferencesMutationSchema = z.object({
  requestId: z.string().uuid(),
  preferences: UiPreferencesSchema,
});

function migrateLegacyUiPreferences(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const current = value as Record<string, unknown>;
  const migrated: Record<string, unknown> = { ...current };
  let changed = false;
  if (current.cornerRadius === undefined && current.cornerScale !== undefined) {
    migrated.cornerRadius = cornerRadiusFromLegacyScale(current.cornerScale);
    delete migrated.cornerScale;
    changed = true;
  }
  if (
    current.streamingFrameIntervalMs === undefined
    && current.streamingRefreshHz !== undefined
  ) {
    migrated.streamingFrameIntervalMs = frameIntervalFromLegacyRefreshHz(
      current.streamingRefreshHz,
    );
    delete migrated.streamingRefreshHz;
    changed = true;
  }
  if (!changed) return value;
  return migrated;
}

export function resolveStreamingFrameIntervalMs(preferences: unknown): number {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return STREAMING_FRAME_INTERVAL_DEFAULT;
  }
  const record = preferences as Record<string, unknown>;
  const interval = record.streamingFrameIntervalMs;
  if (typeof interval === "number" && Number.isFinite(interval)) {
    return Math.max(
      STREAMING_FRAME_INTERVAL_MIN,
      Math.min(STREAMING_FRAME_INTERVAL_MAX, Math.round(interval)),
    );
  }
  return frameIntervalFromLegacyRefreshHz(record.streamingRefreshHz);
}

function frameIntervalFromLegacyRefreshHz(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return STREAMING_FRAME_INTERVAL_DEFAULT;
  }
  return Math.max(
    STREAMING_FRAME_INTERVAL_MIN,
    Math.min(STREAMING_FRAME_INTERVAL_MAX, Math.round(1_000 / value)),
  );
}

export const TaskScrollAnchorSchema = z.object({
  itemId: z.string().min(1).max(512).nullable(),
  fallbackIndex: z.number().int().min(0).max(100_000),
  offset: z.number().finite().min(0).max(1_000_000),
  followLatest: z.boolean(),
});
export type TaskScrollAnchor = z.infer<typeof TaskScrollAnchorSchema>;

export const TaskUiStateMutationSchema = z.object({
  requestId: z.string().uuid(),
  scrollAnchor: TaskScrollAnchorSchema.nullable().optional(),
  contextOpen: z.boolean().optional(),
  contextResources: z.array(SavedContextResourceSchema).max(1_024).optional(),
  contextSection: z.enum(["planning", "work", "context"]).optional(),
}).refine((value) => value.scrollAnchor !== undefined || value.contextOpen !== undefined || value.contextResources !== undefined
  || value.contextSection !== undefined, {
  message: "At least one task UI field is required.",
});

export const DraftKeySchema = z.union([
  z.string().regex(/^task:[0-9a-f-]{36}$/i),
  NewTaskDraftKeySchema,
]);
export const DraftMutationSchema = z.object({
  requestId: z.string().uuid(),
  key: DraftKeySchema,
  document: z.string().min(1).max(2_000_000).nullable(),
});

export interface TaskUiState {
  scrollAnchor: TaskScrollAnchor | null;
  contextOpen: boolean;
  contextResources: SavedContextResource[];
  contextSection: "planning" | "work" | "context";
}

export interface DraftSnapshot {
  document: string | null;
}
