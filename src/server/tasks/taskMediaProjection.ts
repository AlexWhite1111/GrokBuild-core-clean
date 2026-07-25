import path from "node:path";
import type { TaskMediaAttachment } from "../../shared/contracts.js";
import {
  projectInlineAcpContent,
  type MediaArtifactStore,
} from "../media/MediaArtifactStore.js";

export interface ProjectionMediaContext { store: MediaArtifactStore; projectPath: string; grokHome: string }
const GENERATED_IMAGE_RESULTS = new Set(["ImageGen", "ImageEdit"]);
const MEDIA_EXTENSION_HINT = /\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv)/gi;
const MEDIA_HINT_CARRY = 6;

export interface MediaHintScanState {
  scannedLength: number;
  carry: string;
  scannedCharacters: number;
}

export function createMediaHintScanState(source = ""): MediaHintScanState {
  return {
    scannedLength: source.length,
    carry: source.slice(-MEDIA_HINT_CARRY),
    scannedCharacters: 0,
  };
}

/** Scan only new text plus the maximum partial extension suffix. */
export function scanAppendedMediaHints(
  previous: MediaHintScanState,
  appended: string,
): { state: MediaHintScanState; completed: boolean } {
  if (!appended) return { state: previous, completed: false };
  const window = previous.carry + appended;
  MEDIA_EXTENSION_HINT.lastIndex = 0;
  const completed = [...window.matchAll(MEDIA_EXTENSION_HINT)]
    .some((match) => (match.index || 0) + match[0].length > previous.carry.length);
  return {
    completed,
    state: {
      scannedLength: previous.scannedLength + appended.length,
      carry: window.slice(-MEDIA_HINT_CARRY),
      scannedCharacters: previous.scannedCharacters + window.length,
    },
  };
}

export function mediaForSessionUpdate(
  media: ProjectionMediaContext | undefined,
  taskId: string,
  updateType: string,
  update: Record<string, unknown>,
): TaskMediaAttachment[] {
  if (!media) return [];
  if (updateType === "agent_message_chunk") return media.store.registerAcpContent(taskId, media.projectPath, update.content);
  if (updateType === "tool_call" || updateType === "tool_call_update") {
    const structured = media.store.registerAcpToolContent(taskId, media.projectPath, update.content);
    if (structured.length) return structured;
    const output = record(update.rawOutput);
    const generatedPath = text(output.path);
    if (GENERATED_IMAGE_RESULTS.has(text(output.type) || "") && generatedPath && path.isAbsolute(generatedPath)) {
      return media.store.registerAcpContent(taskId, media.projectPath, { type: "resource_link", uri: generatedPath });
    }
  }
  return [];
}

/** Rebuilds deterministic inline-media metadata from official history. */
export function storedInlineMediaForSessionUpdate(
  taskId: string,
  updateType: string,
  update: Record<string, unknown>,
): TaskMediaAttachment[] {
  if (updateType === "agent_message_chunk") {
    return projectInlineAcpContent(taskId, update.content);
  }
  if (updateType !== "tool_call" && updateType !== "tool_call_update") return [];
  if (!Array.isArray(update.content)) return [];
  return update.content.flatMap((entry) => {
    const item = record(entry);
    return item.type === "content"
      ? projectInlineAcpContent(taskId, item.content)
      : [];
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
