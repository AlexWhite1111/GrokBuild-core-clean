import type { Element, Root, RootContent, Text } from "hast";
import { normalizeMathDelimiters } from "../../shared/richText.js";
import type { RichTextLocalLink, RichTextRenderPolicy } from "../../shared/contracts.js";
import { RICH_EXTERNAL_CODE_LINK_TAG, RICH_LOCAL_LINK_TAG } from "../../shared/richTextMedia.js";
import { resolveLocalPathCandidate } from "../security/localPathCandidate.js";
import type { PathReferenceStore } from "../security/PathReferenceStore.js";

const BLOCKED = new Set(["pre", "script", "style", "textarea", "template", "grok-media"]);
const BARE_PATH = /(?<![\p{L}\p{N}_])(?:file:\/\/\/|~\/|\.\.?\/|\/)[^\s<>"'`，。；：！？、]+/giu;
const TRAILING = /[),.;:!?\]}]+$/;

/**
 * Converts only backend-verified filesystem references into opaque link
 * placements. Invalid or ambiguous source remains byte-for-byte visible.
 */
export function resolveRichTextLocalLinks(
  document: Root,
  source: string,
  projectPath: string,
  paths: PathReferenceStore,
  policy: RichTextRenderPolicy,
): { document: Root; localLinks: RichTextLocalLink[] } {
  const cloned = structuredClone(document);
  const coordinateSource = normalizeMathDelimiters(source);
  const localLinks: RichTextLocalLink[] = [];
  rewriteChildren(cloned, coordinateSource, projectPath, paths, policy, localLinks, false);
  return { document: cloned, localLinks };
}

function rewriteChildren(
  parent: Root | Element,
  source: string,
  projectPath: string,
  paths: PathReferenceStore,
  policy: RichTextRenderPolicy,
  links: RichTextLocalLink[],
  blocked: boolean,
): void {
  const next: RootContent[] = [];
  for (const child of parent.children) {
    if (child.type === "text" && !blocked && policy.recognition.localBarePaths && policy.presentation.localBarePaths === "link") {
      next.push(...rewriteBareText(child, source, projectPath, paths, links));
      continue;
    }
    if (child.type !== "element") { next.push(child); continue; }
    const nextBlocked = blocked || BLOCKED.has(child.tagName);
    if (!nextBlocked && child.tagName === "a") {
      const linked = verifiedElementLink(child, source, projectPath, paths, "markdown");
      if (linked) {
        if (policy.recognition.localMarkdownLinks && policy.presentation.localMarkdownLinks === "link") {
          links.push(linked.link); next.push(linked.node);
        } else {
          next.push(sourceFragment(child, source));
        }
        continue;
      }
    }
    if (child.tagName === "code") {
      if (!blocked && policy.recognition.localInlineCodePaths && policy.presentation.localInlineCodePaths === "link") {
        const linked = verifiedElementLink(child, source, projectPath, paths, "code");
        if (linked) { links.push(linked.link); next.push(linked.node); continue; }
      }
      if (!blocked && policy.recognition.webInlineCodeUrls && policy.presentation.webInlineCodeUrls === "link") {
        const external = externalCodeLink(child);
        if (external) { next.push(external); continue; }
      }
      next.push(child); continue;
    }
    rewriteChildren(child, source, projectPath, paths, policy, links, nextBlocked);
    next.push(child);
  }
  parent.children = next;
}

function verifiedElementLink(
  node: Element,
  source: string,
  projectPath: string,
  paths: PathReferenceStore,
  syntax: RichTextLocalLink["syntax"],
): { node: Element; link: RichTextLocalLink } | null {
  const bounds = offsets(node);
  if (!bounds) return null;
  const value = syntax === "markdown" ? linkDestination(node, source, bounds) : textContent(node).trim();
  const registered = registerCandidate(value, projectPath, paths);
  if (!registered) return null;
  return {
    node: syntax === "code"
      ? { type: "element", tagName: RICH_LOCAL_LINK_TAG, properties: { dataSyntax: syntax }, children: [node], position: node.position }
      : { ...node, tagName: RICH_LOCAL_LINK_TAG, properties: { dataSyntax: syntax } },
    link: { path: registered, anchor: bounds, syntax },
  };
}

function externalCodeLink(node: Element): Element | null {
  const value = textContent(node).trim();
  if (!value || value.length > 8_192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { type: "element", tagName: RICH_EXTERNAL_CODE_LINK_TAG, properties: {}, children: [node], position: node.position };
  } catch {
    return null;
  }
}

