import type { ClipboardEvent } from "react";
import type { Element, ElementContent, RootContent, Text as HastText } from "hast";
import type { PortableRichTextDocument } from "../../shared/contracts.js";

const SOURCE_START = "data-md-source-start";
const SOURCE_END = "data-md-source-end";
const SOURCE_SELECTOR = `[${SOURCE_START}][${SOURCE_END}]`;
const SOURCE_TEXT = "data-md-copy-text";
const SOURCE_ATOM = "data-md-copy-atom";
const PRECISE_SOURCE_SELECTOR = `[${SOURCE_TEXT}], [${SOURCE_ATOM}]`;
const ATOMIC_MARKDOWN_TAGS = new Set([
  "a",
  "br",
  "code",
  "del",
  "em",
  "hr",
  "img",
  "input",
  "mark",
  "pre",
  "strong",
]);

export interface MarkdownSourceRange {
  start: number;
  end: number;
}
type SourceRange = MarkdownSourceRange;

/**
 * Adds exact source units after canonical parsing. Plain source-backed text is
 * selectable by character; syntax-bearing elements remain indivisible atoms.
 */
export function annotateMarkdownSourceUnits(document: PortableRichTextDocument, source: string): PortableRichTextDocument {
  let changed = false;
  const children = document.children.map((child) => {
    const annotated = annotateNode(child, source);
    if (annotated !== child) changed = true;
    return annotated;
  });
  return changed ? { ...document, children } : document;
}

/** Replaces rendered-text copy with the smallest trustworthy original-Markdown selection. */
export function copySelectedMarkdown(event: ClipboardEvent<HTMLElement>, source: string): void {
  const selection = window.getSelection();
  const root = event.currentTarget;
  if (
    !selection
    || selection.isCollapsed
    || selection.rangeCount !== 1
    || !inside(root, selection.anchorNode)
    || !inside(root, selection.focusNode)
  ) {
    const range = focusedSourceAtomRange(root, event.target, source.length);
    const markdown = range ? markdownFromSourceRanges(source, [range]) : undefined;
    if (markdown) {
      event.preventDefault();
      replaceClipboardWithMarkdown(event.clipboardData, markdown);
    }
    return;
  }
  const rendered = closestElement(selection.anchorNode, "[data-copy-rendered]");
  if (rendered && inside(rendered, selection.focusNode)) {
    return;
  }

  const selectionRange = selection.getRangeAt(0);
  const preciseRanges = preciseSelectionRanges(root, selectionRange, source.length);
  const ranges = preciseRanges.length
    ? preciseRanges
    : smallestIntersectingSourceRanges(root, selectionRange, source.length);
  const markdown = markdownFromSourceRanges(source, ranges);
  if (!markdown) return;

  event.preventDefault();
  replaceClipboardWithMarkdown(event.clipboardData, markdown);
}

export function replaceClipboardWithMarkdown(
  clipboardData: Pick<DataTransfer, "clearData" | "setData">,
  markdown: string,
): void {
  // Chromium also offers a rendered `text/html` flavor for DOM selections.
  // Rich paste targets prefer that flavor over `text/plain`, which silently
  // discards the Markdown syntax even when the exact source is present. Own
  // the clipboard payload completely so every target receives the canonical
  // Markdown source rather than a competing rendered projection.
  clipboardData.clearData();
  clipboardData.setData("text/plain", markdown);
  clipboardData.setData("text/markdown", markdown);
}

/** A fenced block keeps its exact authored Markdown; inferred code has no
 * surrounding syntax to invent and therefore keeps the original code only. */
export function codeBlockClipboardText(code: string, authoredMarkdown?: string): string {
  return authoredMarkdown ?? code;
}

export function markdownFromSourceRanges(source: string, ranges: SourceRange[]): string | undefined {
  const valid = ranges.filter((range) =>
    Number.isSafeInteger(range.start)
    && Number.isSafeInteger(range.end)
    && range.start >= 0
    && range.end > range.start
    && range.end <= source.length);
  if (!valid.length) return undefined;
  const start = Math.min(...valid.map((range) => range.start));
  const end = Math.max(...valid.map((range) => range.end));
  return source.slice(start, end) || undefined;
}

export function markdownSourceRange(properties: Record<string, unknown>): SourceRange | undefined {
  const start = integer(properties[SOURCE_START]);
  const end = integer(properties[SOURCE_END]);
  return start !== undefined && end !== undefined && start >= 0 && end >= start ? { start, end } : undefined;
}

export function markdownSourceAtomProps(range: MarkdownSourceRange | null | undefined): {
  "data-md-source-start"?: string;
  "data-md-source-end"?: string;
  "data-md-copy-atom"?: "true";
} {
  return range ? {
    "data-md-source-start": String(range.start),
    "data-md-source-end": String(range.end),
    "data-md-copy-atom": "true",
  } : {};
}

function annotateNode(node: ElementContent, source: string): ElementContent;
function annotateNode(node: RootContent, source: string): RootContent;
function annotateNode(node: RootContent, source: string): RootContent {
  if (node.type === "text") return sourceTextUnit(node, source) || node;
  if (node.type !== "element") return node;
  const range = nodeRange(node);
  const validRange = range && range.end <= source.length ? range : undefined;
  const atom = validRange ? markdownAtom(node, source, validRange) : false;
  let changed = false;
  const children = atom ? node.children : node.children.map((child) => {
    const annotated = annotateNode(child, source);
    if (annotated !== child) changed = true;
    return annotated;
  });
  if (!validRange && !changed) return node;
  return {
    ...node,
    ...(changed ? { children } : {}),
    ...(validRange ? {
      properties: {
        ...node.properties,
        [SOURCE_START]: String(validRange.start),
        [SOURCE_END]: String(validRange.end),
        ...(atom ? { [SOURCE_ATOM]: "true" } : {}),
      },
    } : {}),
  };
}

