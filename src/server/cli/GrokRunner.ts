import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { OwnedProcessKind, OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  processOwner?: { kind: OwnedProcessKind; id: string };
}

export interface RunResult {
  args: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export class GrokRunner {
  constructor(private readonly binary: string, private readonly processes?: OwnedProcessRegistry) {}

  async run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    const timeoutMs = options.timeoutMs ?? 20_000;
    const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
    const startedAt = Date.now();
    const environment = { ...process.env, ...options.env };
    const secrets = secretValues(environment);

    return new Promise<RunResult>((resolve, reject) => {
      const isolatedProcessGroup = process.platform !== "win32";
      const owner = options.processOwner || { kind: "application" as const, id: `grok-cli:${randomUUID()}` };
      const child = spawn(this.binary, args, {
        cwd: options.cwd,
        env: environment,
        detached: isolatedProcessGroup,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (this.processes) {
        try {
          this.processes.register({
            ownerKind: owner.kind,
            ownerId: owner.id,
            child,
            isolatedProcessGroup,
          });
        } catch (error) {
          child.once("error", () => undefined);
          signalChild(child, "SIGKILL", isolatedProcessGroup);
          reject(error);
          return;
        }
      }

      let stdout = "";
      let stderr = "";
      let capturedBytes = 0;
      let truncated = false;
      let timedOut = false;

      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const remaining = Math.max(0, maxOutputBytes - capturedBytes);
        if (remaining === 0) {
          truncated = true;
          return;
        }
        const slice = chunk.subarray(0, remaining);
        capturedBytes += slice.length;
        if (slice.length < chunk.length) truncated = true;
        if (target === "stdout") stdout += slice.toString("utf8");
        else stderr += slice.toString("utf8");
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        if (this.processes) {
          void this.processes.stopOwner(owner.kind, owner.id)
            .catch(() => { signalChild(child, "SIGKILL", isolatedProcessGroup); });
        } else {
          signalChild(child, "SIGTERM", isolatedProcessGroup);
        }
      }, timeoutMs);

      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({
          args: redactArguments(args, secrets),
          code,
          signal,
          stdout: redactOutput(stdout, secrets),
          stderr: redactOutput(stderr, secrets),
          durationMs: Date.now() - startedAt,
          timedOut,
          truncated,
        });
      });
    });
  }
}

function signalChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals, group: boolean): void {
  try {
    if (group && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The command may have exited between timeout detection and signal delivery.
  }
}

function secretValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i.test(key) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value!);
}

function redactOutput(value: string, secrets: string[]): string {
  let safe = value;
  for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/(?:Bearer\s+|(?:api[_-]?key|token|password)["'=:\s]+)[A-Za-z0-9._~+/-]{8,}/gi, "[REDACTED]");
}

function redactArguments(args: string[], secrets: string[]): string[] {
  return args.map((argument) => {
    if (/^--(?:api[_-]?key|token|password)=/i.test(argument)) return `${argument.split("=", 1)[0]}=[REDACTED]`;
    return redactOutput(argument, secrets);
  });
}
