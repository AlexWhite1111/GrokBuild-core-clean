import type { InitializeResponse } from "@agentclientprotocol/sdk";

type XaiAvailability = "advertised" | "probed" | "unavailable" | "policyLocked";
export type XaiMethodKind = "request" | "notification" | "reverseRequest" | "event";

export interface XaiMethodDescriptor {
  method: XaiMethod;
  kind: XaiMethodKind;
  sideEffect: "none" | "read" | "write";
  availability: XaiAvailability;
  reason?: string;
}

export const XAI_METHODS = {
  queueChanged: "x.ai/queue/changed",
  queueRemove: "x.ai/queue/remove",
  queueReorder: "x.ai/queue/reorder",
  queueEdit: "x.ai/queue/edit",
  queueInterject: "x.ai/queue/interject",
  queueClear: "x.ai/queue/clear",
  interject: "x.ai/interject",
  askUserQuestion: "x.ai/ask_user_question",
  exitPlanMode: "x.ai/exit_plan_mode",
  promptComplete: "x.ai/session/prompt_complete",
  sessionInterjection: "x.ai/session/interjection",
  sessionNotification: "x.ai/session_notification",
  sessionUpdate: "x.ai/session/update",
  sessionsList: "x.ai/sessions/list",
  sessionsChanged: "x.ai/sessions/changed",
  settingsUpdate: "x.ai/settings/update",
  yoloModeChanged: "x.ai/yolo_mode_changed",
  fsNotify: "x.ai/fs_notify",
  fsIndex: "x.ai/fs/index",
  fsIndexDelta: "x.ai/fs/index/delta",
  fuzzyStatus: "x.ai/search/fuzzy/status",
  worktreeStatus: "x.ai/git/worktree/status",
  gitStatus: "x.ai/git/status",
  gitDiffs: "x.ai/git/diffs",
  gitStage: "x.ai/git/stage",
  gitDiscard: "x.ai/git/discard",
  worktreeList: "x.ai/git/worktree/list",
  worktreeCreate: "x.ai/git/worktree/create",
  worktreeApply: "x.ai/git/worktree/apply",
  worktreeRemove: "x.ai/git/worktree/remove",
  worktreeGc: "x.ai/git/worktree/gc",
  promptHistory: "x.ai/prompt_history",
  compactConversation: "x.ai/compact_conversation",
  rewindPoints: "x.ai/rewind/points",
  rewindExecute: "x.ai/rewind/execute",
  sessionFork: "x.ai/session/fork",
  taskKill: "x.ai/task/kill",
  schedulerDelete: "x.ai/scheduler/delete",
} as const;

export type XaiMethod = (typeof XAI_METHODS)[keyof typeof XAI_METHODS];

const DEFINITIONS: ReadonlyArray<Omit<XaiMethodDescriptor, "availability">> = [
  { method: XAI_METHODS.queueChanged, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.queueRemove, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.queueReorder, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.queueEdit, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.queueInterject, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.queueClear, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.interject, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.askUserQuestion, kind: "reverseRequest", sideEffect: "none" },
  { method: XAI_METHODS.exitPlanMode, kind: "reverseRequest", sideEffect: "none" },
  { method: XAI_METHODS.promptComplete, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.sessionInterjection, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.sessionNotification, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.sessionUpdate, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.sessionsList, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.sessionsChanged, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.settingsUpdate, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.yoloModeChanged, kind: "notification", sideEffect: "write" },
  { method: XAI_METHODS.fsNotify, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.fsIndex, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.fsIndexDelta, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.fuzzyStatus, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.worktreeStatus, kind: "event", sideEffect: "none" },
  { method: XAI_METHODS.gitStatus, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.gitDiffs, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.gitStage, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.gitDiscard, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.worktreeList, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.worktreeCreate, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.worktreeApply, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.worktreeRemove, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.worktreeGc, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.promptHistory, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.compactConversation, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.rewindPoints, kind: "request", sideEffect: "read" },
  { method: XAI_METHODS.rewindExecute, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.sessionFork, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.taskKill, kind: "request", sideEffect: "write" },
  { method: XAI_METHODS.schedulerDelete, kind: "request", sideEffect: "write" },
];

