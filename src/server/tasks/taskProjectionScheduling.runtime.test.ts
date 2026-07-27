import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskProjectionFrameScheduler,
  type PendingTaskProjectionChange,
} from "./taskProjectionScheduling.js";

test("a same-burst full response fast-forwards to one latest structural frame", () => {
  const clock = new FakeClock();
  const published: Array<{ at: number; change: PendingTaskProjectionChange }> = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push({ at: clock.now(), change }),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  scheduler.enqueue("text");
  scheduler.enqueue("text");
  scheduler.enqueue("delta");

  assert.deepEqual(published, []);
  clock.advance(0);
  assert.deepEqual(published, [{ at: 0, change: "delta" }]);
  clock.advance(1_000);
  assert.equal(published.length, 1);
});

test("the one-second setting keeps one pending latest text frame instead of a replay queue", () => {
  const clock = new FakeClock();
  const published: Array<{ at: number; change: PendingTaskProjectionChange }> = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push({ at: clock.now(), change }),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  scheduler.enqueue("text");
  clock.advance(49);
  scheduler.enqueue("text");
  assert.deepEqual(published, []);
  clock.advance(1);
  assert.deepEqual(published, [{ at: 50, change: "text" }]);

  clock.advance(50);
  scheduler.enqueue("text");
  clock.advance(200);
  scheduler.enqueue("text");
  clock.advance(749);
  assert.equal(published.length, 1);
  clock.advance(1);
  assert.deepEqual(published, [
    { at: 50, change: "text" },
    { at: 1_050, change: "text" },
  ]);
});

test("completion and interaction state bypass a pending slow text cadence", () => {
  const clock = new FakeClock();
  const published: Array<{ at: number; change: PendingTaskProjectionChange }> = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push({ at: clock.now(), change }),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  scheduler.enqueue("text");
  clock.advance(50);
  clock.advance(50);
  scheduler.enqueue("text");
  clock.advance(100);
  scheduler.enqueue("delta");
  clock.advance(0);

  assert.deepEqual(published, [
    { at: 50, change: "text" },
    { at: 200, change: "delta" },
  ]);
  clock.advance(1_000);
  assert.equal(published.length, 2);
});

test("an unclassified change promotes pending text to one full snapshot", () => {
  const clock = new FakeClock();
  const published: PendingTaskProjectionChange[] = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push(change),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  scheduler.enqueue("text");
  scheduler.enqueue();
  clock.advance(0);

  assert.deepEqual(published, ["snapshot"]);
});

test("a ten-thousand-update backlog creates one timer and one display frame", () => {
  const clock = new FakeClock();
  const published: PendingTaskProjectionChange[] = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push(change),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  for (let index = 0; index < 10_000; index += 1) scheduler.enqueue("text");

  assert.equal(clock.scheduleCount, 1);
  assert.deepEqual(published, []);
  clock.advance(50);
  assert.deepEqual(published, ["text"]);
});

test("a structural backlog also keeps one next-tick timer", () => {
  const clock = new FakeClock();
  const published: PendingTaskProjectionChange[] = [];
  const scheduler = new TaskProjectionFrameScheduler({
    intervalMs: () => 1_000,
    publish: (change) => published.push(change),
    now: () => clock.now(),
    schedule: clock.schedule,
  });

  for (let index = 0; index < 10_000; index += 1) scheduler.enqueue("delta");

  assert.equal(clock.scheduleCount, 1);
  clock.advance(0);
  assert.deepEqual(published, ["delta"]);
});

class FakeClock {
  #now = 0;
  #order = 0;
  scheduleCount = 0;
  readonly #timers: Array<{
    at: number;
    callback: () => void;
    cancelled: boolean;
    order: number;
  }> = [];

  readonly schedule = (callback: () => void, delayMs: number): (() => void) => {
    this.scheduleCount += 1;
    const timer = {
      at: this.#now + delayMs,
      callback,
      cancelled: false,
      order: this.#order++,
    };
    this.#timers.push(timer);
    return () => { timer.cancelled = true; };
  };

  now(): number {
    return this.#now;
  }

  advance(durationMs: number): void {
    const target = this.#now + durationMs;
    while (true) {
      const timer = this.#timers
        .filter((candidate) => !candidate.cancelled && candidate.at <= target)
        .sort((left, right) => left.at - right.at || left.order - right.order)[0];
      if (!timer) break;
      timer.cancelled = true;
      this.#now = timer.at;
      timer.callback();
    }
    this.#now = target;
  }
}
