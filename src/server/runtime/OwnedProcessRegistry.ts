import type { ChildProcess } from "node:child_process";

export type OwnedProcessKind = "task" | "run" | "preview" | "application";

export interface OwnedProcessRegistration {
  ownerKind: OwnedProcessKind;
  ownerId: string;
  child: ChildProcess;
  /** True only when the caller spawned the child detached and its PID is the new PGID. */
  isolatedProcessGroup?: boolean;
}

export interface OwnedProcessSnapshot {
  ownerKind: OwnedProcessKind;
  ownerId: string;
  pid: number;
  processGroupId: number | null;
}

interface OwnedProcessEntry extends OwnedProcessSnapshot {
  child: ChildProcess;
  closed: Promise<void>;
  release: () => void;
}

interface RegistryOptions {
  graceMs?: number;
  pollMs?: number;
}

const DEFAULT_GRACE_MS = 900;
const DEFAULT_POLL_MS = 20;

/** One authority for every subprocess created by the running application instance. */
export class OwnedProcessRegistry {
  readonly #entries = new Map<number, OwnedProcessEntry>();
  readonly #stops = new Map<number, Promise<void>>();
  readonly #graceMs: number;
  readonly #pollMs: number;
  #accepting = true;

  constructor(options: RegistryOptions = {}) {
    this.#graceMs = positiveDuration(options.graceMs, DEFAULT_GRACE_MS);
    this.#pollMs = positiveDuration(options.pollMs, DEFAULT_POLL_MS);
  }

  get size(): number {
    return this.#entries.size;
  }

  snapshot(): OwnedProcessSnapshot[] {
    return [...this.#entries.values()].map(({ ownerKind, ownerId, pid, processGroupId }) => ({
      ownerKind,
      ownerId,
      pid,
      processGroupId,
    }));
  }

  beginShutdown(): void {
    this.#accepting = false;
  }

  register(registration: OwnedProcessRegistration): () => void {
    if (!this.#accepting) throw new Error("The application is shutting down and cannot start more processes.");
    const pid = registration.child.pid;
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Cannot register an owned process before it has a valid PID.");
    }
    if (this.#entries.has(pid)) throw new Error(`Process ${pid} is already registered.`);

    const processGroupId = registration.isolatedProcessGroup === true && process.platform !== "win32"
      ? pid
      : null;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (this.#entries.get(pid)?.child === registration.child) this.#entries.delete(pid);
      resolveClosed();
    };
    const entry: OwnedProcessEntry = {
      ownerKind: registration.ownerKind,
      ownerId: registration.ownerId,
      child: registration.child,
      pid,
      processGroupId,
      closed,
      release,
    };
    this.#entries.set(pid, entry);
    const releaseAfterGroupExit = () => {
      if (processGroupId == null || !processTargetAlive(-processGroupId)) {
        release();
        return;
      }
      void waitUntilProcessTargetExits(-processGroupId, this.#pollMs).then(release);
    };
    registration.child.once("close", releaseAfterGroupExit);
    registration.child.once("error", releaseAfterGroupExit);
    if (registration.child.exitCode != null || registration.child.signalCode != null) queueMicrotask(releaseAfterGroupExit);
    return release;
  }

  async stopOwner(ownerKind: OwnedProcessKind, ownerId: string): Promise<void> {
    const entries = [...this.#entries.values()].filter(
      (entry) => entry.ownerKind === ownerKind && entry.ownerId === ownerId,
    );
    await Promise.all(entries.map((entry) => this.#stop(entry)));
  }

  async shutdown(): Promise<void> {
    this.beginShutdown();
    const entries = [...this.#entries.values()];
    await Promise.all(entries.map((entry) => this.#stop(entry)));
  }

  #stop(entry: OwnedProcessEntry): Promise<void> {
    const existing = this.#stops.get(entry.pid);
    if (existing) return existing;
    const stopping = this.#stopOnce(entry).finally(() => this.#stops.delete(entry.pid));
    this.#stops.set(entry.pid, stopping);
    return stopping;
  }

  async #stopOnce(entry: OwnedProcessEntry): Promise<void> {
    if (!this.#entries.has(entry.pid) && !targetAlive(entry)) {
      entry.release();
      return;
    }
    signal(entry, "SIGTERM");
    const exitedGracefully = await waitForTargetExit(entry, this.#graceMs, this.#pollMs, entry.closed);
    if (!exitedGracefully) {
      signal(entry, "SIGKILL");
      await waitForTargetExit(entry, this.#graceMs, this.#pollMs, entry.closed);
    }
    entry.release();
  }
}

function signal(entry: OwnedProcessEntry, value: NodeJS.Signals): void {
  try {
    if (entry.processGroupId != null) process.kill(-entry.processGroupId, value);
    else entry.child.kill(value);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

async function waitForTargetExit(
  entry: OwnedProcessEntry,
  timeoutMs: number,
  pollMs: number,
  closed: Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (targetAlive(entry)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await Promise.race([closed, delay(Math.min(pollMs, remaining))]);
  }
  return true;
}

function targetAlive(entry: OwnedProcessEntry): boolean {
  if (entry.processGroupId != null) return processTargetAlive(-entry.processGroupId);
  if (entry.child.exitCode != null || entry.child.signalCode != null) return false;
  return processTargetAlive(entry.pid);
}

function processTargetAlive(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

async function waitUntilProcessTargetExits(target: number, pollMs: number): Promise<void> {
  while (processTargetAlive(target)) await delay(pollMs);
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
