import type { Root } from "hast";
import { parser as cssParser } from "@lezer/css";
import { parser as javascriptParser } from "@lezer/javascript";
import { parseFragment } from "parse5";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { normalizeMathDelimiters } from "./richText.js";
import { needsModuleScript, supportsBrowserPreview } from "./previewModules.js";
import { rehypeMediaFallbacks, rehypeMediaPlaceholders, remarkLocalMedia } from "./richTextMedia.js";
import {
  DEFAULT_RICH_TEXT_RENDER_POLICY,
  type RichTextLevel,
  type RichTextMediaPlacement,
  type RichTextRenderPolicy,
} from "./contracts/richText.js";

export type { RichTextLevel } from "./contracts/richText.js";

export interface RichTextPolicy {
  level: RichTextLevel;
  mediaPlacements?: RichTextMediaPlacement[];
  renderPolicy?: RichTextRenderPolicy;
}

export const RICH_LIVE_HTML_TAG = "grok-live-html";
export const RICH_STATIC_HTML_TAG = "grok-static-html";
export const RICH_EXECUTABLE_CODE_TAG = "grok-executable-code";

/** The only RichText parser definition used by the server and renderer. */
export function parseRichTextDocument(text: string, policy: RichTextPolicy): Root {
  const source = normalizeProseMathOutsideHtml(text);
  const renderPolicy = policy.renderPolicy || DEFAULT_RICH_TEXT_RENDER_POLICY;
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);
  if (policy.level === "media") processor.use(remarkLocalMedia, { source });
  processor.use(remarkBreaks);
  processor
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeImplicitExecutable, { source })
    .use(rehypeLiveHtml, { source })
    .use(rehypeRaw)
    .use(rehypeWebBundles, { source })
    .use(rehypeSafeInlineHtml, { source });
  if (policy.level === "media") {
    processor
      .use(rehypeMediaPlaceholders, { originalSource: text, parsedSource: source, placements: policy.mediaPlacements || [], policy: renderPolicy })
      .use(rehypeMediaFallbacks, { source, policy: renderPolicy });
  }
  processor.use(rehypeKatex);
  return processor.runSync(processor.parse(source)) as Root;
}

/** Uses the canonical executable grammar without constructing a rich-text tree. */
export function isImplicitExecutableRichText(source: string): boolean {
  return implicitExecutableLanguage(source.trim()) !== null;
}

type HtmlTreeNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlTreeNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

function rehypeLiveHtml(options: { source: string }) {
  return (tree: Root): void => {
    const root = tree as unknown as HtmlTreeNode;
    replaceSourceHtmlIslands(root, options.source);
    rewriteLiveHtml(root, options.source);
  };
}

interface SourceRange { start: number; end: number }

type ParsedHtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  childNodes?: ParsedHtmlNode[];
  sourceCodeLocation?: { startOffset?: number; endOffset?: number };
};

type ExecutableLanguage = "javascript" | "typescript" | "jsx" | "tsx" | "css";
type WebLanguage = "html" | ExecutableLanguage;

const jsxParser = javascriptParser.configure({ dialect: "jsx" });
const typescriptParser = javascriptParser.configure({ dialect: "ts" });
const tsxParser = javascriptParser.configure({ dialect: "ts jsx" });

interface WebPart {
  kind: "markup" | "style" | "script";
  language: WebLanguage;
  source: string;
  node: HtmlTreeNode;
}

interface ExecutableSegment {
  start: number;
  end: number;
  language: ExecutableLanguage;
  source: string;
}

const STRUCTURED_LEAF_TAGS = new Set(["pre", "code", RICH_LIVE_HTML_TAG, RICH_STATIC_HTML_TAG, RICH_EXECUTABLE_CODE_TAG]);
const IMPLICIT_CODE_BOUNDARY_TAGS = new Set(["blockquote", "li", "ol", "ul"]);

