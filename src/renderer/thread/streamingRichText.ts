import type { ElementContent, Root } from "hast";
import {
  isImplicitExecutableRichText,
  parseRichTextDocument,
  RICH_EXECUTABLE_CODE_TAG,
  RICH_LIVE_HTML_TAG,
  RICH_STATIC_HTML_TAG,
  type RichTextPolicy,
} from "../../shared/richTextPipeline.js";

export interface StreamingRichTextState {
  source: string;
  committedSource: string;
  committedTree: Root | null;
  committedSegments: Array<{
    sourceAtCommit: string;
    tree: Root;
  }>;
  activeSource: string;
  activeTree: Root;
  tree: Root;
  mode: "plain" | "incremental" | "full";
  /** Test/diagnostic counter; it does not participate in rendering. */
  parsedCharacters: number;
  policyKey: string;
  lastAttemptedBoundary: number;
}

/** Start a stream using the same parser that owns finalized rich text. */
export function initialStreamingRichText(source: string, policy: RichTextPolicy): StreamingRichTextState {
  const empty = emptyRoot();
  return updateStreamingRichText({
    source: "",
    committedSource: "",
    committedTree: null,
    committedSegments: [],
    activeSource: "",
    activeTree: empty,
    tree: empty,
    mode: "full",
    parsedCharacters: 0,
    policyKey: policyIdentity(policy),
    lastAttemptedBoundary: -1,
  }, source, policy);
}

/**
 * Reparse only the unsettled tail when a top-level prose boundary has been
 * proven equivalent to the authoritative one-shot parser. Ambiguous Markdown
 * deliberately remains in full mode.
 */
export function updateStreamingRichText(
  previous: StreamingRichTextState,
  source: string,
  policy: RichTextPolicy,
): StreamingRichTextState {
  const nextPolicyKey = policyIdentity(policy);
  if (nextPolicyKey !== previous.policyKey || !source.startsWith(previous.source)) {
    const tree = parseRichTextDocument(source, policy);
    return {
      source,
      committedSource: "",
      committedTree: null,
      committedSegments: [],
      activeSource: source,
      activeTree: tree,
      tree,
      mode: "full",
      parsedCharacters: previous.parsedCharacters + source.length,
      policyKey: nextPolicyKey,
      lastAttemptedBoundary: -1,
    };
  }
  if (source === previous.source) return previous;

  if (isPlainParagraph(source, policy)) {
    const tree = plainParagraphTree(source);
    return {
      source,
      committedSource: "",
      committedTree: null,
      committedSegments: [],
      activeSource: source,
      activeTree: tree,
      tree,
      mode: "plain",
      parsedCharacters: previous.parsedCharacters,
      policyKey: nextPolicyKey,
      lastAttemptedBoundary: -1,
    };
  }

  const activeSource = previous.activeSource + source.slice(previous.source.length);
  const absoluteActiveOffset = previous.committedSource.length;
  const boundary = latestCompletedBlockBoundary(activeSource);
  const absoluteBoundary = boundary < 0 ? -1 : absoluteActiveOffset + boundary;

  if (
    boundary > 0
    && absoluteBoundary !== previous.lastAttemptedBoundary
    && stableCompletedPrefix(activeSource.slice(0, boundary))
    && placementsStayInsideBoundary(policy, absoluteActiveOffset + boundary)
  ) {
    const prefixSource = activeSource.slice(0, boundary);
    const tailSource = activeSource.slice(boundary);
    const prefixTree = parseSegment(prefixSource, absoluteActiveOffset, source, policy);
    const tailTree = parseSegment(tailSource, absoluteActiveOffset + boundary, source, policy);
    const proposedActive = mergeRoots(prefixTree, tailTree);
    const authoritativeActive = parseSegment(activeSource, absoluteActiveOffset, source, policy);
    const committedTree = mergeRoots(previous.committedTree, prefixTree);
    const proposed = mergeRoots(committedTree, tailTree);
    const parsedCharacters = previous.parsedCharacters
      + prefixSource.length
      + tailSource.length
      + activeSource.length;
    if (safeCommittedTree(prefixTree) && sameChildren(proposedActive, authoritativeActive)) {
      const committedSource = previous.committedSource + prefixSource;
      return {
        source,
        committedSource,
        committedTree,
        committedSegments: [
          ...previous.committedSegments,
          { sourceAtCommit: committedSource, tree: prefixTree },
        ],
        activeSource: tailSource,
        activeTree: tailTree,
        tree: proposed,
        mode: "incremental",
        parsedCharacters,
        policyKey: nextPolicyKey,
        lastAttemptedBoundary: absoluteBoundary,
      };
    }
    return {
      ...previous,
      source,
      activeSource,
      activeTree: authoritativeActive,
      tree: mergeRoots(previous.committedTree, authoritativeActive),
      mode: previous.committedTree ? "incremental" : "full",
      parsedCharacters,
      policyKey: nextPolicyKey,
      lastAttemptedBoundary: absoluteBoundary,
    };
  }

  if (previous.committedTree) {
    const tailTree = parseSegment(activeSource, absoluteActiveOffset, source, policy);
    return {
      ...previous,
      source,
      activeSource,
      activeTree: tailTree,
      tree: mergeRoots(previous.committedTree, tailTree),
      mode: "incremental",
      parsedCharacters: previous.parsedCharacters + activeSource.length,
      policyKey: nextPolicyKey,
      ...(absoluteBoundary >= 0 ? { lastAttemptedBoundary: absoluteBoundary } : {}),
    };
  }

  const tree = parseRichTextDocument(source, policy);
  return {
    ...previous,
    source,
    activeSource,
    activeTree: tree,
    tree,
    mode: "full",
    parsedCharacters: previous.parsedCharacters + source.length,
    policyKey: nextPolicyKey,
    ...(absoluteBoundary >= 0 ? { lastAttemptedBoundary: absoluteBoundary } : {}),
  };
}

