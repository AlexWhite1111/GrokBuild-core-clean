import type {
  ComposerReplayDocument,
  PathReferenceSummary,
  TaskDetailProjection,
  TaskMessageBlock,
  TaskSnapshot,
  WorkItemSnapshot,
} from "../../shared/contracts.js";
import { composerInput, composerPaths, composerText, restoreReplayDocument } from "../composer/composerDocument.js";

export type PermissionRequest = (
  { name: string; input: string }
) & { target: TaskSnapshot["permission"]["effective"] };

export type MainTaskView =
  | { kind: "thread" }
  | { kind: "plan" }
  | { kind: "systemPrompt" }
  | { kind: "child"; item: WorkItemSnapshot };

export function taskPageError(
  local: string | null,
  snapshotError: TaskSnapshot["error"],
): string | null {
  if (local) return local;
  if (!snapshotError) return null;
  return snapshotError.message;
}

export async function retryInputFromMessage(message: TaskMessageBlock, requestId: string, projectId?: string) {
  const document = replayDocumentFromMessage(message);
  const nodes = await restoreReplayDocument(document, (paths) => window.grokDesktop
    ? window.grokDesktop.restorePaths(paths, projectId)
    : Promise.resolve(paths.map((path) => ({ ...path, valid: false }))));
  const prompt = composerText(nodes) || "请查看这些路径。";
  return {
    requestId,
    prompt,
    paths: composerPaths(nodes).map(({ refId }) => ({ refId })),
    document: composerInput(nodes),
  };
}

export function replayDocumentFromMessage(message: TaskMessageBlock): ComposerReplayDocument {
  return message.composerDocument || {
    version: 1,
    nodes: [{ type: "text", text: message.text || "请查看这些路径。" }],
  };
}

export function permissionCommand(
  current: TaskSnapshot["permission"]["effective"],
  next: TaskSnapshot["permission"]["effective"],
  modes: TaskSnapshot["permission"]["modes"],
): { name: "always-approve"; input: "on" | "off" } | null {
  const target = modes.find((mode) => mode.mode === next);
  if (!target?.available || !target.hotSwitch) return null;
  if (next === "alwaysApprove") {
    return { name: "always-approve", input: "on" };
  }
  if (current === "alwaysApprove" && (next === "ask" || next === "acceptEdits" || next === "dontAsk")) {
    return { name: "always-approve", input: "off" };
  }
  return null;
}

export function currentWorkItem(detail: TaskDetailProjection, fallback: WorkItemSnapshot): WorkItemSnapshot {
  return (
    [
      ...detail.context.activeWork,
      ...detail.context.history.flatMap((entry) => entry.kind === "work" ? [entry.work] : []),
    ].find((item) => item.id === fallback.id) || fallback
  );
}

export function workStopMethod(kind: WorkItemSnapshot["kind"]): string | null {
  return kind === "agent" ? null : kind === "loop" ? "x.ai/scheduler/delete" : "x.ai/task/kill";
}

export function pathIdentity(path: Pick<PathReferenceSummary, "withinProject" | "displayPath">): string {
  return `${path.withinProject ? "project" : "external"}:${path.displayPath}`;
}