function sourceFragment(node: Element, source: string): Text {
  const bounds = offsets(node);
  if (!bounds) return { type: "text", value: textContent(node) };
  return textNode(source.slice(bounds.start, bounds.end), source, bounds.start, bounds.end);
}

function rewriteBareText(
  node: Text,
  source: string,
  projectPath: string,
  paths: PathReferenceStore,
  links: RichTextLocalLink[],
): RootContent[] {
  const base = offset(node.position?.start);
  if (base === undefined) return [node];
  const matches: Array<{ start: number; end: number; path: RichTextLocalLink["path"] }> = [];
  const trimmed = node.value.trim();
  const trimStart = node.value.indexOf(trimmed);
  if (trimmed && strongPrefix(trimmed) && /\s/.test(trimmed)) {
    const registered = registerCandidate(trimmed, projectPath, paths);
    if (registered) matches.push({ start: trimStart, end: trimStart + trimmed.length, path: registered });
  }
  if (!matches.length) {
    for (const match of node.value.matchAll(BARE_PATH)) {
      if (match.index === undefined || remoteSlash(node.value, match.index)) continue;
      const value = match[0].replace(TRAILING, "");
      if (!value) continue;
      const registered = registerCandidate(value, projectPath, paths);
      if (registered) matches.push({ start: match.index, end: match.index + value.length, path: registered });
    }
  }
  if (!matches.length) return [node];
  const result: RootContent[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) result.push(textNode(node.value.slice(cursor, match.start), source, base + cursor, base + match.start));
    const start = base + match.start;
    const end = base + match.end;
    const position = sourcePosition(source, start, end);
    result.push({ type: "element", tagName: RICH_LOCAL_LINK_TAG, properties: { dataSyntax: "bare" }, children: [{ type: "text", value: node.value.slice(match.start, match.end), position }], position });
    links.push({ path: match.path, anchor: { start, end }, syntax: "bare" });
    cursor = match.end;
  }
  if (cursor < node.value.length) result.push(textNode(node.value.slice(cursor), source, base + cursor, base + node.value.length));
  return result;
}

function registerCandidate(value: string | null, projectPath: string, paths: PathReferenceStore): RichTextLocalLink["path"] | null {
  if (!value || value.length > 4_096 || /[\0\r\n]/.test(value)) return null;
  const candidate = value.trim().replace(/^<|>$/g, "").replace(/\\([() ])/g, "$1");
  if (!candidate || /^(?:https?|mailto|javascript|data):/i.test(candidate) || candidate.startsWith("#")) return null;
  try {
    return paths.registerPath(resolveLocalPathCandidate(candidate, projectPath), projectPath);
  } catch {
    return null;
  }
}

function linkDestination(node: Element, source: string, bounds: { start: number; end: number }): string | null {
  const href = typeof node.properties.href === "string" ? node.properties.href.trim() : "";
  if (href) return href;
  const fragment = source.slice(bounds.start, bounds.end);
  const markdown = /\]\(\s*(?:<([^>]+)>|((?:\\.|[^)\s])+(?:\s+[^"')][^)]*?)?))\s*(?:["'][^"']*["'])?\s*\)/s.exec(fragment);
  if (markdown) return (markdown[1] || markdown[2] || "").trim();
  return /\bhref\s*=\s*(["'])(.*?)\1/i.exec(fragment)?.[2] || null;
}

function textContent(node: Element): string {
  return node.children.map((child) => child.type === "text" ? child.value : child.type === "element" ? textContent(child) : "").join("");
}

function strongPrefix(value: string): boolean {
  return /^(?:file:\/\/\/|~\/|\.\.?\/|\/)/i.test(value);
}

function remoteSlash(value: string, start: number): boolean {
  return /https?:\/$/i.test(value.slice(Math.max(0, start - 8), start));
}

function offsets(node: { position?: unknown }): { start: number; end: number } | null {
  const position = node.position as { start?: unknown; end?: unknown } | undefined;
  const start = offset(position?.start);
  const end = offset(position?.end);
  return start !== undefined && end !== undefined && end > start ? { start, end } : null;
}

function offset(point: unknown): number | undefined {
  const value = point && typeof point === "object" ? (point as { offset?: unknown }).offset : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function textNode(value: string, source: string, start: number, end: number): Text {
  return { type: "text", value, position: sourcePosition(source, start, end) };
}

function sourcePosition(source: string, start: number, end: number): NonNullable<Text["position"]> {
  return { start: point(source, start), end: point(source, end) };
}

function point(source: string, value: number): { line: number; column: number; offset: number } {
  const prefix = source.slice(0, value);
  const line = prefix.split("\n").length;
  const newline = prefix.lastIndexOf("\n");
  return { line, column: value - newline, offset: value };
}