/** A completed turn is always replaced by the existing one-shot pipeline. */
export function finalizeStreamingRichText(
  previous: StreamingRichTextState,
  source: string,
  policy: RichTextPolicy,
): StreamingRichTextState {
  const tree = parseRichTextDocument(source, policy);
  return {
    source,
    committedSource: source,
    committedTree: tree,
    committedSegments: [{ sourceAtCommit: source, tree }],
    activeSource: "",
    activeTree: emptyRoot(),
    tree,
    mode: "full",
    parsedCharacters: previous.parsedCharacters + source.length,
    policyKey: policyIdentity(policy),
    lastAttemptedBoundary: source.length,
  };
}

function latestCompletedBlockBoundary(source: string): number {
  const blank = /\n[\t ]*\n/g;
  let boundary = -1;
  for (let match = blank.exec(source); match; match = blank.exec(source)) {
    const end = match.index + match[0].length;
    if (source.slice(end).trim()) boundary = end;
  }
  return boundary;
}

/**
 * A blank-line boundary is committed only after the active segment proves
 * compositional against the canonical parser. Reference-style Markdown is the
 * remaining cross-block state: a later definition can rewrite an earlier
 * shortcut, or an earlier definition can rewrite a future tail. Those sources
 * deliberately remain active until finalization.
 */
function stableCompletedPrefix(source: string): boolean {
  if (!source.endsWith("\n\n") && !/\n[\t ]*\n$/.test(source)) return false;
  const visible = markdownOutsideCode(source)
    .replace(/\\\[[\s\S]*?\\\]/g, "")
    .replace(/!?\[[^\]\n]*\]\((?:\\.|[^)\n])*\)/g, "")
    .replace(/\[(?: |x|X)\](?=[\t ])/g, "");
  return !/^\s{0,3}\[[^\]\n]+\]:/m.test(visible)
    && !/!?\[[^\]\n]+\]\s*\[[^\]\n]*\]/.test(visible)
    && !/[\[\]]/.test(visible);
}

/**
 * Plain prose still uses the canonical HAST contract, but does not need the
 * complete Markdown/HTML/math toolchain while its one paragraph is growing.
 * The accepted grammar is deliberately narrow: any character that could alter
 * Markdown, HTML, math, media, autolink, or executable-code interpretation
 * returns immediately to the canonical parser.
 */
