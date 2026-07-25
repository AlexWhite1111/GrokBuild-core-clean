const SYSTEM_REMINDER_OPEN = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";

/**
 * Grok emits its own reminder turns through ACP's user-message channel. They
 * are transport control input, not user-authored conversation. Remove only
 * complete leading reminder blocks; ordinary remote user text is untouched.
 */
export function visibleRemoteUserText(value: string): string | null {
  let offset = 0;
  let removed = false;
  while (value.startsWith(SYSTEM_REMINDER_OPEN, offset)) {
    const close = value.indexOf(SYSTEM_REMINDER_CLOSE, offset + SYSTEM_REMINDER_OPEN.length);
    if (close < 0) break;
    offset = close + SYSTEM_REMINDER_CLOSE.length;
    removed = true;
    while (value[offset] === "\r" || value[offset] === "\n") offset += 1;
  }
  if (!removed) return value;
  const remainder = value.slice(offset);
  return remainder.trim().length ? remainder : null;
}