const GROK_SHELL_EXTENSION_CONTRACT: readonly XaiMethod[] = [
  XAI_METHODS.queueChanged,
  XAI_METHODS.queueRemove,
  XAI_METHODS.queueReorder,
  XAI_METHODS.queueEdit,
  XAI_METHODS.queueInterject,
  XAI_METHODS.queueClear,
  XAI_METHODS.interject,
  XAI_METHODS.sessionInterjection,
  XAI_METHODS.sessionsList,
  XAI_METHODS.yoloModeChanged,
];

/** Introduced and verified in Grok 0.2.103. Patch releases in the same 0.2
 * protocol line retain these requests even though initialize does not
 * advertise them individually. A new minor line must be verified explicitly. */
const GROK_SHELL_PROBED_CONTRACT: readonly XaiMethod[] = [
  XAI_METHODS.rewindPoints,
  XAI_METHODS.rewindExecute,
  XAI_METHODS.sessionFork,
];

export class XaiMethodRegistry {
  readonly #methods = new Map<XaiMethod, XaiMethodDescriptor>(
    DEFINITIONS.map((definition) => [definition.method, { ...definition, availability: "unavailable" }]),
  );

  applyInitialize(response: InitializeResponse): void {
    const advertised = collectAdvertisedMethods(response);
    for (const method of advertised) {
      if (this.#methods.has(method as XaiMethod)) this.observe(method as XaiMethod, "advertised");
    }
    if (readMetaBoolean(response.agentCapabilities?._meta, "x.ai/fs_notify")) {
      this.observe(XAI_METHODS.fsNotify, "advertised");
    }
    const meta = response._meta as Record<string, unknown> | undefined;
    if (meta?.grokShell === true) {
      for (const method of GROK_SHELL_EXTENSION_CONTRACT) this.observe(method, "probed");
      if (supportsGrokShellHistory(meta.agentVersion)) {
        for (const method of GROK_SHELL_PROBED_CONTRACT) this.observe(method, "probed");
      }
    }
  }

  observe(
    method: XaiMethod,
    availability: "advertised" | "probed" = "probed",
    kind?: Exclude<XaiMethodKind, "event">,
  ): void {
    const current = this.#methods.get(method);
    if (!current || current.availability === "policyLocked") return;
    const resolvedAvailability = current.availability === "advertised" ? "advertised" : availability;
    this.#methods.set(method, {
      ...current,
      ...(kind ? { kind } : {}),
      availability: resolvedAvailability,
      reason: undefined,
    });
  }

  unavailable(method: XaiMethod, reason: string): void {
    const current = this.#methods.get(method);
    if (!current || current.availability === "policyLocked") return;
    this.#methods.set(method, { ...current, availability: "unavailable", reason });
  }

  lock(method: XaiMethod, reason: string): void {
    const current = this.#methods.get(method);
    if (current) this.#methods.set(method, { ...current, availability: "policyLocked", reason });
  }

  require(method: XaiMethod, kind?: XaiMethodKind): XaiMethodDescriptor {
    const descriptor = this.#methods.get(method);
    if (!descriptor || (kind && descriptor.kind !== kind)) throw new Error(`Unknown x.ai method: ${method}`);
    if (descriptor.availability !== "advertised" && descriptor.availability !== "probed") {
      throw new Error(descriptor.reason || `x.ai method is unavailable: ${method}`);
    }
    return descriptor;
  }

  canProbe(method: XaiMethod): boolean {
    const descriptor = this.#methods.get(method);
    return descriptor?.kind === "request" && descriptor.sideEffect === "read";
  }

  snapshot(): XaiMethodDescriptor[] {
    return [...this.#methods.values()].map((descriptor) => ({ ...descriptor }));
  }
}

function supportsGrokShellHistory(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major === 0 && minor === 2 && patch >= 103;
}

function collectAdvertisedMethods(value: unknown, found = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || value == null) return found;
  if (typeof value === "string") {
    if (/^_?x\.ai\//.test(value)) found.add(value.replace(/^_x\.ai\//, "x.ai/"));
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAdvertisedMethods(item, found, depth + 1);
    return found;
  }
  if (typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^_?x\.ai\//.test(key) && child === true) found.add(key.replace(/^_x\.ai\//, "x.ai/"));
    collectAdvertisedMethods(child, found, depth + 1);
  }
  return found;
}

function readMetaBoolean(meta: Record<string, unknown> | null | undefined, key: string): boolean {
  return meta?.[key] === true;
}