function isPlainParagraph(source: string, policy: RichTextPolicy): boolean {
  if (policy.mediaPlacements?.length) return false;
  if (!source) return true;
  if (/[\r\t]/.test(source) || source.includes("\n\n") || / +\n/.test(source)) return false;
  if (/[\\`*_{}\[\]()<>#$~|&@=;:/+-]/.test(source)) return false;
  const logicalSource = source.endsWith("\n") ? source.slice(0, -1) : source;
  if (!logicalSource.trim()) return true;
  if (/www\./i.test(logicalSource) || isImplicitExecutableRichText(logicalSource)) return false;
  return logicalSource.split("\n").every((line) =>
    Boolean(line)
    && !line.startsWith(" ")
    && !/^\d+[.]\s/.test(line));
}

/** Builds the exact canonical HAST shape for the narrow prose grammar above. */
function plainParagraphTree(source: string): Root {
  let contentEnd = source.endsWith("\n") ? source.length - 1 : source.length;
  while (contentEnd > 0 && source.charCodeAt(contentEnd - 1) === 32) contentEnd -= 1;
  const content = source.slice(0, contentEnd);
  if (!content) return { type: "root", children: [], data: { quirksMode: false } };

  const lines = content.split("\n");
  const children: ElementContent[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0) {
      children.push({
        type: "text",
        value: line,
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: line.length + 1, offset: line.length },
        },
      });
      offset = line.length;
      continue;
    }
    const previousLength = lines[index - 1].length;
    children.push({ type: "element", tagName: "br", properties: {}, children: [] });
    children.push({
      type: "text",
      value: `\n${line}`,
      position: {
        start: { line: index, column: previousLength + 1, offset },
        end: { line: index + 1, column: line.length + 1, offset: offset + line.length + 1 },
      },
    });
    offset += line.length + 1;
  }
  const paragraphEnd = source.endsWith("\n") ? contentEnd : source.length;
  const paragraphEndColumn = lines.at(-1)!.length + 1 + (paragraphEnd - contentEnd);
  return {
    type: "root",
    children: [{
      type: "element",
      tagName: "p",
      properties: {},
      children,
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: lines.length, column: paragraphEndColumn, offset: paragraphEnd },
      },
    }],
    data: { quirksMode: false },
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    },
  };
}

function safeCommittedTree(tree: Root): boolean {
  let safe = true;
  const visit = (node: unknown): void => {
    if (!safe || !node || typeof node !== "object") return;
    const value = node as { type?: string; children?: unknown[] };
    if (value.type === "raw") { safe = false; return; }
    value.children?.forEach(visit);
  };
  visit(tree);
  if (!safe) return false;
  const last = [...tree.children].reverse().find((node) =>
    node.type !== "text" || Boolean(node.value.trim()));
  return !last || !openWebBundlePart(last);
}

function openWebBundlePart(node: Root["children"][number]): boolean {
  if (node.type !== "element") return false;
  if (node.tagName === RICH_EXECUTABLE_CODE_TAG || node.tagName === RICH_STATIC_HTML_TAG) {
    return true;
  }
  if (node.tagName === RICH_LIVE_HTML_TAG) {
    const source = typeof node.properties?.source === "string"
      ? node.properties.source
      : "";
    return !/<!doctype\s+html|<html(?:\s|>)|<script(?:\s|>)/i.test(source);
  }
  if (node.tagName !== "pre") return false;
  const code = node.children.find((child) =>
    child.type === "element" && child.tagName === "code");
  if (code?.type !== "element") return false;
  const rawClassName: unknown = code.properties?.className;
  const classes = Array.isArray(rawClassName)
    ? rawClassName.map(String)
    : typeof rawClassName === "string"
      ? rawClassName.split(/\s+/)
      : [];
  const language = classes
    .map((value) => /^language-(.+)$/i.exec(value)?.[1]?.toLowerCase())
    .find(Boolean);
  return Boolean(language && [
    "html", "htm", "css", "javascript", "js", "mjs", "cjs",
    "typescript", "ts", "jsx", "tsx",
  ].includes(language));
}

function markdownOutsideCode(source: string): string {
  const lines = source.match(/[^\n]*(?:\n|$)/g) || [];
  let fence: { marker: string; length: number } | null = null;
  let visible = "";
  for (const line of lines) {
    const body = line.replace(/\n$/, "");
    if (fence) {
      const closing = new RegExp(`^[\\t ]{0,3}${fence.marker}{${fence.length},}[\\t ]*$`);
      if (closing.test(body)) fence = null;
      visible += line.endsWith("\n") ? "\n" : "";
      continue;
    }
    const opening = /^[\t ]{0,3}(`{3,}|~{3,})/.exec(body);
    if (opening) {
      fence = { marker: opening[1][0], length: opening[1].length };
      visible += line.endsWith("\n") ? "\n" : "";
      continue;
    }
    visible += line.replace(/(`+)([^`\n]*?)\1/g, "");
  }
  return visible;
}

