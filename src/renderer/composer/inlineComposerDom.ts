import type { PathReferenceSummary } from "../../shared/contracts.js";
import { normalizeComposerNodes, type ComposerNode } from "./composerDocument.js";
import { visibleCaretText } from "./pathChipDom.js";

export function readNodes(element: HTMLElement, references: Map<string, PathReferenceSummary>): ComposerNode[] {
  const nodes: ComposerNode[] = [];
  const appendText = (text: string) => { if (text) nodes.push({ type: "text", text }); };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { appendText(visibleCaretText(node.textContent || "")); return; }
    if (!(node instanceof HTMLElement)) return;
    const refId = node.dataset.pathRef;
    if (refId) { const path = references.get(refId); if (path) nodes.push({ type: "path", path }); return; }
    if (node.tagName === "BR") { appendText("\n"); return; }
    const block = node !== element && ["DIV", "P"].includes(node.tagName);
    if (block && nodes.length && !endsWithNewline(nodes)) appendText("\n");
    for (const child of node.childNodes) visit(child);
  };
  for (const child of element.childNodes) visit(child);
  return normalizeComposerNodes(nodes);
}

export function currentRange(element: HTMLElement | null): Range | null {
  const selection = window.getSelection();
  if (!element || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.commonAncestorContainer) ? range : null;
}

export function insertionRange(element: HTMLElement | null, preferred: Range | null): Range | null {
  if (!element) return null;
  if (preferred && element.contains(preferred.commonAncestorContainer)) return preferred.cloneRange();
  const range = document.createRange();
  range.selectNodeContents(element); range.collapse(false);
  return range;
}

export function rangeFromPoint(element: HTMLElement | null, x: number, y: number): Range | null {
  if (!element) return null;
  const documentWithCaret = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const direct = documentWithCaret.caretRangeFromPoint?.(x, y);
  if (direct && element.contains(direct.commonAncestorContainer)) return moveRangeOutsidePath(direct, x);
  const position = documentWithCaret.caretPositionFromPoint?.(x, y);
  if (position && element.contains(position.offsetNode)) { const range = document.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); return moveRangeOutsidePath(range, x); }
  return null;
}

export function setSelection(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges(); selection?.addRange(range);
}

export function codePointLengthOver(value: string, threshold: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > threshold) return true;
  }
  return false;
}

export function removeAsyncMarker(marker: Comment): void {
  if (!marker.isConnected) return;
  const caret = document.createRange();
  caret.setStartBefore(marker); caret.collapse(true);
  marker.remove(); setSelection(caret);
}

export function insertText(text: string, element: HTMLElement | null, preferred: Range | null): void {
  const range = insertionRange(element, currentRange(element) || preferred);
  if (!range) return;
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node); range.setStartAfter(node); range.collapse(true); setSelection(range);
}

export function adjacentPath(range: Range | null, direction: "before" | "after"): HTMLElement | null {
  if (!range || !range.collapsed) return null;
  let candidate: Node | null = null;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent || "";
    const visibleBefore = visibleCaretText(text.slice(0, range.startOffset));
    const visibleAfter = visibleCaretText(text.slice(range.startOffset));
    if ((direction === "before" && visibleBefore) || (direction === "after" && visibleAfter)) return null;
    candidate = direction === "before" ? range.startContainer.previousSibling : range.startContainer.nextSibling;
  } else {
    const children = range.startContainer.childNodes;
    candidate = direction === "before" ? children[range.startOffset - 1] || null : children[range.startOffset] || null;
  }
  return candidate instanceof HTMLElement && candidate.dataset.pathRef ? candidate : null;
}

export function clearSelection(element: HTMLElement, selected: Set<string>): void {
  selected.clear();
  for (const chip of element.querySelectorAll<HTMLElement>("[data-path-ref]")) delete chip.dataset.selected;
}

export function selectOnly(element: HTMLElement, selected: Set<string>, refId: string): void {
  clearSelection(element, selected); selected.add(refId);
  for (const chip of element.querySelectorAll<HTMLElement>("[data-path-ref]")) if (chip.dataset.pathRef === refId) chip.dataset.selected = "true";
}

export function toggleSelection(element: HTMLElement, selected: Set<string>, refId: string): void {
  if (selected.has(refId)) selected.delete(refId); else selected.add(refId);
  for (const chip of element.querySelectorAll<HTMLElement>("[data-path-ref]")) {
    if (chip.dataset.pathRef !== refId) continue;
    if (selected.has(refId)) chip.dataset.selected = "true";
    else delete chip.dataset.selected;
  }
}

function endsWithNewline(nodes: ComposerNode[]): boolean {
  const last = nodes.at(-1);
  return last?.type === "text" && last.text.endsWith("\n");
}

function moveRangeOutsidePath(range: Range, x: number): Range {
  const container = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
  const chip = container?.closest<HTMLElement>("[data-path-ref]");
  if (!chip) return range;
  const next = document.createRange();
  if (x < chip.getBoundingClientRect().left + chip.getBoundingClientRect().width / 2) next.setStartBefore(chip);
  else next.setStartAfter(chip);
  next.collapse(true);
  return next;
}
