import { createHash } from "node:crypto";

interface NativeTurnSignal {
  explicitTurnId?: string;
  promptId?: string;
  turnStartMs?: number;
}

interface NativeTurnResolution {
  /** PromptExecution ID. NativeTurn and ModelPass remain payload coordinates. */
  turnId: string;
  previousTurnId: null;
}

/**
 * Correlates Grok-native coordinates to the submitted PromptExecution without
 * turning every promptId/streamStartMs into a new UI Turn. Interject and tool
 * continuations therefore keep the original local correlation ID; a detached
 * native prompt gets one deterministic PromptExecution of its own.
 */
export class TaskTurnIdentity {
  readonly #executionByNative = new Map<string, string>();
  readonly #bases = new Set<string>();
  readonly #latestByPrompt = new Map<string, string>();
  #latestExecution: string | null = null;
  #pendingInterjectionBase: string | null = null;

  ensureBase(baseTurnId: string): void {
    this.#bases.add(baseTurnId);
  }

  markInterjection(baseTurnId: string): void {
    this.ensureBase(baseTurnId);
    this.#pendingInterjectionBase = baseTurnId;
  }

  resolve(
    connectionEpoch: number,
    signal: NativeTurnSignal,
    baseTurnId: string | null,
  ): NativeTurnResolution | null {
    const keys = nativeTurnKeys(connectionEpoch, signal);
    if (!keys.length && !baseTurnId) return null;
    if (baseTurnId) this.ensureBase(baseTurnId);
    const bound = keys.map((key) => this.#executionByNative.get(key)).find(Boolean);
    const interjectionBase = isInterjectFallbackPromptId(signal.promptId)
      ? this.#pendingInterjectionBase
      : null;
    const turnId = bound || baseTurnId || interjectionBase || derivedExecutionId(connectionEpoch, keys[0]);
    for (const key of keys) this.#executionByNative.set(key, turnId);
    if (signal.promptId) this.#latestByPrompt.set(signal.promptId, turnId);
    this.#latestExecution = turnId;
    if (interjectionBase) this.#pendingInterjectionBase = null;
    return { turnId, previousTurnId: null };
  }

  latestForBase(baseTurnId: string | null | undefined): string | null {
    return baseTurnId && this.#bases.has(baseTurnId) ? baseTurnId : null;
  }

  familyForBase(baseTurnId: string | null | undefined): string[] {
    return baseTurnId && this.#bases.has(baseTurnId) ? [baseTurnId] : [];
  }

  latestForPrompt(promptId: string | null | undefined): string | null {
    return promptId ? this.#latestByPrompt.get(promptId) || null : null;
  }

  latest(): string | null {
    return this.#latestExecution;
  }

  beginConnectionEpoch(): void {
    this.#latestByPrompt.clear();
    this.#latestExecution = null;
    this.#pendingInterjectionBase = null;
  }
}

function isInterjectFallbackPromptId(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("interject-fallback-"));
}

export function nativeTurnSignal(payload: Record<string, unknown>): NativeTurnSignal {
  const explicitTurnId = safeText(payload.turnId);
  const promptId = safeText(payload.promptId);
  const turnStartMs = safeTurnStart(payload.turnStartMs);
  return {
    ...(explicitTurnId ? { explicitTurnId } : {}),
    ...(promptId ? { promptId } : {}),
    ...(turnStartMs != null ? { turnStartMs } : {}),
  };
}

export function hasNativeTurnSignal(signal: NativeTurnSignal): boolean {
  return Boolean(signal.explicitTurnId || (signal.promptId && signal.turnStartMs != null));
}

function nativeTurnKeys(connectionEpoch: number, signal: NativeTurnSignal): string[] {
  const keys: string[] = [];
  if (signal.explicitTurnId) keys.push(`${connectionEpoch}:turn:${signal.explicitTurnId}`);
  if (signal.promptId && signal.turnStartMs != null) keys.push(`${connectionEpoch}:prompt:${signal.promptId}:start:${signal.turnStartMs}`);
  return keys;
}

function derivedExecutionId(connectionEpoch: number, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `execution:${connectionEpoch}:${digest}`;
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function safeTurnStart(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
