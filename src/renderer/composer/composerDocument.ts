import type { ComposerInputDocument, ComposerReplayDocument, PathReferenceSummary } from "../../shared/contracts.js";

export type ComposerNode =
  | { type: "text"; text: string }
  | { type: "path"; path: PathReferenceSummary };

interface DraftDocumentV2 {
  version: 2;
  nodes: ComposerNode[];
}

interface LegacyDraftDocument {
  version: 1;
  text: string;
  paths: PathReferenceSummary[];
}

export function textNodes(text: string): ComposerNode[] {
  return text ? [{ type: "text", text }] : [];
}

export function normalizeComposerNodes(nodes: ComposerNode[]): ComposerNode[] {
  const normalized: ComposerNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (!node.text) continue;
      const previous = normalized.at(-1);
      if (previous?.type === "text") previous.text += node.text;
      else normalized.push({ type: "text", text: node.text });
    } else normalized.push({ type: "path", path: node.path });
  }
  return normalized;
}

export function composerText(nodes: ComposerNode[]): string {
  return transportComposerNodes(nodes).map((node) => node.type === "text" ? node.text : node.path.serializedPath).join("");
}

export function composerPaths(nodes: ComposerNode[]): PathReferenceSummary[] {
  const seen = new Set<string>();
  return nodes.flatMap((node) => {
    if (node.type !== "path" || seen.has(node.path.refId)) return [];
    seen.add(node.path.refId);
    return [node.path];
  });
}

export function composerHasContent(nodes: ComposerNode[]): boolean {
  return nodes.some((node) => node.type === "path" || node.text.trim().length > 0);
}

export function composerInput(nodes: ComposerNode[]): ComposerInputDocument {
  return {
    version: 1,
    nodes: normalizeComposerNodes(nodes).map((node) => node.type === "text"
      ? { type: "text" as const, text: node.text }
      : { type: "path" as const, refId: node.path.refId }),
  };
}

export async function restoreReplayDocument(
  document: ComposerReplayDocument,
  restorePaths: (paths: PathReferenceSummary[]) => Promise<PathReferenceSummary[]>,
): Promise<ComposerNode[]> {
  const nodes: ComposerNode[] = document.nodes.map((node) => node.type === "text"
    ? { type: "text", text: node.text }
    : { type: "path", path: node.path });
  const savedPaths = nodes.flatMap((node) => node.type === "path" ? [node.path] : []);
  if (!savedPaths.length) return normalizeComposerNodes(nodes);
  const restored = await restorePaths(savedPaths);
  let index = 0;
  return normalizeComposerNodes(nodes.map((node) => node.type === "path"
    ? { type: "path", path: restored[index++] || node.path }
    : node));
}

export function composerFingerprint(nodes: ComposerNode[]): string {
  return JSON.stringify(normalizeComposerNodes(nodes).map((node) => node.type === "text"
    ? ["text", node.text]
    : ["path", node.path.refId, node.path.displayPath, node.path.valid]));
}

export function serializeDraft(nodes: ComposerNode[]): string {
  const document: DraftDocumentV2 = { version: 2, nodes: normalizeComposerNodes(nodes) };
  return JSON.stringify(document);
}

export async function restoreDraft(
  value: string,
  restorePaths: (paths: PathReferenceSummary[]) => Promise<PathReferenceSummary[]>,
): Promise<ComposerNode[]> {
  const parsed = parseDraft(value);
  const savedPaths = parsed.flatMap((node) => node.type === "path" ? [node.path] : []);
  if (!savedPaths.length) return parsed;
  const restored = await restorePaths(savedPaths);
  let index = 0;
  return parsed.map((node) => node.type === "path" ? { type: "path", path: restored[index++] || node.path } : node);
}

function parseDraft(value: string): ComposerNode[] {
  try {
    const document = JSON.parse(value) as DraftDocumentV2 | LegacyDraftDocument;
    if (document.version === 2 && Array.isArray(document.nodes)) {
      const nodes: ComposerNode[] = [];
      for (const node of document.nodes) {
        if (node?.type === "text" && typeof node.text === "string") nodes.push({ type: "text", text: node.text });
        else if (node?.type === "path" && validPath(node.path)) nodes.push({ type: "path", path: node.path });
      }
      return normalizeComposerNodes(nodes);
    }
    if (document.version === 1 && typeof document.text === "string" && Array.isArray(document.paths)) {
      const nodes = textNodes(document.text);
      for (const path of document.paths) if (validPath(path)) nodes.push({ type: "path", path });
      return nodes;
    }
  } catch { /* old plain-text draft */ }
  return textNodes(value);
}

function validPath(value: unknown): value is PathReferenceSummary {
  if (!value || typeof value !== "object") return false;
  const path = value as Partial<PathReferenceSummary>;
  return typeof path.refId === "string" && typeof path.displayPath === "string" && typeof path.serializedPath === "string";
}

function transportComposerNodes(nodes: ComposerNode[]): ComposerNode[] {
  const transport: ComposerNode[] = [];
  for (const node of normalizeComposerNodes(nodes)) {
    const previous = transport.at(-1);
    if (node.type === "path") {
      if (previous?.type === "path") transport.push({ type: "text", text: " " });
      else if (previous?.type === "text" && !/\s$/.test(previous.text)) previous.text += " ";
      transport.push(node);
      continue;
    }
    const value = previous?.type === "path" && !/^\s/.test(node.text) ? ` ${node.text}` : node.text;
    if (previous?.type === "text") previous.text += value;
    else transport.push({ type: "text", text: value });
  }
  if (transport.at(-1)?.type === "path") transport.push({ type: "text", text: " " });
  return transport;
}
