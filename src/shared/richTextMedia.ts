import type { Element, Root, RootContent, Text as HastText } from "hast";
import type { Root as MdastRoot, RootContent as MdastContent, Text as MdastText } from "mdast";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import type { RichTextMediaPlacement, RichTextRenderPolicy } from "./contracts/richText.js";

export const RICH_MEDIA_TAG = "grok-media";
export const RICH_LOCAL_LINK_TAG = "grok-local-link";
export const RICH_EXTERNAL_CODE_LINK_TAG = "grok-external-code-link";
export const RICH_REMOTE_MEDIA_TAG = "grok-remote-media";

export interface RichTextMediaReference {
  reference: string;
  kind: "image" | "audio" | "video";
  syntax: "explicit" | "bare";
  anchor: {
    start: number;
    end: number;
    sourceStart: number;
    sourceEnd: number;
  };
  position: NonNullable<Element["position"]>;
}

interface MediaTarget {
  node: Element | HastText;
  reference: RichTextMediaReference;
}

interface ResolvedTarget {
  parsed: RichTextMediaReference;
  canonical: RichTextMediaReference;
}

interface MediaPlaceholderOptions {
  originalSource: string;
  parsedSource: string;
  placements: RichTextMediaPlacement[];
  policy: RichTextRenderPolicy;
}
interface MediaFallbackOptions { source: string; policy: RichTextRenderPolicy }

interface LocalMediaOptions { source: string }
interface SourceRange { start: number; end: number }

