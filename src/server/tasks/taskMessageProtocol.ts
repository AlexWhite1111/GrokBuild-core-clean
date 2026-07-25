import type { TaskEventEnvelope, TaskMessageBlock, TaskMessageProtocolIdentity } from "../../shared/contracts.js";

export function taskMessageProtocol(
  role: TaskMessageBlock["role"],
  event: TaskEventEnvelope,
  turnId: string,
  advertisedMessageId?: string,
  interjection?: boolean,
): TaskMessageProtocolIdentity {
  const payload = record(event.payload);
  const promptExecutionId = text(payload.localTurnId) || turnId;
  const promptId = text(payload.promptId);
  const turnStartMs = integer(payload.turnStartMs);
  const streamStartMs = integer(payload.streamStartMs);
  const promptIndex = integer(payload.promptIndex);
  const nativeMessageId = advertisedMessageId
    || text(payload.messageId)
    || text(payload.blockId)
    || (role === "user" && promptIndex != null
      ? `user-prompt:${promptIndex}`
      : promptId && turnStartMs != null && streamStartMs != null
        ? `${role}:${promptId}:${turnStartMs}:${streamStartMs}:${text(payload.eventId) || event.eventId}`
        : `${role}:${text(payload.eventId) || event.eventId}`);
  return {
    promptExecutionId,
    ...(promptId ? { promptId } : {}),
    ...(turnStartMs != null ? { turnStartMs } : {}),
    ...(streamStartMs != null ? { streamStartMs } : {}),
    messageId: nativeMessageId,
    ...(promptIndex != null ? { promptIndex } : {}),
    ...(interjection === true || payload.interjection === true ? { interjection: true } : {}),
  };
}

export function mergeTaskMessageProtocol(
  current: TaskMessageProtocolIdentity | undefined,
  next: TaskMessageProtocolIdentity,
): TaskMessageProtocolIdentity {
  return {
    ...current,
    ...next,
    promptExecutionId: current?.promptExecutionId || next.promptExecutionId,
    messageId: next.messageId,
    ...(current?.interjection || next.interjection ? { interjection: true } : {}),
  };
}

/** A MessageBlock belongs to one ModelPass even when Grok reuses a messageId. */
export function taskMessageProtocolSegmentKey(
  role: TaskMessageBlock["role"],
  protocol: TaskMessageProtocolIdentity,
): string {
  return [
    role,
    protocol.messageId,
    protocol.promptId || "unscoped",
    protocol.turnStartMs ?? "unscoped",
    protocol.streamStartMs ?? "unscoped",
  ].join("\u001f");
}

/** Chunk events without an advertised messageId share the currently open
 * MessageBlock only while their role and native ModelPass stay the same. */
export function taskMessageProtocolPassKey(
  role: TaskMessageBlock["role"],
  protocol: TaskMessageProtocolIdentity,
): string {
  return [
    role,
    protocol.promptId || "unscoped",
    protocol.turnStartMs ?? "unscoped",
    protocol.streamStartMs ?? "unscoped",
  ].join("\u001f");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
