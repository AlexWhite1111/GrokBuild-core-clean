import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SourceControlFile, SourceControlSnapshot } from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";

export function parseStatus(value: string): SourceControlFile[] {
  const tokens = value.split("\0");
  const files: SourceControlFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 3) continue;
    const indexStatus = token[0];
    const worktreeStatus = token[1];
    const filePath = token.slice(3);
    const renamed = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C";
    const previousPath = renamed ? tokens[++index] || null : null;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    const conflicted = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${worktreeStatus}`);
    files.push({
      path: filePath,
      previousPath,
      indexStatus,
      worktreeStatus,
      staged: !untracked && indexStatus !== " ",
      unstaged: untracked || worktreeStatus !== " ",
      untracked,
      conflicted,
    });
  }
  return files;
}

export function unavailableSnapshot(projectId: string, stateToken: string, reason: string, writeLocked = false): SourceControlSnapshot {
  return {
    scannedAt: new Date().toISOString(), projectId, stateToken, repository: false, writeLocked, headOid: null,
    branch: { current: null, detached: false, upstream: null, ahead: 0, behind: 0 },
    clean: true, files: [], branches: [], remotes: [], worktrees: [],
    reason,
  };
}

export function safeRepositoryPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0") || relative.split(/[\\/]/).includes("..")) {
    throw new AppProblem(400, "PATH_REJECTED", "The Git path must remain inside the current repository.");
  }
  const candidate = path.resolve(root, relative);
  const relation = path.relative(root, candidate);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new AppProblem(400, "PATH_REJECTED", "The Git path must remain inside the current repository.");
  return candidate;
}

export function worktreeId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function samePath(left: string, right: string): boolean {
  try { return fs.realpathSync.native(left) === fs.realpathSync.native(right); }
  catch { return path.resolve(left) === path.resolve(right); }
}

export function sanitizePatch(value: string, root: string): string {
  return value.replaceAll(`${root}${path.sep}`, "").replaceAll(root, path.basename(root));
}

export function validRemote(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(value);
}

export function gitFailure(operation: string | undefined, stderr: string): string {
  const normalized = stderr.toLowerCase();
  if (/authentication|credential|could not read username|terminal prompts disabled/.test(normalized)) return "Git authentication is required before this operation can continue.";
  if (/local changes|would be overwritten|not possible because you have unmerged/.test(normalized)) return "Git kept the current changes and rejected this operation.";
  return `Git ${operation || "operation"} did not complete.`;
}
