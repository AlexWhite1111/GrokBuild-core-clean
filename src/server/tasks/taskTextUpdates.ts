const SESSION_TEXT_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
]);

/** Text chunks belong to their official Session transcript, not operational context. */
export function isSessionTextUpdate(value: string | null | undefined): boolean {
  return Boolean(value && SESSION_TEXT_UPDATES.has(value));
}