function placementsStayInsideBoundary(policy: RichTextPolicy, boundary: number): boolean {
  return (policy.mediaPlacements || []).every((placement) => placement.anchor.end <= boundary || placement.anchor.start >= boundary);
}

function parseSegment(source: string, offset: number, fullSource: string, policy: RichTextPolicy): Root {
  const end = offset + source.length;
  const mediaPlacements = (policy.mediaPlacements || [])
    .filter((placement) => placement.anchor.start >= offset && placement.anchor.end <= end)
    .map((placement) => ({
      ...placement,
      anchor: {
        start: placement.anchor.start - offset,
        end: placement.anchor.end - offset,
      },
    }));
  const tree = parseRichTextDocument(source, {
    ...policy,
    ...(mediaPlacements.length ? { mediaPlacements } : { mediaPlacements: [] }),
  });
  if (offset) shiftPositions(tree, fullSource.slice(0, offset));
  return tree;
}

function shiftPositions(node: unknown, prefix: string): void {
  const lineDelta = countLineBreaks(prefix);
  const lastBreak = prefix.lastIndexOf("\n");
  const columnDelta = lastBreak < 0 ? prefix.length : prefix.length - lastBreak - 1;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const candidate = value as {
      position?: { start?: Position; end?: Position };
      children?: unknown[];
    };
    if (candidate.position) {
      shiftPoint(candidate.position.start, prefix.length, lineDelta, columnDelta);
      shiftPoint(candidate.position.end, prefix.length, lineDelta, columnDelta);
    }
    candidate.children?.forEach(visit);
  };
  visit(node);
}

interface Position { line?: number; column?: number; offset?: number }

function shiftPoint(point: Position | undefined, offset: number, lines: number, columns: number): void {
  if (!point) return;
  const originalLine = point.line;
  if (typeof point.offset === "number") point.offset += offset;
  if (typeof point.line === "number") point.line += lines;
  if (originalLine === 1 && typeof point.column === "number") point.column += columns;
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = value.indexOf("\n"); index >= 0; index = value.indexOf("\n", index + 1)) count += 1;
  return count;
}

function mergeRoots(left: Root | null, right: Root): Root {
  if (!left?.children.length) return right;
  if (!right.children.length) return left;
  const children = [...left.children];
  const append = (node: Root["children"][number]) => {
    const previous = children.at(-1);
    if (previous?.type === "text" && node.type === "text") {
      children[children.length - 1] = {
        type: "text",
        value: previous.value + node.value,
      };
      return;
    }
    children.push(node);
  };
  append({ type: "text", value: "\n" });
  right.children.forEach(append);
  return {
    type: "root",
    children,
    data: right.data || left.data,
  };
}

function sameChildren(left: Root, right: Root): boolean {
  return JSON.stringify(left.children) === JSON.stringify(right.children);
}

function policyIdentity(policy: RichTextPolicy): string {
  return JSON.stringify(policy);
}

function emptyRoot(): Root {
  return { type: "root", children: [] };
}
