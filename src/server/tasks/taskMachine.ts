import { createMachine, type SnapshotFrom } from "xstate";
import type { TaskSnapshot } from "../../shared/contracts.js";

export const taskMachine = createMachine({
  id: "task",
  initial: "unloaded",
  states: {
    unloaded: { on: { START: "loading" } },
    loading: { on: { READY: "ready", FAIL: "failed", DISCONNECTED: "recovering" } },
    ready: {
      initial: "idle",
      states: {
        idle: { on: { PROMPT: "running" } },
        running: { on: { CANCEL: "cancelling", TURN_DONE: "idle" } },
        cancelling: { on: { TURN_DONE: "idle" } },
      },
      on: { DISCONNECTED: "recovering", FAIL: "failed" },
    },
    recovering: { on: { RECOVER: "loading", FAIL: "failed" } },
    failed: { on: { RECOVER: "loading" } },
  },
});

export function applyTaskMachineState(snapshot: TaskSnapshot, state: SnapshotFrom<typeof taskMachine>): void {
  if (state.matches("unloaded")) snapshot.connection = "unloaded";
  else if (state.matches("loading")) snapshot.connection = "loading";
  else if (state.matches("recovering")) snapshot.connection = "recovering";
  else if (state.matches("failed")) snapshot.connection = "failed";
  else snapshot.connection = "ready";
  snapshot.turn = state.matches({ ready: "running" })
    ? "running"
    : state.matches({ ready: "cancelling" }) ? "cancelling" : "idle";
}