function sourceTextUnit(node: HastText, source: string): Element | undefined {
  const range = nodeRange(node);
  if (!range || range.end > source.length || source.slice(range.start, range.end) !== node.value) return undefined;
  return {
    type: "element",
    tagName: "span",
    properties: {
      [SOURCE_START]: String(range.start),
      [SOURCE_END]: String(range.end),
      [SOURCE_TEXT]: "true",
    },
    children: [node],
    position: node.position,
  };
}

function markdownAtom(element: Element, source: string, range: SourceRange): boolean {
  if (ATOMIC_MARKDOWN_TAGS.has(element.tagName) || element.tagName.startsWith("grok-")) return true;
  const classes = classNames(element.properties.className);
  if (classes.some((value) => value === "katex" || value === "katex-display" || value === "katex-error")) return true;
  const fragment = source.slice(range.start, range.end).trimStart();
  return fragment.startsWith("<") && new RegExp(`^<\\/?${escapeRegExp(element.tagName)}(?:\\s|/?>)`, "i").test(fragment);
}

function preciseSelectionRanges(root: HTMLElement, selection: Range, sourceLength: number): SourceRange[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PRECISE_SOURCE_SELECTOR)).flatMap((element) => {
    const range = elementSourceRange(element, sourceLength);
    if (!range) return [];
    if (element.hasAttribute(SOURCE_TEXT)) {
      const selected = selectedTextSourceRange(selection, element, range);
      return selected ? [selected] : [];
    }
    return intersects(selection, element) ? [range] : [];
  });
}

function smallestIntersectingSourceRanges(root: HTMLElement, selection: Range, sourceLength: number): SourceRange[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(SOURCE_SELECTOR))
    .filter((element) => intersects(selection, element));
  const selected = new Set(candidates);
  return candidates.flatMap((element) => {
    if (Array.from(element.querySelectorAll<HTMLElement>(SOURCE_SELECTOR)).some((child) => selected.has(child))) return [];
    const range = elementSourceRange(element, sourceLength);
    return range ? [range] : [];
  });
}

function selectedTextSourceRange(selection: Range, element: HTMLElement, sourceRange: SourceRange): SourceRange | undefined {
  const text = element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE
    ? element.firstChild as globalThis.Text
    : null;
  if (!text) return undefined;
  if (!intersects(selection, element)) return undefined;
  const start = element.contains(selection.startContainer)
    ? boundaryTextOffset(element, text, selection.startContainer, selection.startOffset)
    : 0;
  const end = element.contains(selection.endContainer)
    ? boundaryTextOffset(element, text, selection.endContainer, selection.endOffset)
    : text.data.length;
  if (start === undefined || end === undefined || end <= start) return undefined;
  return { start: sourceRange.start + start, end: sourceRange.start + end };
}

function boundaryTextOffset(element: HTMLElement, text: globalThis.Text, container: Node, offset: number): number | undefined {
  if (container === text) return Math.max(0, Math.min(text.data.length, offset));
  if (container === element) return offset <= 0 ? 0 : text.data.length;
  if (!element.contains(container)) return undefined;
  try {
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  } catch {
    return undefined;
  }
}

function classNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\s+/) : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nodeRange(node: RootContent): SourceRange | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" && start >= 0 && end >= start ? { start, end } : undefined;
}

function elementSourceRange(element: HTMLElement, sourceLength: number): SourceRange | undefined {
  const start = integer(element.getAttribute(SOURCE_START));
  const end = integer(element.getAttribute(SOURCE_END));
  return start !== undefined && end !== undefined && start >= 0 && end > start && end <= sourceLength ? { start, end } : undefined;
}

function focusedSourceAtomRange(root: HTMLElement, target: EventTarget | null, sourceLength: number): SourceRange | undefined {
  const nodes = [
    target instanceof Node ? target : null,
    root.ownerDocument.activeElement,
  ];
  for (const node of nodes) {
    if (!inside(root, node) || closestElement(node, "[data-copy-rendered]")) continue;
    const atom = closestElement(node, `[${SOURCE_ATOM}]`);
    if (!atom || !inside(root, atom)) continue;
    const range = elementSourceRange(atom, sourceLength);
    if (range) return range;
  }
  return undefined;
}

function integer(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function inside(root: HTMLElement, node: Node | null): boolean {
  return Boolean(node && (node === root || root.contains(node)));
}

function closestElement(node: Node | null, selector: string): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return element?.closest<HTMLElement>(selector) || null;
}

function intersects(range: Range, element: HTMLElement): boolean {
  try {
    return range.intersectsNode(element);
  } catch {
    try {
      const target = element.ownerDocument.createRange();
      target.selectNodeContents(element);
      return range.compareBoundaryPoints(Range.END_TO_START, target) > 0
        && range.compareBoundaryPoints(Range.START_TO_END, target) < 0;
    } catch {
      return false;
    }
  }
}