/** Authored HTML is executable source, not prose; math normalization only owns the gaps around it. */
function normalizeProseMathOutsideHtml(source: string): string {
  const fences = markdownFenceRanges(source);
  const ranges = sourceHtmlRanges(source, fences).sort((left, right) => left.start - right.start);
  if (!ranges.length) return normalizeMathDelimiters(source);
  let cursor = 0;
  let normalized = "";
  for (const range of ranges) {
    normalized += normalizeMathDelimiters(source.slice(cursor, range.start));
    normalized += source.slice(range.start, range.end);
    cursor = range.end;
  }
  return normalized + normalizeMathDelimiters(source.slice(cursor));
}

function markdownFenceRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const opening = /^(?:[\t ]*)(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    const marker = match[1][0];
    const length = match[1].length;
    const closing = new RegExp(`^(?:[\\t ]*)${marker}{${length},}[\\t ]*$`, "gm");
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(source);
    const boundary = end ? end.index + end[0].length : source.length;
    ranges.push({ start: match.index, end: boundary });
    opening.lastIndex = boundary;
  }
  return ranges;
}

function stripOuterComments(source: string): string {
  let value = source.replace(/^(?:\s*\/\/[^\n]*(?:\n|$)|\s*\/\*[\s\S]*?\*\/\s*)+/, "");
  value = value.replace(/(?:\s*\/\/[^\n]*|\s*\/\*[\s\S]*?\*\/)\s*$/, "");
  return value.trim();
}

function executableCodeNode(source: string, language: ExecutableLanguage, position: HtmlTreeNode["position"]): HtmlTreeNode {
  return {
    type: "element",
    tagName: RICH_EXECUTABLE_CODE_TAG,
    properties: { source, language },
    children: [],
    position,
  };
}

/** Rejoins complete source HTML before CommonMark's blank-line and indentation rules can fragment it. */
function replaceSourceHtmlIslands(root: HtmlTreeNode, source: string): void {
  if (!root.children?.length) return;
  const protectedCode = collectCodeRanges(root);
  const ranges = sourceHtmlRanges(source, protectedCode);
  for (const range of ranges) {
    const first = root.children.findIndex((child) => containedBy(child, range));
    if (first < 0) {
      const enclosing = root.children.findIndex((child) => child.type === "raw" && encloses(child, range));
      if (enclosing >= 0) {
        const split = splitRawHtmlIsland(root.children[enclosing], range, source);
        if (split) root.children.splice(enclosing, 1, ...split);
      }
      continue;
    }
    let last = first;
    for (let index = first + 1; index < root.children.length; index += 1) {
      if (containedBy(root.children[index], range)) last = index;
    }
    const value = source.slice(range.start, range.end);
    root.children.splice(first, last - first + 1, htmlNode(value, needsLiveRuntime(value), sourcePosition(source, range)));
  }
}

function splitRawHtmlIsland(node: HtmlTreeNode, htmlRange: SourceRange, source: string): HtmlTreeNode[] | null {
  const range = nodeSourceRange(node);
  if (!range) return null;
  const before = executableNodesForRange(source, { start: range.start, end: htmlRange.start });
  const after = executableNodesForRange(source, { start: htmlRange.end, end: range.end });
  if (before === null || after === null) return null;
  const html = source.slice(htmlRange.start, htmlRange.end);
  return joinStructuredNodes([
    ...before,
    htmlNode(html, needsLiveRuntime(html), sourcePosition(source, htmlRange)),
    ...after,
  ]);
}

function sourceHtmlRanges(source: string, protectedCode: SourceRange[]): SourceRange[] {
  const documents = fullHtmlDocumentRanges(source).filter((range) => !insideAny(range.start, protectedCode));
  let fragment: ParsedHtmlNode;
  try {
    fragment = parseFragment(source, { sourceCodeLocationInfo: true }) as unknown as ParsedHtmlNode;
  } catch {
    return documents;
  }
  const elements = (fragment.childNodes || []).flatMap((node) => {
    const start = node.sourceCodeLocation?.startOffset;
    const end = node.sourceCodeLocation?.endOffset;
    const tag = node.tagName?.toLowerCase();
    if (typeof start !== "number" || typeof end !== "number" || end <= start || !tag) return [];
    if (!HTML_ISLAND_TAGS.has(tag) || !startsAtOwnLine(source, start) || insideAny(start, protectedCode)) return [];
    if (documents.some((range) => start >= range.start && end <= range.end)) return [];
    return [{ start, end }];
  });
  const groups: SourceRange[] = [];
  for (const range of elements) {
    const previous = groups.at(-1);
    if (previous && htmlOnlyGap(source.slice(previous.end, range.start))) previous.end = range.end;
    else groups.push({ ...range });
  }
  return [...documents, ...groups].sort((left, right) => right.start - left.start);
}

function fullHtmlDocumentRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const opening = /(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s[^>]*)?>/gi;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    if (!startsAtOwnLine(source, match.index)) continue;
    const closing = /<\/html\s*>/gi;
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(source);
    if (!end) continue;
    ranges.push({ start: match.index, end: end.index + end[0].length });
    opening.lastIndex = end.index + end[0].length;
  }
  return ranges;
}

function collectCodeRanges(node: HtmlTreeNode, ranges: SourceRange[] = []): SourceRange[] {
  if ((node as HtmlTreeNode & { tagName?: string }).tagName === "pre") {
    const range = nodeSourceRange(node);
    if (range) ranges.push(range);
  }
  node.children?.forEach((child) => collectCodeRanges(child, ranges));
  return ranges;
}

function nodeSourceRange(node: HtmlTreeNode): SourceRange | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && end > start ? { start, end } : null;
}

function sourcePosition(source: string, range: SourceRange): NonNullable<HtmlTreeNode["position"]> {
  return { start: sourcePoint(source, range.start), end: sourcePoint(source, range.end) };
}

function sourcePoint(source: string, offset: number): { line: number; column: number; offset: number } {
  const prefix = source.slice(0, offset);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return { line: prefix.split("\n").length, column: offset - lineStart + 1, offset };
}

function containedBy(node: HtmlTreeNode, range: SourceRange): boolean {
  const nodeRange = nodeSourceRange(node);
  return Boolean(nodeRange && nodeRange.start >= range.start && nodeRange.end <= range.end);
}

function encloses(node: HtmlTreeNode, range: SourceRange): boolean {
  const nodeRange = nodeSourceRange(node);
  return Boolean(nodeRange && nodeRange.start <= range.start && nodeRange.end >= range.end);
}

function startsAtOwnLine(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(lineStart, offset).trim() === "";
}