const MEDIA_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv)$/i;
const MEDIA_HINT = /\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv)/i;
const EXPLICIT_MEDIA_HINT = /!\[[^\]\n]*\]\(|<(?:img|audio|video)\b/i;
const INLINE_MEDIA_PATH = /(?<![\p{L}\p{N}_])(?:file:\/\/\/|~\/|\.\.?\/|\/)[^\r\n<>"'`，。；：！？、]*?\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv)/giu;
const BLOCKED_ANCESTORS = new Set(["a", "button", "code", "pre", "script", "style", "textarea", "template"]);

/** Finds renderable local-media syntax without scanning code, links, comments, or HTML attributes. */
export function extractRichTextMediaReferences(source: string): RichTextMediaReference[] {
  if (!MEDIA_HINT.test(source) && !EXPLICIT_MEDIA_HINT.test(source)) return [];
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLocalMedia, { source })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  const tree = processor.runSync(processor.parse(source)) as Root;
  return collectTargets(tree, source).map((target) => target.reference);
}

/** Accepts Grok's common unescaped local paths with spaces without touching code or links. */
export const remarkLocalMedia: Plugin<[LocalMediaOptions], MdastRoot> = (options) => (tree) => {
  rewriteMdastText(tree, options.source, false);
};

/** Replaces media syntax in the already parsed document, preserving one complete AST. */
export const rehypeMediaPlaceholders: Plugin<[MediaPlaceholderOptions], Root> = (options) => (tree) => {
  const parsedTargets = collectTargets(tree, options.parsedSource);
  if (!parsedTargets.length) return;

  const original = buckets(options.originalSource === options.parsedSource
    ? parsedTargets.map((target) => target.reference)
    : extractRichTextMediaReferences(options.originalSource));
  const references = new Map<Element | HastText, ResolvedTarget[]>();
  for (const target of parsedTargets) {
    const key = referenceKey(target.reference);
    const canonical = original.get(key)?.shift() || target.reference;
    if (!referenceEnabled(canonical, options.policy) || !verifiedPlacement(canonical, options.placements)) continue;
    const values = references.get(target.node) || [];
    values.push({ parsed: target.reference, canonical });
    references.set(target.node, values);
  }
  rewriteChildren(tree, references);
};

/** Preserves unsupported/unverified media syntax instead of letting sanitization erase it. */
export const rehypeMediaFallbacks: Plugin<[MediaFallbackOptions], Root> = (options) => (tree) => {
  rewriteMediaFallbacks(tree, options);
};

function collectTargets(root: Root, source: string): MediaTarget[] {
  const targets: MediaTarget[] = [];
  const markdownLinks = plainMarkdownLinkRanges(source);
  const visit = (parent: Root | Element, blocked: boolean): void => {
    let cursor = pointOffset(parent.position?.start) ?? 0;
    parent.children.forEach((child) => {
      if (child.type === "text") {
        if (pointOffset(child.position?.start) === undefined || pointOffset(child.position?.end) === undefined) {
          const knownEnd = pointOffset(child.position?.end);
          const endDerivedStart = knownEnd === undefined ? -1 : knownEnd - child.value.length;
          const start = endDerivedStart >= 0 && source.slice(endDerivedStart, knownEnd) === child.value
            ? endDerivedStart
            : source.indexOf(child.value, Math.max(0, cursor - 1));
          const parentEnd = pointOffset(parent.position?.end) ?? source.length;
          if (start >= Math.max(0, cursor - 1) && start + child.value.length <= parentEnd) child.position = position(source, start, start + child.value.length);
        }
        if (!blocked) for (const reference of inlineBareReferences(child, source)) {
          if (!overlapsAny(reference.anchor, markdownLinks)) targets.push({ node: child, reference });
        }
        cursor = pointOffset(child.position?.end) ?? cursor;
        return;
      }
      if (child.type !== "element") return;
      const nextBlocked = blocked || BLOCKED_ANCESTORS.has(child.tagName);
      if (!nextBlocked) {
        const explicit = explicitReference(child, source);
        if (explicit && !overlapsAny(explicit.anchor, markdownLinks)) { targets.push({ node: child, reference: explicit }); return; }
      }
      if (!nextBlocked) visit(child, nextBlocked);
      cursor = pointOffset(child.position?.end) ?? cursor;
    });
  };
  visit(root, false);
  return targets.sort((left, right) => left.reference.anchor.start - right.reference.anchor.start);
}

function explicitReference(node: Element, source: string): RichTextMediaReference | null {
  if (!["img", "audio", "video"].includes(node.tagName) || !node.position) return null;
  const fallback = stringProperty(node.properties.src) || sourceChild(node);
  const reference = fallback ? referenceFromSource(node.position, source, fallback) : null;
  if (!reference) return null;
  const inferredKind = bareMediaKind(reference);
  const semanticKind = node.tagName === "audio"
    ? "audio"
    : node.tagName === "video"
      ? "video"
      : inferredKind || (isLocalReference(reference) ? "image" : null);
  if (!semanticKind) return null;
  return makeReference(reference, semanticKind, "explicit", node.position, source);
}

/** Plain Markdown links are navigation, never implicit media embeds. */
function plainMarkdownLinkRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const pattern = /(?<!!)\[[^\]\n]*\]\(\s*(?:<[^>\n]*>|(?:\\.|[^)\n])*)\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index !== undefined) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function overlapsAny(anchor: { start: number; end: number }, ranges: SourceRange[]): boolean {
  return ranges.some((range) => anchor.start < range.end && anchor.end > range.start);
}

function makeReference(referenceValue: string, kind: RichTextMediaReference["kind"], syntax: RichTextMediaReference["syntax"], position: NonNullable<Element["position"]>, source: string): RichTextMediaReference | null {
  const reference = referenceValue.trim().replace(/^<|>$/g, "");
  const start = pointOffset(position.start);
  const end = pointOffset(position.end);
  if (!reference || start === undefined || end === undefined || start < 0 || end <= start || end > source.length) return null;
  const fragment = source.slice(start, end);
  const relative = fragment.indexOf(reference);
  const sourceStart = relative >= 0 ? start + relative : start;
  const sourceEnd = relative >= 0 ? sourceStart + reference.length : end;
  return { reference, kind, syntax, anchor: { start, end, sourceStart, sourceEnd }, position };
}

function inlineBareReferences(node: HastText, source: string): RichTextMediaReference[] {
  const base = pointOffset(node.position?.start);
  if (base === undefined) return [];
  const result: RichTextMediaReference[] = [];
  for (const match of node.value.matchAll(INLINE_MEDIA_PATH)) {
    if (match.index === undefined || insideLiteralHtmlTag(node.value, match.index)) continue;
    const before = node.value.slice(Math.max(0, match.index - 16), match.index);
    if (/(?:https?|data|javascript):$/i.test(before)) continue;
    const reference = match[0];
    const kind = bareMediaKind(reference);
    if (!kind) continue;
    const start = base + match.index;
    const end = start + reference.length;
    const located = position(source, start, end);
    result.push({ reference, kind, syntax: "bare", anchor: { start, end, sourceStart: start, sourceEnd: end }, position: located });
  }
  return result;
}

