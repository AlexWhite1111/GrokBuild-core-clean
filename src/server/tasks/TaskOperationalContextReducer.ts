import {
  projectTaskOperationalContext,
  type TaskEventEnvelope,
  type TaskOperationalContextSnapshot,
} from "../../shared/contracts.js";

const PARENT_TEXT_METHODS = new Set([
  "session/update:agent_message_chunk",
  "session/update:agent_thought_chunk",
  "session/update:user_message_chunk",
  "task/user_message",
  "task/user_message_delivery",
  "task/user_message_dispatched",
  "task/user_message_protocol",
]);

/**
 * Keeps a sparse semantic event stream and only invokes the compatibility
 * projector when operational context can actually change. Raw parent text is
 * never retained here and therefore cannot make context work grow per token.
 */
export class TaskOperationalContextReducer {
  readonly #events: TaskEventEnvelope[] = [];
  #snapshot: TaskOperationalContextSnapshot = emptyContext();
  #dirty = false;
  #recomputeCount = 0;

  get semanticEventCount(): number {
    return this.#events.length;
  }

  get recomputeCount(): number {
    return this.#recomputeCount;
  }

  observe(event: TaskEventEnvelope): boolean {
    if (!affectsOperationalContext(event)) return false;
    this.#events.push(sparseEvent(event));
    this.#dirty = true;
    return true;
  }

  restore(events: readonly TaskEventEnvelope[]): void {
    this.#events.length = 0;
    for (const event of events) {
      if (affectsOperationalContext(event)) this.#events.push(sparseEvent(event));
    }
    this.#snapshot = projectTaskOperationalContext(this.#events);
    this.#dirty = false;
    this.#recomputeCount += 1;
  }

  snapshot(): TaskOperationalContextSnapshot {
    if (!this.#dirty) return this.#snapshot;
    this.#snapshot = projectTaskOperationalContext(this.#events);
    this.#dirty = false;
    this.#recomputeCount += 1;
    return this.#snapshot;
  }
}

function affectsOperationalContext(event: TaskEventEnvelope): boolean {
  return !PARENT_TEXT_METHODS.has(event.method);
}

function sparseEvent(event: TaskEventEnvelope): TaskEventEnvelope {
  if (!event.method.startsWith("child/session/update:")) return structuredClone(event);
  const payload = record(structuredClone(event.payload));
  delete payload.text;
  return { ...structuredClone(event), payload };
}

function emptyContext(): TaskOperationalContextSnapshot {
  return { currentTodo: null, activeWork: [], history: [] };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
