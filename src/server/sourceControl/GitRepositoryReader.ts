import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  SourceControlBranch,
  SourceControlDiff,
  SourceControlFile,
  SourceControlSnapshot,
  SourceControlWorktree,
} from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import { safeBasename } from "../security/pathDisplay.js";
import type { GitRepositoryContext, GitResult } from "./gitCommandRunner.js";
import { GitCommandRunner } from "./gitCommandRunner.js";
import {
  parseStatus,
  safeRepositoryPath,
  samePath,
  sanitizePatch,
  validRemote,
  worktreeId,
} from "./sourceControlParsing.js";

export interface RepositoryStateCapture {
  fingerprint: string;
  projectIds: string[];
  snapshot: Omit<SourceControlSnapshot, "stateToken">;
}

interface RawRepositoryState {
  current: string | null;
  headOid: string | null;
  upstream: string | null;
  status: GitResult;
  index: GitResult;
  refs: GitResult;
  remotes: GitResult;
  remoteConfig: GitResult;
  worktrees: GitResult;
  aheadBehind: GitResult | null;
}
type WorktreeRow = Record<string, string | boolean>;

const STATE_READ_ATTEMPTS = 3;
const STATE_CHANGED_MESSAGE = "Source Control changed while it was being read. Refresh and try again.";

export class GitRepositoryReader {
  constructor(
    private readonly resolveProjectPath: (projectId: string) => string,
    private readonly projectIdForCanonicalPath: (directory: string) => string | null,
    readonly commands: GitCommandRunner,
  ) {}

  async lookup(projectId: string): Promise<GitRepositoryContext | null> {
    return this.find(projectId, this.resolveProjectPath(projectId));
  }

  async stableSnapshot(
    projectId: string,
    repository: GitRepositoryContext,
    canonicalCommonDirectory: string,
  ): Promise<RepositoryStateCapture> {
    let previous = await this.capture(projectId, repository, canonicalCommonDirectory);
    for (let attempt = 0; attempt < STATE_READ_ATTEMPTS; attempt += 1) {
      const current = await this.capture(projectId, repository, canonicalCommonDirectory);
      if (current.fingerprint === previous.fingerprint) return current;
      previous = current;
    }
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", STATE_CHANGED_MESSAGE);
  }

  async diffFromRepository(repository: GitRepositoryContext, relativePath: string, staged: boolean): Promise<SourceControlDiff> {
    const file = (await this.status(repository)).find((entry) => entry.path === relativePath);
    if (!file) throw new AppProblem(404, "NOT_FOUND", "The selected change is no longer present.");
    const result = file.untracked && !staged
      ? await this.commands.run(repository, ["diff", "--no-index", "--no-color", "--", "/dev/null", safeRepositoryPath(repository.root, file.path)], 30_000, 2_000_000, [0, 1])
      : await this.commands.run(repository, ["diff", ...(staged ? ["--cached"] : []), "--no-ext-diff", "--no-color", "--", file.path], 30_000, 2_000_000);
    return { path: file.path, staged, patch: sanitizePatch(result.stdout, repository.root), truncated: result.truncated };
  }

  async require(projectId: string): Promise<GitRepositoryContext> {
    const repository = await this.lookup(projectId);
    if (!repository) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The current Project is not a Git repository root.");
    return repository;
  }

  async lockKey(repository: GitRepositoryContext): Promise<string> {
    const common = await this.commands.optionalLine(repository, ["rev-parse", "--git-common-dir"]);
    const candidate = common ? path.resolve(repository.root, common) : repository.root;
    try { return fs.realpathSync.native(candidate); }
    catch { return candidate; }
  }

  async relatedProjectIds(repository: GitRepositoryContext): Promise<string[]> {
    const result = await this.commands.run(repository, ["worktree", "list", "--porcelain", "-z"], 20_000, 8_000_000);
    this.assertComplete(result, "Git Worktree state");
    return this.indexedProjectIds(repository, this.worktreeRows(result.stdout));
  }