function insideLiteralHtmlTag(value: string, offset: number): boolean {
  const before = value.slice(0, offset);
  return before.lastIndexOf("<") > before.lastIndexOf(">");
}

function rewriteChildren(parent: Root | Element, references: Map<Element | HastText, ResolvedTarget[]>): void {
  const next: RootContent[] = [];
  for (const child of parent.children) {
    if (child.type === "text" || child.type === "element") {
      const matches = references.get(child);
      if (child.type === "text" && matches?.length) {
        next.push(...rewriteText(child, matches));
        continue;
      }
      if (child.type === "element" && matches?.length) {
        next.push(placeholder(matches[0].canonical));
        continue;
      }
    }
    if (child.type === "element") rewriteChildren(child, references);
    next.push(child);
  }
  parent.children = next;
}

function rewriteText(node: HastText, targets: ResolvedTarget[]): RootContent[] {
  const base = pointOffset(node.position?.start);
  if (base === undefined) return [node];
  const result: RootContent[] = [];
  let cursor = 0;
  for (const target of [...targets].sort((left, right) => left.parsed.anchor.start - right.parsed.anchor.start)) {
    const start = target.parsed.anchor.start - base;
    const end = target.parsed.anchor.end - base;
    if (start < cursor || end <= start || end > node.value.length) continue;
    if (start > cursor) result.push({ type: "text", value: node.value.slice(cursor, start) });
    result.push(placeholder(target.canonical));
    cursor = end;
  }
  if (cursor < node.value.length) result.push({ type: "text", value: node.value.slice(cursor) });
  return result.length ? result : [node];
}

function placeholder(reference: RichTextMediaReference): Element {
  return { type: "element", tagName: RICH_MEDIA_TAG, properties: {}, children: [], position: reference.position };
}

function sourceChild(node: Element): string | null {
  for (const child of node.children) {
    if (child.type === "element" && child.tagName === "source") {
      const value = stringProperty(child.properties.src);
      if (value) return value;
    }
  }
  return null;
}

function stringProperty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function referenceFromSource(position: NonNullable<Element["position"]>, source: string, fallback: string): string {
  const start = pointOffset(position.start);
  const end = pointOffset(position.end);
  if (start === undefined || end === undefined) return fallback;
  const fragment = source.slice(start, end);
  const html = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(fragment);
  if (html?.[2]) return html[2];
  const markdown = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)]+?\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv)))\s*\)$/is.exec(fragment);
  return markdown?.[1] || markdown?.[2] || fallback;
}

