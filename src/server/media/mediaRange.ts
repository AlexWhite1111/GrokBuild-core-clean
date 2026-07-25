import { AppProblem } from "../security/problemResponse.js";

export interface MediaByteRange {
  start: number;
  end: number;
  length: number;
  partial: boolean;
}

export function mediaByteRange(header: string | undefined, size: number): MediaByteRange {
  if (!Number.isSafeInteger(size) || size <= 0) throw new AppProblem(404, "NOT_FOUND", "Media is empty or unavailable.");
  if (!header) return { start: 0, end: size - 1, length: size, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) throw invalidRange();
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalidRange();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) throw invalidRange();
    end = Math.min(end, size - 1);
  }
  return { start, end, length: end - start + 1, partial: true };
}

function invalidRange(): AppProblem {
  return new AppProblem(416, "VALIDATION_FAILED", "Only one satisfiable byte range is supported.");
}