  currentBranch(repository: GitRepositoryContext): Promise<string | null> {
    return this.commands.optionalLine(repository, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  }

  currentHead(repository: GitRepositoryContext): Promise<string | null> {
    return this.commands.optionalLine(repository, ["rev-parse", "--verify", "HEAD"]);
  }

  async status(repository: GitRepositoryContext): Promise<SourceControlFile[]> {
    const result = await this.rawStatus(repository);
    return parseStatus(result.stdout).slice(0, 20_000);
  }

  async branches(repository: GitRepositoryContext): Promise<SourceControlBranch[]> {
    const result = await this.commands.run(repository, ["for-each-ref", "--format=%(refname:short)%00%(upstream:short)", "refs/heads"], 20_000, 2_000_000);
    this.assertComplete(result, "Git branch state");
    return result.stdout.split("\n").flatMap((line) => {
      if (!line) return [];
      const [name, upstream = ""] = line.split("\0");
      return name ? [{ name, current: false, upstream: upstream || null }] : [];
    }).slice(0, 5_000);
  }

  async changedPaths(repository: GitRepositoryContext, paths: string[], required?: "staged"): Promise<SourceControlFile[]> {
    const files = await this.status(repository);
    return paths.map((value) => {
      const file = files.find((entry) => entry.path === value);
      if (!file || (required === "staged" && !file.staged)) throw new AppProblem(404, "NOT_FOUND", `The selected change is no longer available: ${value}`);
      safeRepositoryPath(repository.root, value);
      if (file.previousPath) safeRepositoryPath(repository.root, file.previousPath);
      return file;
    });
  }

  private async capture(
    projectId: string,
    repository: GitRepositoryContext,
    canonicalCommonDirectory: string,
  ): Promise<RepositoryStateCapture> {
    const [current, headOid, upstream, status, index, refs, remotes, remoteConfig, worktrees] = await Promise.all([
      this.currentBranch(repository),
      this.currentHead(repository),
      this.commands.optionalLine(repository, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
      this.rawStatus(repository),
      this.commands.run(repository, ["ls-files", "--stage", "-z"], 20_000, 8_000_000),
      this.commands.run(repository, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(upstream:short)", "refs/heads", "refs/remotes"], 20_000, 8_000_000),
      this.commands.run(repository, ["remote"], 20_000, 2_000_000),
      this.commands.run(repository, ["config", "--null", "--show-origin", "--get-regexp", "^(remote\\.|branch\\.|url\\.|push\\.)"], 20_000, 8_000_000, [0, 1]),
      this.commands.run(repository, ["worktree", "list", "--porcelain", "-z"], 20_000, 8_000_000),
    ]);
    for (const [label, result] of [
      ["Git index state", index],
      ["Git branch state", refs],
      ["Git remote state", remotes],
      ["Git remote configuration", remoteConfig],
      ["Git Worktree state", worktrees],
    ] as const) this.assertComplete(result, label);
    const aheadBehind = upstream
      ? await this.commands.run(repository, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], 20_000, 256_000, [0, 128])
      : null;
    if (aheadBehind) this.assertComplete(aheadBehind, "Git upstream state");
    const raw: RawRepositoryState = { current, headOid, upstream, status, index, refs, remotes, remoteConfig, worktrees, aheadBehind };
    const files = parseStatus(status.stdout);
    const branches = this.parseBranches(refs.stdout, current);
    const worktreeRows = this.worktreeRows(worktrees.stdout);
    const counts = aheadBehind?.code === 0 ? aheadBehind.stdout.match(/^(\d+)\s+(\d+)\s*$/) : null;
    const fingerprint = this.fingerprint(repository, canonicalCommonDirectory, raw, files);
    return {
      fingerprint,
      projectIds: this.indexedProjectIds(repository, worktreeRows),
      snapshot: {
        scannedAt: new Date().toISOString(),
        projectId,
        repository: true,
        writeLocked: false,
        headOid,
        branch: {
          current,
          detached: Boolean(headOid && !current),
          upstream,
          ahead: counts ? Number(counts[1]) : 0,
          behind: counts ? Number(counts[2]) : 0,
        },
        clean: files.length === 0,
        files: files.slice(0, 20_000),
        branches,
        remotes: remotes.stdout.split(/\r?\n/).map((line) => line.trim()).filter(validRemote).slice(0, 100),
        worktrees: this.parseWorktrees(repository, worktreeRows),
        reason: null,
      },
    };
  }

  private fingerprint(
    repository: GitRepositoryContext,
    canonicalCommonDirectory: string,
    raw: RawRepositoryState,
    files: SourceControlFile[],
  ): string {
    const hash = createHash("sha256");
    const add = (label: string, value: string): void => {
      hash.update(`${label.length}:${label}${Buffer.byteLength(value)}:`);
      hash.update(value);
    };
    add("common-directory", canonicalCommonDirectory);
    add("branch", raw.current ?? "<detached>");
    add("head", raw.headOid ?? "<unborn>");
    add("upstream", raw.upstream ?? "<none>");
    add("status", raw.status.stdout);
    add("index", raw.index.stdout);
    add("refs", raw.refs.stdout);
    add("remotes", raw.remotes.stdout);
    add("remote-config-code", String(raw.remoteConfig.code));
    add("remote-config", raw.remoteConfig.stdout);
    add("worktrees", raw.worktrees.stdout);
    add("ahead-behind", raw.aheadBehind?.stdout ?? "<none>");
    const paths = [...new Set(files.flatMap((file) => file.previousPath ? [file.path, file.previousPath] : [file.path]))].sort();
    for (const relativePath of paths) {
      add("changed-path", relativePath);
      add("changed-path-lstat", this.lstatIdentity(safeRepositoryPath(repository.root, relativePath)));
    }
    return hash.digest("hex");
  }

  private lstatIdentity(absolutePath: string): string {
    try {
      const stat = fs.lstatSync(absolutePath, { bigint: true });
      return [
        stat.dev, stat.ino, stat.mode, stat.nlink, stat.uid, stat.gid, stat.rdev,
        stat.size, stat.blksize, stat.blocks, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs,
      ].join(":");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
      return `missing:${code}`;
    }
  }

  private parseBranches(value: string, current: string | null): SourceControlBranch[] {
    return value.split("\n").flatMap((line) => {
      if (!line) return [];
      const [refName, , upstream = ""] = line.split("\0");
      if (!refName?.startsWith("refs/heads/")) return [];
      const name = refName.slice("refs/heads/".length);
      return name ? [{ name, current: name === current, upstream: upstream || null }] : [];
    }).slice(0, 5_000);
  }

  private worktreeRows(value: string): WorktreeRow[] {
    const rows: WorktreeRow[] = [];
    let row: WorktreeRow | null = null;
    for (const token of value.split("\0")) {
      if (!token) continue;
      const [key, ...rest] = token.split(" ");
      const field = rest.join(" ");
      if (key === "worktree") {
        row = { worktree: field };
        rows.push(row);
      } else if (row) row[key] = field || true;
    }
    return rows;
  }

  private indexedProjectIds(repository: GitRepositoryContext, rows: WorktreeRow[]): string[] {
    const ids = new Set([repository.projectId]);
    for (const entry of rows) {
      const worktreePath = typeof entry.worktree === "string" ? entry.worktree : "";
      const projectId = worktreePath ? this.projectIdForCanonicalPath(worktreePath) : null;
      if (projectId) ids.add(projectId);
    }
    return [...ids].sort();
  }

  private parseWorktrees(repository: GitRepositoryContext, rows: WorktreeRow[]): SourceControlWorktree[] {
    return rows.flatMap((entry) => {
      const worktreePath = typeof entry.worktree === "string" ? entry.worktree : "";
      if (!worktreePath) return [];
      const branchValue = typeof entry.branch === "string" ? entry.branch.replace(/^refs\/heads\//, "") : null;
      return [{
        id: worktreeId(worktreePath),
        label: safeBasename(worktreePath) || "Worktree",
        branch: branchValue,
        current: samePath(worktreePath, repository.root),
        indexedProject: this.projectIdForCanonicalPath(worktreePath) !== null,
        locked: Boolean(entry.locked),
        prunable: Boolean(entry.prunable),
      }];
    }).slice(0, 2_000);
  }

  private async rawStatus(repository: GitRepositoryContext): Promise<GitResult> {
    const result = await this.commands.run(repository, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"], 20_000, 8_000_000);
    this.assertComplete(result, "Git status");
    return result;
  }

  private assertComplete(result: GitResult, label: string): void {
    if (result.truncated) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", `${label} exceeded the local output limit.`);
  }

  private async find(projectId: string, projectPath: string): Promise<GitRepositoryContext | null> {
    const candidate = { projectId, projectPath, root: projectPath };
    const probe = await this.commands.run(candidate, ["rev-parse", "--show-toplevel"], 10_000, 32_000, [0, 128]);
    if (probe.code !== 0) return null;
    let root: string;
    try { root = fs.realpathSync.native(probe.stdout.trim()); }
    catch { return null; }
    if (root !== fs.realpathSync.native(projectPath)) return null;
    return { projectId, projectPath, root };
  }
}
