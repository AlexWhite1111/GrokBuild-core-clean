import type {
  PathReferenceKind,
  PathReferenceSummary,
  SavedContextResource,
  TaskDetailProjection,
  TaskMediaAttachment,
  WorkItemSnapshot,
} from "../../shared/contracts.js";

export interface ContextResourceItem {
  id: string;
  name: string;
  detail: string;
  kind: PathReferenceKind | "audio" | "video";
  valid: boolean;
  createdAt: string;
  path?: PathReferenceSummary;
  media?: TaskMediaAttachment;
}

export interface TaskContextProjection {
  currentTodo: TaskDetailProjection["context"]["currentTodo"];
  activeWork: WorkItemSnapshot[];
  history: TaskDetailProjection["context"]["history"];
  inputs: ContextResourceItem[];
  artifacts: ContextResourceItem[];
}

export function projectTaskContext(detail: TaskDetailProjection, savedResources: SavedContextResource[] = []): TaskContextProjection {
  return { ...detail.context, ...projectResources(detail, savedResources) };
}

function projectResources(detail: TaskDetailProjection, savedResources: SavedContextResource[]): Pick<TaskContextProjection, "inputs" | "artifacts"> {
  const inputs = new Map<string, ContextResourceItem>();
  const artifacts = new Map<string, ContextResourceItem>();
  const pathKeys = new Map<string, string>();
  const addPath = (path: PathReferenceSummary, createdAt: string, preserve = false) => {
    const key = pathIdentity(path);
    const existing = inputs.get(key);
    inputs.set(key, {
      id: key,
      name: preserve && existing ? existing.name : path.name,
      detail: preserve && existing ? existing.detail : path.displayPath,
      kind: preserve && existing ? existing.kind : path.kind,
      valid: preserve && existing ? existing.valid : path.valid !== false,
      createdAt: existing && existing.createdAt < createdAt ? existing.createdAt : createdAt,
      path: preserve && existing?.path ? existing.path : path,
      media: existing?.media,
    });
    if (path.refId) pathKeys.set(path.refId, key);
  };
  savedResources.forEach((resource) => addPath(resource.path, resource.addedAt));
  for (const message of detail.messages) {
    if (message.role === "user") for (const path of message.paths || []) addPath(path, message.createdAt, true);
    for (const media of message.media || []) {
      const inputKey = media.pathRefId ? pathKeys.get(media.pathRefId) : undefined;
      if (message.role === "user" && inputKey) {
        const current = inputs.get(inputKey);
        if (current) inputs.set(inputKey, { ...current, media });
        continue;
      }
      const target = message.role === "user" ? inputs : artifacts;
      const id = `media:${media.mediaId}`;
      if (!target.has(id)) target.set(id, { id, name: media.name, detail: media.mimeType, kind: media.kind, valid: true, createdAt: message.createdAt, media });
    }
  }
  return { inputs: [...inputs.values()].sort(resourceTime), artifacts: [...artifacts.values()].sort(resourceTime) };
}

function pathIdentity(path: PathReferenceSummary): string { return `path:${path.withinProject ? "project" : "external"}:${path.displayPath}`; }
function resourceTime(left: ContextResourceItem, right: ContextResourceItem): number { return left.createdAt.localeCompare(right.createdAt); }
