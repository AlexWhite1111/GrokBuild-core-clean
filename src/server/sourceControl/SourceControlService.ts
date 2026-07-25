import fs from "node:fs";
import type {
  SourceControlDiff,
  SourceControlFile,
  SourceControlMutation,
  SourceControlMutationReceipt,
  SourceControlMutationResult,
  SourceControlSnapshot,
} from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import { GitCommandRunner, type GitRepositoryContext } from "./gitCommandRunner.js";
import { GitRepositoryReader, type RepositoryStateCapture } from "./GitRepositoryReader.js";
import { KeyedSerialQueue } from "./keyedSerialQueue.js";
import { gitFailure, safeRepositoryPath, samePath, unavailableSnapshot, validRemote, worktreeId } from "./sourceControlParsing.js";
import { SourceControlStateTokenAuthority } from "./sourceControlStateToken.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

interface PushResult { branch: string; headOid: string; remote: string; upstream: string }
type SourceControlWriteLeases = <T>(projectIds: readonly string[], operation: () => Promise<T>) => Promise<T>;

const passthroughWriteLeases: SourceControlWriteLeases = async (_projectIds, operation) => operation();

export class SourceControlService {
  readonly #operations = new KeyedSerialQueue();
  readonly #commands: GitCommandRunner;
  readonly #repositories: GitRepositoryReader;
  readonly #stateTokens = new SourceControlStateTokenAuthority();

