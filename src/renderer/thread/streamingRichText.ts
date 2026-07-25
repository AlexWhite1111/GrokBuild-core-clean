import type { Root } from "hast";
import {
  parseRichTextDocument,
  type RichTextPolicy,
} from "../../shared/richTextPipeline.js";

export interface StreamingRichTextState {
  source: string;
  committedSource: string;
  committedTree: Root | null;
  activeSource: string;
  tree: Root;
  mode: "incremental" | "full";
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
    activeSource: "",
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
      activeSource: source,
      tree,
      mode: "full",
      parsedCharacters: previous.parsedCharacters + source.length,
      policyKey: nextPolicyKey,
      lastAttemptedBoundary: -1,
    };
  }
  if (source === previous.source) return previous;

  const activeSource = previous.activeSource + source.slice(previous.source.length);
  const absoluteActiveOffset = previous.committedSource.length;
  const boundary = latestCompletedBlockBoundary(activeSource);
  const absoluteBoundary = boundary < 0 ? -1 : absoluteActiveOffset + boundary;

  if (
    boundary > 0
    && absoluteBoundary !== previous.lastAttemptedBoundary
    && safeProsePrefix(activeSource.slice(0, boundary))
    && placementsStayInsideBoundary(policy, absoluteActiveOffset + boundary)
  ) {
    const prefixSource = activeSource.slice(0, boundary);
    const tailSource = activeSource.slice(boundary);
    const prefixTree = parseSegment(prefixSource, absoluteActiveOffset, source, policy);
    const tailTree = parseSegment(tailSource, absoluteActiveOffset + boundary, source, policy);
    const committedTree = mergeRoots(previous.committedTree, prefixTree);
    const proposed = mergeRoots(committedTree, tailTree);
    const authoritative = parseRichTextDocument(source, policy);
    const parsedCharacters = previous.parsedCharacters + prefixSource.length + tailSource.length + source.length;
    if (safeCommittedTree(prefixTree) && sameChildren(proposed, authoritative)) {
      return {
        source,
        committedSource: previous.committedSource + prefixSource,
        committedTree,
        activeSource: tailSource,
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
      tree: authoritative,
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
    activeSource: "",
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
 * These exclusions are intentionally conservative. The parser proof below is
 * necessary but global reference definitions and open block constructs can be
 * changed by future source, so they never become committed prefixes.
 */
function safeProsePrefix(source: string): boolean {
  if (!source.endsWith("\n\n") && !/\n[\t ]*\n$/.test(source)) return false;
  if (/[`$<>\[\]]/.test(source)) return false;
  if (/^\s*(?:\\\[|\\\(|\[[^\]]+\]:)/m.test(source)) return false;
  if (/^(?:\t| {4}| {0,3}(?:>|[-+*][\t ]+|\d+[.)][\t ]+))/m.test(source)) return false;
  if (/^\s*\|.*\|\s*$/m.test(source)) return false;
  if (/^\s*(?:`{3,}|~{3,})/m.test(source)) return false;
  return true;
}

function safeCommittedTree(tree: Root): boolean {
  return tree.children.every((node) => {
    if (node.type === "text") return node.value === "\n";
    return node.type === "element" && /^(?:p|h[1-6])$/.test(node.tagName);
  });
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
  return {
    type: "root",
    children: [...left.children, { type: "text", value: "\n" }, ...right.children],
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
