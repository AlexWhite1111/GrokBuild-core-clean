import path from "node:path";

type PathApi = typeof path.posix;

export function safeBasename(value: string): string {
  const api = pathApiFor(value);
  return sanitizeVisiblePath(api.basename(api.normalize(value)));
}

function pathApiFor(value: string): PathApi {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.includes("\\")
    ? path.win32
    : path.posix;
}

function sanitizeVisiblePath(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 1_000);
}