function insideAny(offset: number, ranges: SourceRange[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function htmlOnlyGap(value: string): boolean {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim() === "";
}

const HTML_ISLAND_TAGS = new Set([
  "address", "article", "aside", "audio", "blockquote", "body", "button", "canvas", "center", "details", "dialog", "dir", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "iframe", "img", "link", "main", "menu", "nav", "noframes", "noscript", "object", "ol", "picture", "pre", "script", "search", "section", "style", "svg", "table", "template", "title", "ul", "video",
]);

function rewriteLiveHtml(parent: HtmlTreeNode, source: string): void {
  if (!parent.children) return;
  parent.children = parent.children.map((child) => {
    if (child.type === "raw" && child.value && needsLiveRuntime(child.value)) {
      return htmlNode(child.value, needsLiveRuntime(child.value), child.position);
    }
    if (child.children && containsExecutableRaw(child)) {
      const value = sourceSlice(source, child.position);
      if (value) return liveHtmlNode(value, child.position);
    }
    rewriteLiveHtml(child, source);
    return child;
  });
}

function containsExecutableRaw(node: HtmlTreeNode): boolean {
  if (node.type === "raw" && node.value) return needsLiveRuntime(node.value);
  return node.children?.some(containsExecutableRaw) === true;
}

function needsLiveRuntime(value: string): boolean {
  return /<!doctype|<\/?html\b|<\/?(?:script|style|iframe|object|embed|canvas|form|button|input|select|textarea|video|audio|svg|link|meta|base)\b|\bon[a-z]+\s*=|javascript:/i.test(value)
    || (/\bstyle\s*=/i.test(value) && /<(?:address|article|aside|body|div|footer|header|main|nav|section|table)(?:\s|>)/i.test(value));
}

const SAFE_INLINE_HTML_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "del", "dfn",
  "em", "i", "ins", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);
const SAFE_INLINE_HTML_PROPERTIES = new Set(["dateTime", "dir", "lang", "title", "value"]);

/** Raw inline HTML stays in the application document, so it receives a narrow structural allowlist. */
function rehypeSafeInlineHtml(options: { source: string }) {
  return (tree: Root): void => sanitizeInlineHtmlTree(tree as unknown as HtmlTreeNode, options.source);
}

function sanitizeInlineHtmlTree(node: HtmlTreeNode, source: string): void {
  if (node.type === "element" && node.tagName && authoredInlineHtml(node, source)) {
    if (!SAFE_INLINE_HTML_TAGS.has(node.tagName)) {
      node.tagName = "span";
      node.properties = {};
    } else {
      node.properties = safeInlineHtmlProperties(node.tagName, node.properties || {});
    }
  }
  for (const child of node.children || []) sanitizeInlineHtmlTree(child, source);
}

function authoredInlineHtml(node: HtmlTreeNode, source: string): boolean {
  if (STRUCTURED_LEAF_TAGS.has(node.tagName || "")) return false;
  const range = nodeSourceRange(node);
  return Boolean(range && /^\s*</.test(source.slice(range.start, Math.min(range.end, range.start + 96))));
}

function safeInlineHtmlProperties(tagName: string, properties: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (SAFE_INLINE_HTML_PROPERTIES.has(name) && safePropertyValue(value)) safe[name] = value;
    else if (name.startsWith("aria") && safePropertyValue(value)) safe[name] = value;
    else if (tagName === "a" && name === "href" && safeInlineHref(value)) safe.href = value;
    else if (tagName === "q" && name === "cite" && safeHttpUrl(value)) safe.cite = value;
  }
  return safe;
}

