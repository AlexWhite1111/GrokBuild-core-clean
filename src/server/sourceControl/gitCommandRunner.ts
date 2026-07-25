import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AppProblem } from "../security/problemResponse.js";
import { gitFailure } from "./sourceControlParsing.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

const TERMINATION_GRACE_MS = 500;

export interface GitRepositoryContext {
  projectId: string;
  projectPath: string;
  root: string;
}

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export class GitCommandRunner {
  constructor(private readonly binary = "/usr/bin/git", private readonly processes?: OwnedProcessRegistry) {}

  async ok(repository: GitRepositoryContext, args: string[], timeoutMs = 60_000): Promise<void> {
    await this.run(repository, args, timeoutMs, 2_000_000);
  }

  async lines(repository: GitRepositoryContext, args: string[]): Promise<string[]> {
    const result = await this.run(repository, args, 20_000, 2_000_000);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async optionalLine(repository: GitRepositoryContext, args: string[]): Promise<string | null> {
    const result = await this.run(repository, args, 20_000, 256_000, [0, 1, 128]);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  run(
    repository: GitRepositoryContext,
    args: string[],
    timeoutMs: number,
    maxBytes: number,
    acceptedCodes = [0],
  ): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const isolatedProcessGroup = process.platform !== "win32";
      const ownerId = `git:${repository.projectId}:${randomUUID()}`;
      const child = spawn(this.binary, args, {
        cwd: repository.root,
        detached: isolatedProcessGroup,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnvironment(),
        windowsHide: true,
      });
      if (this.processes) {
        try {
          this.processes.register({ ownerKind: "application", ownerId, child, isolatedProcessGroup });
        } catch (error) {
          child.once("error", () => undefined);
          try {
            if (isolatedProcessGroup && child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch { /* The child may already have exited. */ }
          reject(error);
          return;
        }
      }
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
        if (current.length >= maxBytes) { truncated = true; return current; }
        if (current.length + chunk.length > maxBytes) {
          truncated = true;
          return Buffer.concat([current, chunk.subarray(0, maxBytes - current.length)]);
        }
        return Buffer.concat([current, chunk]);
      };
      child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => { stderr = append(stderr, chunk); });
      const signal = (value: NodeJS.Signals): void => {
        try {
          if (isolatedProcessGroup && child.pid) process.kill(-child.pid, value);
          else child.kill(value);
        } catch {
          // The process group may have exited between the timeout and signal delivery.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (this.processes) {
          void this.processes.stopOwner("application", ownerId).catch(() => signal("SIGKILL"));
        } else {
          signal("SIGTERM");
          killTimer = setTimeout(() => signal("SIGKILL"), TERMINATION_GRACE_MS);
          killTimer.unref();
        }
      }, timeoutMs);
      timer.unref();
      child.once("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        reject(new AppProblem(409, "CAPABILITY_UNAVAILABLE", "The local Git executable could not be started."));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (timedOut) {
          // The leader can close after TERM while a detached descendant ignores it.
          // Terminate the whole isolated group before exposing the timeout upstream.
          signal("SIGKILL");
          reject(new AppProblem(504, "CAPABILITY_UNAVAILABLE", "The local Git operation timed out before it completed."));
          return;
        }
        const result = { code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), truncated };
        if (!acceptedCodes.includes(code ?? -1)) {
          reject(new AppProblem(409, "CAPABILITY_UNAVAILABLE", gitFailure(args[0], result.stderr)));
          return;
        }
        resolve(result);
      });
    });
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase().startsWith("GIT_") || key === "GCM_INTERACTIVE") continue;
    environment[key] = value;
  }
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "never";
  environment.GIT_LITERAL_PATHSPECS = "1";
  return environment;
}
