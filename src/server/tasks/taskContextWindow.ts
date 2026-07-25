import fs from "node:fs";
import path from "node:path";
import type { TaskContextWindowUsage, TaskSnapshot } from "../../shared/contracts.js";

const MAX_SIGNALS_BYTES = 64 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Reads Grok's persisted per-session context gauge rather than cumulative turn usage. */
function readTaskContextWindow(
  grokHome: string,
  projectPath: string,
  sessionId: string | null,
): TaskContextWindowUsage | null {
  if (!sessionId || !SESSION_ID.test(sessionId)) return null;
  const sessionsRoot = path.resolve(grokHome, "sessions");
  const file = path.resolve(
    sessionsRoot,
    encodeURIComponent(path.resolve(projectPath)),
    sessionId,
    "signals.json",
  );
  if (!isWithin(sessionsRoot, file)) return null;
  try {
    const realRoot = fs.realpathSync(sessionsRoot);
    const realFile = fs.realpathSync(file);
    if (!isWithin(realRoot, realFile)) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SIGNALS_BYTES) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const usedTokens = tokenCount(value.contextTokensUsed);
    const totalTokens = tokenCount(value.contextWindowTokens);
    if (usedTokens == null || totalTokens == null || totalTokens <= 0) return null;
    return {
      usedTokens,
      totalTokens,
      percentage: Math.max(0, Math.min(100, usedTokens / totalTokens * 100)),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export function refreshTaskContextWindow(
  snapshot: TaskSnapshot,
  grokHome: string,
  projectPath: string,
): boolean {
  const next = readTaskContextWindow(grokHome, projectPath, snapshot.sessionId);
  if (!next || sameUsage(snapshot.contextWindow, next)) return false;
  snapshot.contextWindow = next;
  return true;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sameUsage(left: TaskContextWindowUsage | null, right: TaskContextWindowUsage): boolean {
  return Boolean(left)
    && left!.usedTokens === right.usedTokens
    && left!.totalTokens === right.totalTokens
    && left!.percentage === right.percentage
    && left!.updatedAt === right.updatedAt;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
