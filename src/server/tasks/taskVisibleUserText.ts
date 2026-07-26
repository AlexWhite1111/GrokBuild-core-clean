const SYSTEM_REMINDER_OPEN = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";
const INTERJECTION_PREFIX = "The user sent a message while you were working:";
const USER_QUERY_OPEN = "<user_query>";
const USER_QUERY_CLOSE = "</user_query>";

/**
 * Grok emits its own reminder turns through ACP's user-message channel. They
 * are transport control input, not user-authored conversation. Remove only
 * complete leading reminder blocks; ordinary remote user text is untouched.
 */
export function visibleRemoteUserText(value: string, hideFromScrollback = false): string | null {
  if (hideFromScrollback) return null;
  let offset = 0;
  let removed = false;
  while (value.startsWith(SYSTEM_REMINDER_OPEN, offset)) {
    const close = value.indexOf(SYSTEM_REMINDER_CLOSE, offset + SYSTEM_REMINDER_OPEN.length);
    if (close < 0) break;
    offset = close + SYSTEM_REMINDER_CLOSE.length;
    removed = true;
    while (value[offset] === "\r" || value[offset] === "\n") offset += 1;
  }
  const remainder = removed ? value.slice(offset) : value;
  const visible = unwrapInterjection(remainder);
  return visible.trim().length ? visible : null;
}

function unwrapInterjection(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith(INTERJECTION_PREFIX)) return value;
  const queryStart = trimmed.indexOf(USER_QUERY_OPEN, INTERJECTION_PREFIX.length);
  const queryEnd = trimmed.lastIndexOf(USER_QUERY_CLOSE);
  if (
    queryStart < 0
    || queryEnd < queryStart
    || trimmed.slice(queryEnd + USER_QUERY_CLOSE.length).trim()
  ) return value;
  return trimmed
    .slice(queryStart + USER_QUERY_OPEN.length, queryEnd)
    .trim();
}
