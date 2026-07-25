import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { OwnedProcessRegistry } from "./OwnedProcessRegistry.js";

test("stopping one owner reaps its proven process group and preserves an unrelated process", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX process-group behavior is covered on macOS and Linux.");
    return;
  }

  const registry = new OwnedProcessRegistry({ graceMs: 400, pollMs: 10 });
  const sibling = sleepingProcess(true);
  const owner = spawn(process.execPath, ["-e", parentWithSleepingChildSource()], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const descendantPid = await firstPid(owner);

  try {
    registry.register({
      ownerKind: "task",
      ownerId: "fixture-task",
      child: owner,
      isolatedProcessGroup: true,
    });

    assert.equal(registry.size, 1);
    assert.equal(isAlive(owner.pid), true);
    assert.equal(isAlive(descendantPid), true);
    assert.equal(isAlive(sibling.pid), true);

    await registry.stopOwner("task", "fixture-task");

    await waitUntilDead(owner.pid);
    await waitUntilDead(descendantPid);
    assert.equal(isAlive(sibling.pid), true);
    assert.equal(registry.size, 0);
  } finally {
    await terminateFixture(sibling, true);
    await terminateFixture(owner, true);
    await registry.shutdown();
  }
});

test("natural exits unregister without requiring shutdown", async () => {
  const registry = new OwnedProcessRegistry({ graceMs: 200, pollMs: 10 });
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10)"], {
    stdio: "ignore",
  });
  registry.register({ ownerKind: "run", ownerId: "natural", child });

  await once(child, "close");
  await waitFor(() => registry.size === 0);

  assert.equal(registry.size, 0);
});

function sleepingProcess(detached: boolean): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached,
    stdio: "ignore",
  });
}

function parentWithSleepingChildSource(): string {
  return [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "console.log(child.pid);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

async function firstPid(child: ChildProcess): Promise<number> {
  assert.ok(child.stdout);
  let buffered = "";
  for await (const chunk of child.stdout) {
    buffered += chunk.toString("utf8");
    const match = /^(\d+)\s*$/m.exec(buffered);
    if (match) return Number(match[1]);
  }
  throw new Error("Fixture parent exited before reporting its child PID.");
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number | undefined): Promise<void> {
  await waitFor(() => !isAlive(pid));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for fixture process state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function terminateFixture(child: ChildProcess, group: boolean): Promise<void> {
  if (!child.pid || !isAlive(child.pid)) return;
  try {
    if (group && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    // The fixture may have exited between the liveness check and the signal.
  }
  await Promise.race([
    once(child, "close").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
}