function safePropertyValue(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function safeInlineHref(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith("#")) return true;
  try { return ["http:", "https:", "mailto:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function safeHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function liveHtmlNode(source: string, position?: HtmlTreeNode["position"]): HtmlTreeNode {
  return htmlNode(source, true, position);
}

function htmlNode(source: string, live: boolean, position?: HtmlTreeNode["position"]): HtmlTreeNode {
  return {
    type: "element",
    properties: { source },
    children: [],
    ...(position ? { position } : {}),
    tagName: live ? RICH_LIVE_HTML_TAG : RICH_STATIC_HTML_TAG,
  } as HtmlTreeNode;
}

function sourceSlice(source: string, position?: HtmlTreeNode["position"]): string | null {
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && start >= 0 && end > start
    ? source.slice(start, end)
    : null;
}

/**
 * CommonMark owns block boundaries. Only a complete paragraph that starts like
 * authored code and parses as one language is promoted to executable source.
 * This keeps surrounding prose out of JavaScript/CSS without guessing line by line.
 */
function rehypeImplicitExecutable(options: { source: string }) {
  return (tree: Root): void => rewriteImplicitExecutable(tree as unknown as HtmlTreeNode, options.source);
}

function rewriteImplicitExecutable(parent: HtmlTreeNode, source: string): void {
  if (!parent.children?.length) return;
  parent.children = parent.children.flatMap((child) => {
    if (child.type === "element" && (child.tagName === "p" || child.tagName === "ul")) {
      const range = nodeSourceRange(child);
      const raw = range ? source.slice(range.start, range.end) : "";
      const candidate = child.tagName === "p" || /^\s*\*\s/.test(raw);
      const executable = candidate && range ? executableNodesForRange(source, range) : null;
      if (executable?.length) return joinStructuredNodes(executable);
    }
    if (canContainImplicitExecutable(child)) rewriteImplicitExecutable(child, source);
    return [child];
  });
}

function canContainImplicitExecutable(node: HtmlTreeNode): boolean {
  if (!node.children?.length) return false;
  return !STRUCTURED_LEAF_TAGS.has(node.tagName || "")
    && !IMPLICIT_CODE_BOUNDARY_TAGS.has(node.tagName || "");
}

function executableNodesForRange(source: string, range: SourceRange): HtmlTreeNode[] | null {
  const raw = source.slice(range.start, range.end);
  if (!raw.trim()) return [];
  const segments = executableSegments(raw, range.start);
  return segments?.map((segment) => executableCodeNode(
    segment.source,
    segment.language,
    sourcePosition(source, { start: segment.start, end: segment.end }),
  )) || null;
}

function executableSegments(raw: string, baseOffset: number): ExecutableSegment[] | null {
  const trimmed = trimmedSourceRange(raw, baseOffset);
  if (!trimmed) return [];
  const language = implicitExecutableLanguage(trimmed.source);
  if (language) return [{ ...trimmed, language }];

  for (const boundary of lineBoundaries(trimmed.source)) {
    const rightValue = trimmed.source.slice(boundary).trimStart();
    const rightCandidate = stripOuterComments(rightValue);
    if (!rightCandidate || (!startsLikeCss(rightCandidate) && !startsLikeJavaScript(rightCandidate))) continue;
    const left = trimmedSourceRange(trimmed.source.slice(0, boundary), trimmed.start);
    if (!left) continue;
    const leftLanguage = implicitExecutableLanguage(left.source);
    if (!leftLanguage) continue;
    const rightBase = trimmed.start + boundary;
    const right = executableSegments(trimmed.source.slice(boundary), rightBase);
    if (right?.length) return [{ ...left, language: leftLanguage }, ...right];
  }
  return null;
}

function trimmedSourceRange(raw: string, baseOffset: number): Omit<ExecutableSegment, "language"> | null {
  const first = raw.search(/\S/);
  if (first < 0) return null;
  const trailing = raw.match(/\s*$/)?.[0].length || 0;
  const end = raw.length - trailing;
  return { start: baseOffset + first, end: baseOffset + end, source: raw.slice(first, end) };
}

function lineBoundaries(source: string): number[] {
  const boundaries: number[] = [];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) boundaries.push(index + 1);
  return boundaries;
}

function joinStructuredNodes(nodes: HtmlTreeNode[]): HtmlTreeNode[] {
  return nodes.flatMap((node, index) => index ? [{ type: "text", value: "\n" }, node] : [node]);
}

function implicitExecutableLanguage(source: string): ExecutableLanguage | null {
  if (source.length < 8 || /^(`{3,}|~{3,})/.test(source)) return null;
  const candidate = stripOuterComments(source);
  if (!candidate) return null;

  if (startsLikeCss(candidate) && parsesWithoutErrors(cssParser, source)) return "css";
  if (!startsLikeJavaScript(candidate)) return null;

  const hasJsx = syntaxContains(tsxParser, source, "JSX");
  const hasTypes = containsTypeScriptSyntax(source);
  if (hasJsx && hasTypes && parsesWithoutErrors(tsxParser, source)) return "tsx";
  if (hasJsx && parsesWithoutErrors(jsxParser, source)) return "jsx";
  if (hasTypes && parsesWithoutErrors(typescriptParser, source)) return "typescript";
  if (parsesWithoutErrors(javascriptParser, source)) return "javascript";
  return parsesWithoutErrors(tsxParser, source) ? hasJsx ? "jsx" : hasTypes ? "typescript" : "javascript" : null;
}

function parsesWithoutErrors(parser: typeof javascriptParser | typeof cssParser, source: string): boolean {
  const cursor = parser.parse(source).cursor();
  do {
    if (cursor.type.isError) return false;
  } while (cursor.next());
  return true;
}

function syntaxContains(parser: typeof javascriptParser, source: string, prefix: string): boolean {
  const cursor = parser.parse(source).cursor();
  do {
    if (cursor.name.startsWith(prefix)) return true;
  } while (cursor.next());
  return false;
}

function containsTypeScriptSyntax(source: string): boolean {
  const names = new Set([
    "AmbientDeclaration", "EnumDeclaration", "InterfaceDeclaration", "NamespaceDeclaration",
    "TypeAliasDeclaration", "TypeAnnotation", "TypeName", "TypeParamList", "type", "satisfies",
  ]);
  const cursor = tsxParser.parse(source).cursor();
  do {
    if (names.has(cursor.name)) return true;
  } while (cursor.next());
  return false;
}

function startsLikeJavaScript(source: string): boolean {
  return /^(?:import\s|export\s|type\s+[A-Za-z_$]|interface\s+[A-Za-z_$]|enum\s+[A-Za-z_$]|namespace\s+[A-Za-z_$]|declare\s|(?:const|let|var)\s+[A-Za-z_$]|(?:async\s+)?function\b|class\s+[A-Za-z_$]|(?:if|for|while|switch)\s*\(|for\s+await\s*\(|(?:try|do)\s*\{|await\s+|(?:fetch|addEventListener|setTimeout|setInterval|requestAnimationFrame)\s*\(|(?:document|window|globalThis|console|ReactDOM|echarts|Plotly|THREE|d3)\s*\.|new\s+[A-Za-z_$]|(?:\(\s*)?(?:async\s+)?function\b|\(\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(source);
}

const CSS_ELEMENT_SELECTOR = "(?:html|body|main|section|article|aside|header|footer|nav|div|span|p|h[1-6]|a|button|input|select|textarea|form|label|table|thead|tbody|tr|th|td|ul|ol|li|figure|figcaption|canvas|svg|path|video|audio|img)";

function startsLikeCss(source: string): boolean {
  if (/^@(?:charset|container|font-face|import|keyframes|layer|media|page|property|scope|starting-style|supports)\b/i.test(source)) return true;
  if (/^\*(?:\s|[.#:[>+~])/.test(source)) return true;
  if (/^::?[-A-Za-z]+(?:\(|[.#:[>+~\s{])/.test(source) && source.slice(0, Math.min(source.length, 240)).includes("{")) return true;
  if (/^[A-Za-z][\w-]*-[\w-]+(?:\b|[.#:\[])/.test(source) && source.slice(0, Math.min(source.length, 240)).includes("{")) return true;
  if (/^(?::root\b|[.#\[*][-_A-Za-z][\w-]*)/.test(source)) return true;
  return new RegExp(`^${CSS_ELEMENT_SELECTOR}(?:\\b|[.#:\\[])`, "i").test(source)
    && source.slice(0, Math.min(source.length, 240)).includes("{");
}

/** Join neighboring HTML/CSS/JS blocks into one document for the existing preview runtime. */
function rehypeWebBundles(options: { source: string }) {
  return (tree: Root): void => bundleWebChildren(tree as unknown as HtmlTreeNode, options.source);
}

function bundleWebChildren(parent: HtmlTreeNode, source: string): void {
  if (!parent.children?.length) return;
  for (const child of parent.children) {
    if (canContainWebBundle(child) && !webPartFromNode(child)) bundleWebChildren(child, source);
  }

  for (let index = 0; index < parent.children.length; index += 1) {
    const first = webPartFromNode(parent.children[index]);
    if (!first || !supportsBrowserPreview(first.language, first.source)) continue;

    const parts = [first];
    let lastPartIndex = index;
    let markupCount = first.kind === "markup" ? 1 : 0;
    let scriptCount = first.kind === "script" ? 1 : 0;
    if (isSelfContainedMarkup(first)) continue;
    for (let cursor = index + 1; cursor < parent.children.length;) {
      const node = parent.children[cursor];
      if (isWhitespaceNode(node)) {
        cursor += 1;
        continue;
      }
      const part = webPartFromNode(node);
      if (!part
        || !supportsBrowserPreview(part.language, part.source)
        || (part.kind === "markup" && (markupCount > 0 || isSelfContainedMarkup(part)))
        || (part.kind === "script" && scriptCount > 0)) break;
      parts.push(part);
      lastPartIndex = cursor;
      if (part.kind === "markup") markupCount += 1;
      if (part.kind === "script") scriptCount += 1;
      cursor += 1;
    }

    const categories = new Set(parts.map((part) => part.kind));
    if (parts.length < 2 || categories.size < 2 || !categories.has("markup")) continue;
    const position = joinedPosition(parts[0].node, parts.at(-1)!.node, source);
    parent.children.splice(index, lastPartIndex - index + 1, liveHtmlNode(composeWebDocument(parts), position));
  }
}

function isSelfContainedMarkup(part: WebPart): boolean {
  return part.kind === "markup" && /<!doctype\s+html|<html(?:\s|>)|<script(?:\s|>)/i.test(part.source);
}

function canContainWebBundle(node: HtmlTreeNode): boolean {
  if (!node.children?.length) return false;
  return !STRUCTURED_LEAF_TAGS.has(node.tagName || "");
}

function webPartFromNode(node: HtmlTreeNode): WebPart | null {
  const tag = node.tagName?.toLowerCase();
  if (tag === RICH_LIVE_HTML_TAG || tag === RICH_STATIC_HTML_TAG) {
    const source = propertyString(node.properties?.source);
    return source ? { kind: "markup", language: "html", source, node } : null;
  }
  if (tag === RICH_EXECUTABLE_CODE_TAG) {
    const language = normalizeWebLanguage(propertyString(node.properties?.language));
    const source = propertyString(node.properties?.source);
    if (!language || language === "html" || !source) return null;
    return { kind: language === "css" ? "style" : "script", language, source, node };
  }
  if (tag !== "pre") return null;
  const code = node.children?.find((child) => child.tagName?.toLowerCase() === "code");
  if (!code) return null;
  const language = languageFromClassName(code.properties?.className);
  if (!language) return null;
  const blockSource = textContent(code).replace(/\n$/, "");
  return blockSource ? {
    kind: language === "html" ? "markup" : language === "css" ? "style" : "script",
    language,
    source: blockSource,
    node,
  } : null;
}

function languageFromClassName(value: unknown): WebLanguage | null {
  const names = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\s+/) : [];
  const marker = names.find((name) => /^language-/i.test(name));
  return normalizeWebLanguage(marker?.replace(/^language-/i, "") || "");
}

function normalizeWebLanguage(language: string): WebLanguage | null {
  switch (language.trim().toLowerCase()) {
    case "html": case "htm": return "html";
    case "css": return "css";
    case "javascript": case "js": case "mjs": case "cjs": return "javascript";
    case "typescript": case "ts": return "typescript";
    case "jsx": return "jsx";
    case "tsx": return "tsx";
    default: return null;
  }
}

function propertyString(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join(" ") : "";
}

function textContent(node: HtmlTreeNode): string {
  if (node.type === "text") return node.value || "";
  return node.children?.map(textContent).join("") || "";
}

function isWhitespaceNode(node: HtmlTreeNode): boolean {
  return node.type === "text" && !(node.value || "").trim();
}

function joinedPosition(first: HtmlTreeNode, last: HtmlTreeNode, source: string): HtmlTreeNode["position"] {
  const start = first.position?.start?.offset;
  const end = last.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && end > start
    ? sourcePosition(source, { start, end })
    : first.position || last.position;
}

function composeWebDocument(parts: WebPart[]): string {
  const markup = parts.find((part) => part.kind === "markup")?.source || "";
  const styles = parts
    .filter((part) => part.kind === "style")
    .map((part) => `<style data-grok-bundle>\n${escapeEmbeddedClosingTag(part.source, "style")}\n</style>`);
  const scripts = parts
    .filter((part) => part.kind === "script")
    .map((part) => {
      const type = part.language === "typescript" ? "text/typescript"
        : part.language === "tsx" ? "text/tsx"
          : part.language === "jsx" ? "text/jsx"
            : part.language === "javascript" && needsModuleScript(part.source) ? "module"
            : null;
      const attribute = type ? ` type="${type}"` : "";
      return `<script${attribute} data-grok-bundle>\n${escapeEmbeddedClosingTag(part.source, "script")}\n</script>`;
    });
  return [markup, ...styles, ...scripts].join("\n");
}

function escapeEmbeddedClosingTag(source: string, tag: "style" | "script"): string {
  return source.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}
