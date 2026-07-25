import { MEDIA_PREVIEW_SCALE_MAX, MEDIA_PREVIEW_SCALE_MIN } from "../shared/contracts.js";

export interface MediaFit {
  width: number;
  height: number;
}

export interface MediaSizePreset<TMode extends string> {
  mode: TMode;
  size: number;
}

/** Selects the next materially larger rendered size, wrapping at the largest preset. */
export function nextMediaSizePreset<TMode extends string>(
  currentSize: number,
  presets: ReadonlyArray<MediaSizePreset<TMode>>,
  relativeDeadband = .05,
  pixelDeadband = 12,
): MediaSizePreset<TMode> {
  const ordered = presets
    .filter((preset) => Number.isFinite(preset.size) && preset.size > 0)
    .slice()
    .sort((left, right) => left.size - right.size);
  if (!ordered.length) throw new Error("Media size cycle requires at least one positive preset.");
  const current = Number.isFinite(currentSize) && currentSize > 0 ? currentSize : 0;
  const deadband = Math.max(pixelDeadband, current * relativeDeadband);
  return ordered.find((preset) => preset.size > current + deadband) || ordered[0];
}

export const MEDIA_SCALE_MIN = MEDIA_PREVIEW_SCALE_MIN;
export const MEDIA_SCALE_MAX = MEDIA_PREVIEW_SCALE_MAX;

/** Fits any aspect ratio into a comfortable visual box with a small continuous long-edge boost. */
export function fitMediaSize(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth: number,
  availableHeight: number,
  scalePercent: number,
  allowUpscale = false,
): MediaFit {
  const width = positive(naturalWidth);
  const height = positive(naturalHeight);
  const frameWidth = positive(availableWidth);
  const frameHeight = positive(availableHeight);
  const scale = clamp(scalePercent, MEDIA_SCALE_MIN, MEDIA_SCALE_MAX) / 100;
  const ratio = width / height;
  const extremity = Math.min(1, Math.abs(Math.log2(ratio)) / 2.5);
  const longEdgeScale = scale * (1 + .22 * extremity);
  const limitWidth = frameWidth * (ratio >= 1 ? longEdgeScale : scale);
  const limitHeight = frameHeight * (ratio < 1 ? longEdgeScale : scale);
  const factor = Math.min(limitWidth / width, limitHeight / height, allowUpscale ? Number.POSITIVE_INFINITY : 1);
  return { width: Math.max(1, width * factor), height: Math.max(1, height * factor) };
}

/** Keeps inline media continuously resizable by rendered CSS pixels, independent of source resolution. */
export function clampInlineMediaRatio(ratio: number, availableWidth: number, minimumRenderedPx = 64, naturalAspect = 1): number {
  const width = positive(availableWidth);
  const minimumWidth = positive(minimumRenderedPx);
  const minimum = Math.min(1, Math.max(minimumWidth / width, minimumWidth * positive(naturalAspect) / width));
  return clamp(ratio, minimum, 1);
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
