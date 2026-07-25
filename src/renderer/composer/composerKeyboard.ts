export type ComposerSubmitIntent = "send" | "queue" | "interject";

function composerEnterIntent(busy: boolean, queueAvailable: boolean): "send" | "queue" | null {
  if (!busy) return "send";
  return queueAvailable ? "queue" : null;
}

export function composerShortcutIntent(commandKey: boolean, busy: boolean, queueAvailable: boolean, interjectAvailable: boolean): ComposerSubmitIntent | null {
  if (commandKey) return busy ? interjectAvailable ? "interject" : null : "send";
  return composerEnterIntent(busy, queueAvailable);
}

export function composerActionVisibility(busy: boolean, hasDraft: boolean, queueAvailable: boolean, interjectAvailable: boolean) {
  return { send: !busy, stop: busy, queue: busy && hasDraft && queueAvailable, interject: busy && hasDraft && interjectAvailable };
}
