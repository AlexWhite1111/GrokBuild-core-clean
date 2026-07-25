import { randomUUID } from "node:crypto";
import type { ComposerReplayDocument, PathReferenceSummary } from "../../shared/contracts.js";
import type { PromptEchoQueue } from "./PromptEchoQueue.js";
import type { TaskRuntimeProjection as TaskProjection } from "./TaskRuntimeProjection.js";
import { promptPreview, titleFromPrompt } from "./taskGates.js";

export function preparePromptProjection(options: {
  projection: TaskProjection;
  echoes: PromptEchoQueue;
  requestId: string;
  displayPrompt: string;
  paths: PathReferenceSummary[];
  composerDocument?: ComposerReplayDocument;
  queued: boolean;
}): string {
  const { projection, echoes, requestId, displayPrompt, paths, composerDocument, queued } = options;
  const turnId = randomUUID();
  projection.snapshot.title = projection.snapshot.title === "New Task"
    ? titleFromPrompt(titlePrompt(displayPrompt, paths))
    : projection.snapshot.title;
  if (!queued) {
    projection.addLocalUserMessage(displayPrompt, turnId, requestId, paths, composerDocument);
    echoes.add(requestId, turnId, { composerDocument });
    return turnId;
  }
  echoes.add(requestId, turnId, { localMessage: false, displayText: displayPrompt, paths, composerDocument });
  projection.snapshot.queue.entries.push({
    entryId: null,
    requestId,
    textPreview: promptPreview(displayPrompt),
    version: null,
    position: null,
    createdAt: new Date().toISOString(),
  });
  projection.snapshot.activities.waiting += 1;
  projection.touch();
  return turnId;
}

function titlePrompt(displayPrompt: string, paths: PathReferenceSummary[]): string {
  let title = displayPrompt;
  for (const path of paths) title = title.split(path.serializedPath).join(" ");
  return title.replace(/\s+/g, " ").trim() || displayPrompt;
}