  constructor(
    resolveProjectPath: (projectId: string) => string,
    private readonly projectsSourceControlLocked: (projectIds: readonly string[]) => boolean = () => false,
    private readonly projectIdForCanonicalPath: (directory: string) => string | null = () => null,
    gitBinary = "/usr/bin/git",
    private readonly withWriteLeases: SourceControlWriteLeases = passthroughWriteLeases,
    processes?: OwnedProcessRegistry,
  ) {
    this.#commands = new GitCommandRunner(gitBinary, processes);
    this.#repositories = new GitRepositoryReader(
      resolveProjectPath,
      projectIdForCanonicalPath,
      this.#commands,
    );
  }

  async snapshot(projectId: string): Promise<SourceControlSnapshot> {
    const repository = await this.#repositories.lookup(projectId);
    if (!repository) {
      return unavailableSnapshot(
        projectId,
        this.#stateTokens.unavailable(projectId),
        "The current Project is not a Git repository root.",
        this.projectsSourceControlLocked([projectId]),
      );
    }
    const lockKey = await this.#repositories.lockKey(repository);
    return this.#operations.run(lockKey, async () => {
      const liveRepository = await this.requireSameRepository(projectId, lockKey);
      return this.readSnapshot(projectId, liveRepository, lockKey);
    });
  }

  async diff(projectId: string, relativePath: string, staged: boolean): Promise<SourceControlDiff> {
    const repository = await this.#repositories.require(projectId);
    const lockKey = await this.#repositories.lockKey(repository);
    return this.#operations.run(lockKey, async () => {
      const liveRepository = await this.requireSameRepository(projectId, lockKey);
      return this.#repositories.diffFromRepository(liveRepository, relativePath, staged);
    });
  }

  async mutate(projectId: string, input: SourceControlMutation): Promise<SourceControlMutationResult> {
    const repository = await this.#repositories.require(projectId);
    const lockKey = await this.#repositories.lockKey(repository);
    return this.#operations.run(lockKey, async () => {
      const liveRepository = await this.requireSameRepository(projectId, lockKey);
      const projectIds = await this.#repositories.relatedProjectIds(liveRepository);
      const receipt = await this.withWriteLeases(projectIds, async () => {
        this.assertWriteUnlocked(projectIds);
        const expected = await this.#repositories.stableSnapshot(projectId, liveRepository, lockKey);
        this.assertSameProjects(projectIds, expected.projectIds);
        this.assertExpectedState(input, expected);
        return this.executeMutation(liveRepository, input, expected.snapshot);
      });
      try {
        const refreshedRepository = await this.requireSameRepository(projectId, lockKey);
        return { receipt, snapshot: await this.readSnapshot(projectId, refreshedRepository, lockKey), refreshRequired: false };
      } catch {
        return { receipt, snapshot: null, refreshRequired: true };
      }
    });
  }

  private async executeMutation(
    repository: GitRepositoryContext,
    input: SourceControlMutation,
    expectedSnapshot: Omit<SourceControlSnapshot, "stateToken">,
  ): Promise<SourceControlMutationReceipt> {
    const completed = <Action extends SourceControlMutation["action"]>(action: Action) => ({
      requestId: input.requestId,
      action,
      completedAt: new Date().toISOString(),
    });
    switch (input.action) {
      case "stage":
        await this.#commands.ok(repository, [
          "add", "--", ...this.expandPaths(await this.#repositories.changedPaths(repository, input.paths)),
        ]);
        return { ...completed("stage"), paths: [...input.paths] };
      case "unstage":
        await this.unstage(repository, await this.#repositories.changedPaths(repository, input.paths, "staged"));
        return { ...completed("unstage"), paths: [...input.paths] };
      case "discard":
        await this.discard(repository, input.paths);
        return { ...completed("discard"), paths: [...input.paths] };
      case "createAndCheckoutBranch": {
        const basedOnHead = expectedSnapshot.headOid;
        const branch = await this.createAndCheckoutBranch(repository, input.requestedName, input.collision);
        return { ...completed("createAndCheckoutBranch"), branch, basedOnHead };
      }
      case "switchBranch": {
        const branches = await this.#repositories.branches(repository);
        if (!branches.some((branch) => branch.name === input.name)) {
          throw new AppProblem(404, "NOT_FOUND", "The selected local branch no longer exists.");
        }
        await this.#commands.ok(repository, ["switch", "--", input.name]);
        return { ...completed("switchBranch"), branch: input.name, headOid: await this.#repositories.currentHead(repository) };
      }
      case "commit": {
        let files = await this.#repositories.status(repository);
        if (input.includeUnstaged) {
          if (files.some((file) => file.conflicted)) {
            throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Resolve conflicted files before including unstaged changes.");
          }
          if (files.some((file) => file.unstaged)) await this.#commands.ok(repository, ["add", "-A", "--", "."]);
          files = await this.#repositories.status(repository);
        }
        if (!files.some((file) => file.staged)) {
          throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Stage at least one change before committing.");
        }
        await this.#commands.ok(repository, ["commit", "-m", input.message], 120_000);
        const headOid = await this.#repositories.currentHead(repository);
        if (!headOid) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Git created no readable commit receipt.");
        return {
          ...completed("commit"),
          branch: await this.#repositories.currentBranch(repository),
          headOid,
          includeUnstaged: input.includeUnstaged,
        };
      }
      case "push":
        return { ...completed("push"), ...await this.push(repository, input.remote) };
      case "removeWorktree":
        await this.removeWorktree(repository, input.worktreeId);
        return { ...completed("removeWorktree"), worktreeId: input.worktreeId };
      case "gcWorktrees":
        await this.#commands.ok(repository, ["worktree", "prune"]);
        return completed("gcWorktrees");
      default:
        throw new AppProblem(400, "VALIDATION_FAILED", "The Source Control action is not supported.");
    }
  }

  private assertExpectedState(input: SourceControlMutation, capture: RepositoryStateCapture): void {
    if (this.#stateTokens.matches(input.expectedStateToken, capture.fingerprint)) return;
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Source Control changed. Refresh and try again.");
  }

  private async readSnapshot(
    projectId: string,
    repository: GitRepositoryContext,
    lockKey: string,
  ): Promise<SourceControlSnapshot> {
    const capture = await this.#repositories.stableSnapshot(projectId, repository, lockKey);
    return {
      ...capture.snapshot,
      writeLocked: this.projectsSourceControlLocked(capture.projectIds),
      stateToken: this.#stateTokens.issue(capture.fingerprint),
    };
  }

  private async requireSameRepository(projectId: string, expectedLockKey: string): Promise<GitRepositoryContext> {
    const repository = await this.#repositories.require(projectId);
    const liveLockKey = await this.#repositories.lockKey(repository);
    if (liveLockKey === expectedLockKey) return repository;
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Source Control changed. Refresh and try again.");
  }

  private async unstage(repository: GitRepositoryContext, files: SourceControlFile[]): Promise<void> {
    const paths = this.expandPaths(files);
    const result = await this.#commands.run(repository, ["restore", "--staged", "--", ...paths], 30_000, 1_000_000, [0, 128]);
    if (result.code === 0) return;
    await this.#commands.ok(repository, ["reset", "--", ...paths]);
  }

  private async discard(repository: GitRepositoryContext, paths: string[]): Promise<void> {
    if (paths.length !== 1) {
      throw new AppProblem(400, "VALIDATION_FAILED", "Discard exactly one Source Control change at a time.");
    }
    const files = await this.#repositories.status(repository);
    const [value] = paths;
    const file = files.find((entry) => entry.path === value);
    if (!file) throw new AppProblem(404, "NOT_FOUND", `The selected change is no longer available: ${value}`);
    const absolute = safeRepositoryPath(repository.root, value);
    if (file.untracked) {
      this.removeUntrackedFile(absolute);
    } else {
      if (!file.unstaged) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Unstage this change before discarding it.");
      await this.#commands.ok(repository, ["restore", "--worktree", "--", value]);
    }
  }

  private removeUntrackedFile(absolute: string): void {
    let removable = false;
    try {
      const stat = fs.lstatSync(absolute);
      removable = stat.isFile() || stat.isSymbolicLink();
    } catch { /* handled by the generic rejection below */ }
    if (!removable) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Only an untracked file or symbolic link can be discarded.");
    }
    try { fs.rmSync(absolute, { recursive: false, force: false }); }
    catch {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The untracked item changed before it could be discarded.");
    }
  }

  private expandPaths(files: SourceControlFile[]): string[] {
    return [...new Set(files.flatMap((file) => file.previousPath ? [file.path, file.previousPath] : [file.path]))];
  }

  private async validateBranchFormat(repository: GitRepositoryContext, name: string): Promise<void> {
    const check = await this.#commands.run(repository, ["check-ref-format", "--branch", name], 10_000, 64_000, [0, 128]);
    if (check.code !== 0) throw new AppProblem(400, "VALIDATION_FAILED", "Git rejected the branch name.");
  }

  private async createAndCheckoutBranch(
    repository: GitRepositoryContext,
    requestedName: string,
    collision: "reject" | "suffix",
  ): Promise<string> {
    await this.validateBranchFormat(repository, requestedName);
    const existing = new Set((await this.#repositories.branches(repository)).map((branch) => branch.name));
    if (collision === "reject" && existing.has(requestedName)) {
      throw new AppProblem(409, "VALIDATION_FAILED", "A local branch with this name already exists.");
    }
    for (let index = 1; index <= 10_000; index += 1) {
      const candidate = index === 1 ? requestedName : suffixedBranchName(requestedName, index);
      if (existing.has(candidate)) continue;
      await this.validateBranchFormat(repository, candidate);
      const result = await this.#commands.run(repository, ["switch", "-c", candidate], 60_000, 2_000_000, [0, 1, 128]);
      if (result.code === 0) return candidate;
      const nowExists = (await this.#repositories.branches(repository)).some((branch) => branch.name === candidate);
      if (collision === "suffix" && nowExists) {
        existing.add(candidate);
        continue;
      }
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", gitFailure("switch", result.stderr));
    }
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Git could not allocate an unused branch name.");
  }

  private async push(repository: GitRepositoryContext, requestedRemote?: string): Promise<PushResult> {
    const branch = await this.#repositories.currentBranch(repository);
    const headOid = await this.#repositories.currentHead(repository);
    if (!branch || !headOid) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Check out a local branch before pushing.");
    const upstream = await this.upstreamTarget(repository, branch);
    let remote: string;
    if (upstream) {
      remote = upstream.remote;
      await this.#commands.ok(repository, ["push", "--porcelain", "--", remote, `HEAD:${upstream.remoteRef}`], 120_000);
    } else {
      const remotes = await this.#commands.lines(repository, ["remote"]);
      if (!requestedRemote || !validRemote(requestedRemote) || !remotes.includes(requestedRemote)) {
        throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Choose an existing remote for the first push.");
      }
      remote = requestedRemote;
      await this.#commands.ok(repository, ["push", "--porcelain", "--set-upstream", "--", remote, "HEAD"], 120_000);
    }
    const confirmedUpstream = await this.#commands.optionalLine(repository, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    if (!confirmedUpstream) throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Git did not confirm the pushed branch upstream.");
    return { branch, headOid, remote, upstream: confirmedUpstream };
  }

  private async upstreamTarget(repository: GitRepositoryContext, branch: string): Promise<{ remote: string; remoteRef: string } | null> {
    const result = await this.#commands.optionalLine(repository, [
      "for-each-ref",
      "--format=%(upstream:remotename)%00%(upstream:remoteref)",
      `refs/heads/${branch}`,
    ]);
    if (!result) return null;
    const [remote, remoteRef] = result.split("\0");
    if (!remote && !remoteRef) return null;
    if (!remote || !validRemote(remote) || !remoteRef?.startsWith("refs/heads/")) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The current branch upstream is not a supported push target.");
    }
    return { remote, remoteRef };
  }

  private async removeWorktree(repository: GitRepositoryContext, id: string): Promise<void> {
    const result = await this.#commands.run(repository, ["worktree", "list", "--porcelain", "-z"], 20_000, 2_000_000);
    const candidate = result.stdout.split("\0")
      .flatMap((token) => token.startsWith("worktree ") ? [token.slice(9)] : [])
      .find((value) => worktreeId(value) === id);
    if (!candidate) throw new AppProblem(404, "NOT_FOUND", "The selected Worktree no longer exists.");
    if (samePath(candidate, repository.root)) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The current Project Worktree cannot remove itself.");
    }
    if (this.projectIdForCanonicalPath(candidate)) {
      throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Remove this Worktree from the Project index before deleting it.");
    }
    await this.#commands.ok(repository, ["worktree", "remove", "--", candidate], 120_000);
  }

  private assertSameProjects(expected: readonly string[], actual: readonly string[]): void {
    if (expected.length === actual.length && expected.every((projectId, index) => projectId === actual[index])) return;
    throw new AppProblem(409, "CAPABILITY_UNAVAILABLE", "Source Control changed. Refresh and try again.");
  }

  private assertWriteUnlocked(projectIds: readonly string[]): void {
    if (this.projectsSourceControlLocked(projectIds)) {
      throw new AppProblem(409, "TASK_BUSY", "Source Control writes are locked while this Project has active work.");
    }
  }
}

function suffixedBranchName(base: string, index: number): string {
  const suffix = `-${index}`;
  const stem = base.slice(0, Math.max(1, 240 - suffix.length)).replace(/[/.]+$/g, "") || "branch";
  return `${stem}${suffix}`;
}
