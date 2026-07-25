import type {
  PathReferenceSummary,
  SavedContextResource,
} from "../../shared/contracts.js";
import type { PathReferenceStore } from "../security/PathReferenceStore.js";
import { AppProblem } from "../security/problemResponse.js";

const MAX_TRANSPORT_PROMPT = 200_000;

export interface ResolvedComposerPrompt {
  transportPrompt: string;
  displayPrompt: string;
  paths: PathReferenceSummary[];
  composerDocument: import("../../shared/contracts.js").ComposerReplayDocument;
}

export function appendPersistentTaskContext(
  base: ResolvedComposerPrompt,
  resources: SavedContextResource[],
  projectPath: string,
  references: PathReferenceStore,
): ResolvedComposerPrompt {
  const explicit = new Set(base.paths.map(pathIdentity));
  const seen = new Set<string>();
  const context = resources.flatMap((resource) => {
    const restored = references.restoreSaved(resource.path, projectPath);
    const key = pathIdentity(restored);
    if (explicit.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [restored];
  });
  if (!context.length) return base;
  const contextBlock = [
    "<context_resources>",
    "The user selected these persistent task resources. Use them as context when relevant:",
    ...context.map((item) => item.serializedPath),
    "</context_resources>",
  ].join("\n");
  const transportPrompt = `${base.transportPrompt}\n\n${contextBlock}`;
  if (transportPrompt.length > MAX_TRANSPORT_PROMPT) {
    throw new AppProblem(400, "VALIDATION_FAILED", "The prompt and persistent Context resources exceed the transport limit.");
  }
  return { ...base, transportPrompt };
}

function pathIdentity(path: Pick<PathReferenceSummary, "withinProject" | "displayPath">): string {
  return `${path.withinProject ? "project" : "external"}:${path.displayPath}`;
}
