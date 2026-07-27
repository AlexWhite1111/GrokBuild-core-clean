import type { TaskSnapshot } from "../../shared/contracts.js";
import { asRecord, string } from "./taskEventSanitizers.js";

type AvailableCommands = TaskSnapshot["commands"]["available"];

function commandList(value: unknown): AvailableCommands {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((entry) => {
    const command = asRecord(entry);
    const name = string(command.name);
    if (!name || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(name)) return [];
    return [{
      name,
      description: (string(command.description) || name).slice(0, 500),
      inputHint: string(asRecord(command.input).hint)?.slice(0, 300) || null,
    }];
  });
}

export function applyAvailableCommands(snapshot: TaskSnapshot, value: unknown): boolean {
  const next = commandList(value);
  if (sameCommands(snapshot.commands.available, next)) return false;
  snapshot.commands.available = next;
  return true;
}

export function availableCommandsKey(value: unknown): string {
  return JSON.stringify(commandList(value));
}

function sameCommands(left: AvailableCommands, right: AvailableCommands): boolean {
  return left.length === right.length && left.every((command, index) => {
    const other = right[index];
    return command.name === other?.name
      && command.description === other.description
      && command.inputHint === other.inputHint;
  });
}
