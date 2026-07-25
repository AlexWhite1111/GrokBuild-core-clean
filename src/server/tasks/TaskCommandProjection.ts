import type { TaskSnapshot } from "../../shared/contracts.js";

interface CommandTurn {
  name: string;
  input: string;
  output: string;
  lastBlockId: string | null;
  showOutput: boolean;
}

export interface CommandFinishOutcome {
  state: "confirmed" | "failed";
  message: string | null;
}

export class TaskCommandProjection {
  readonly #turns = new Map<string, CommandTurn>();

  begin(
    snapshot: TaskSnapshot,
    turnId: string,
    requestId: string,
    name: string,
    input: string,
    showOutput = false,
  ): void {
    this.#turns.set(turnId, {
      name,
      input,
      output: "",
      lastBlockId: null,
      showOutput,
    });
    snapshot.commands.execution = {
      requestId,
      name,
      state: "pending",
      message: null,
    };
  }

  observeMessage(
    turnId: string,
    role: "assistant" | "thought",
    blockId: string,
    text: string,
  ): boolean {
    const command = this.#turns.get(turnId);
    if (!command) return false;
    if (role === "assistant" && text) {
      if (
        command.output &&
        command.lastBlockId &&
        command.lastBlockId !== blockId
      )
        command.output += "\n";
      command.output += text;
      command.lastBlockId = blockId;
    }
    return !command.showOutput;
  }

  finish(
    snapshot: TaskSnapshot,
    turnId: string,
    requestId: string,
    name: string,
    error?: string,
  ): CommandFinishOutcome {
    const state: CommandFinishOutcome["state"] = error ? "failed" : "confirmed";
    const message = error || null;
    if (snapshot.commands.execution?.requestId === requestId) {
      snapshot.commands.execution = { requestId, name, state, message };
    }
    this.#turns.delete(turnId);
    return { state, message };
  }
}