function bareMediaKind(reference: string): RichTextMediaReference["kind"] | null {
  if (!reference || /[\r\n]/.test(reference) || /^(?:https?|data|javascript):/i.test(reference)) return null;
  let pathname = reference.trim().replace(/^<|>$/g, "");
  try {
    if (pathname.startsWith("file:")) pathname = new URL(pathname).pathname;
  } catch {
    return null;
  }
  if (!MEDIA_EXTENSION.test(pathname)) return null;
  if (/\.(?:png|jpe?g|gif|webp|avif)$/i.test(pathname)) return "image";
  if (/\.(?:mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(pathname)) return "audio";
  return "video";
}

function isLocalReference(reference: string): boolean {
  const value = reference.trim().replace(/^<|>$/g, "");
  if (!value || /[\r\n]/.test(value) || /^(?:https?|data|javascript):/i.test(value)) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("file:");
}

function buckets(references: RichTextMediaReference[]): Map<string, RichTextMediaReference[]> {
  const result = new Map<string, RichTextMediaReference[]>();
  for (const reference of references) {
    const key = referenceKey(reference);
    const values = result.get(key) || [];
    values.push(reference);
    result.set(key, values);
  }
  return result;
}

function referenceKey(reference: RichTextMediaReference): string {
  return `${reference.syntax}\0${reference.kind}\0${reference.reference}`;
}

function rewriteMdastText(parent: MdastRoot | Extract<MdastContent, { children: unknown }>, source: string, blocked: boolean): void {
  const children = parent.children as MdastContent[];
  const next: MdastContent[] = [];
  for (const child of children) {
    const nextBlocked = blocked || child.type === "link" || child.type === "linkReference";
    if (!nextBlocked && child.type === "text") next.push(...splitLocalImageText(child, source));
    else {
      if ("children" in child && Array.isArray(child.children)) rewriteMdastText(child as Extract<MdastContent, { children: unknown }>, source, nextBlocked);
      next.push(child);
    }
  }
  parent.children = next as typeof parent.children;
}

function splitLocalImageText(node: MdastText, source: string): MdastContent[] {
  const base = pointOffset(node.position?.start);
  if (base === undefined || !node.value.includes("![")) return [node];
  const pattern = /!\[([^\]\n]*)\]\(\s*(?!https?:|data:|javascript:)([^)\n]+?\.(?:png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|webm|ogv))\s*\)/gi;
  const result: MdastContent[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) result.push(textNode(node.value.slice(cursor, match.index), source, base + cursor, base + match.index));
    const start = base + match.index;
    const end = start + match[0].length;
    result.push({ type: "image", url: match[2].trim(), alt: match[1], position: position(source, start, end) });
    cursor = match.index + match[0].length;
  }
  if (!result.length) return [node];
  if (cursor < node.value.length) result.push(textNode(node.value.slice(cursor), source, base + cursor, base + node.value.length));
  return result;
}

function textNode(value: string, source: string, start: number, end: number): MdastText {
  return { type: "text", value, position: position(source, start, end) };
}

function position(source: string, start: number, end: number): NonNullable<MdastText["position"]> {
  return { start: point(source, start), end: point(source, end) };
}

function point(source: string, offset: number): { line: number; column: number; offset: number } {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const newline = prefix.lastIndexOf("\n");
  return { line, column: offset - newline, offset };
}

/** Unified/rehype can legitimately synthesize nodes with a partial position. */
function pointOffset(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const offset = (value as { offset?: unknown }).offset;
  return typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 ? offset : undefined;
}

function referenceEnabled(reference: RichTextMediaReference, policy: RichTextRenderPolicy): boolean {
  return reference.syntax === "explicit" ? policy.recognition.localMarkdownMedia : policy.recognition.localBarePaths;
}

function verifiedPlacement(reference: RichTextMediaReference, placements: RichTextMediaPlacement[]): boolean {
  return placements.some((placement) => placement.kind === reference.kind
    && placement.anchor.start === reference.anchor.start
    && placement.anchor.end === reference.anchor.end);
}

function rewriteMediaFallbacks(parent: Root | Element, options: MediaFallbackOptions): void {
  parent.children = parent.children.map((child) => {
    if (child.type !== "element") return child;
    if (["img", "audio", "video"].includes(child.tagName)) return mediaFallback(child, options);
    rewriteMediaFallbacks(child, options);
    return child;
  });
}

function mediaFallback(node: Element, options: MediaFallbackOptions): RootContent {
  const start = pointOffset(node.position?.start);
  const end = pointOffset(node.position?.end);
  const source = stringProperty(node.properties.src) || sourceChild(node);
  const fragment = start !== undefined && end !== undefined ? options.source.slice(start, end) : source || "";
  if (node.tagName === "img" && source && /^https?:\/\//i.test(source) && options.policy.recognition.remoteMarkdownImages) {
    const presentation = options.policy.presentation.remoteMarkdownImages;
    if (presentation === "inline") {
      return { type: "element", tagName: RICH_REMOTE_MEDIA_TAG, properties: {}, children: [{ type: "text", value: source }], position: node.position };
    }
    if (presentation === "link") {
      const alt = stringProperty(node.properties.alt) || source;
      return { type: "element", tagName: "a", properties: { href: source }, children: [{ type: "text", value: alt }], position: node.position };
    }
  }
  return { type: "text", value: fragment || source || "", position: node.position };
}
