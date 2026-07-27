import type { ClipboardEvent } from "react";
import type { Element, RootContent } from "hast";
import type { PortableRichTextDocument } from "../../shared/contracts.js";

const SOURCE_START = "data-md-source-start";
const SOURCE_END = "data-md-source-end";
const SOURCE_SELECTOR = `[${SOURCE_START}][${SOURCE_END}]`;

interface SourceRange {
  start: number;
  end: number;
}

/** Adds original-Markdown ranges to rendered top-level blocks without changing the portable contract. */
export function annotateMarkdownSourceBlocks(document: PortableRichTextDocument, source: string): PortableRichTextDocument {
  let changed = false;
  const children = document.children.map((child) => {
    if (child.type !== "element") return child;
    const sourceRange = nodeRange(child);
    if (!sourceRange) return child;
    if (sourceRange.end > source.length) return child;
    changed = true;
    return annotateElement(child, sourceRange);
  });
  return changed ? { ...document, children } : document;
}

/** Replaces the browser's rendered-text copy with the exact source Markdown blocks selected by the user. */
export function copySelectedMarkdown(event: ClipboardEvent<HTMLElement>, source: string): void {
  const selection = window.getSelection();
  const root = event.currentTarget;
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  if (!inside(root, selection.anchorNode) || !inside(root, selection.focusNode)) return;
  const rendered = closestElement(selection.anchorNode, "[data-copy-rendered]");
  if (rendered && inside(rendered, selection.focusNode)) return;

  const selectionRange = selection.getRangeAt(0);
  const ranges = Array.from(root.querySelectorAll<HTMLElement>(SOURCE_SELECTOR)).flatMap((element) => {
    if (!intersects(selectionRange, element)) return [];
    const range = elementSourceRange(element, source.length);
    return range ? [range] : [];
  });
  if (!ranges.length) return;

  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  const markdown = source.slice(start, end);
  if (!markdown) return;

  event.preventDefault();
  event.clipboardData.setData("text/plain", markdown);
  event.clipboardData.setData("text/markdown", markdown);
}

export function markdownSourceRange(properties: Record<string, unknown>): SourceRange | undefined {
  const start = integer(properties[SOURCE_START]);
  const end = integer(properties[SOURCE_END]);
  return start !== undefined && end !== undefined && start >= 0 && end >= start ? { start, end } : undefined;
}

function annotateElement(element: Element, range: SourceRange): Element {
  return {
    ...element,
    properties: {
      ...element.properties,
      [SOURCE_START]: String(range.start),
      [SOURCE_END]: String(range.end),
    },
  };
}

function nodeRange(node: RootContent): SourceRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === "number" && typeof end === "number" && start >= 0 && end >= start ? { start, end } : undefined;
}

function elementSourceRange(element: HTMLElement, sourceLength: number): SourceRange | undefined {
  const start = integer(element.getAttribute(SOURCE_START));
  const end = integer(element.getAttribute(SOURCE_END));
  return start !== undefined && end !== undefined && start >= 0 && end > start && end <= sourceLength ? { start, end } : undefined;
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
    return false;
  }
}
