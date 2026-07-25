import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type ClipboardEvent, type CompositionEvent, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import type { PathReferenceSummary } from "../../shared/contracts.js";
import { composerFingerprint, composerHasContent, normalizeComposerNodes, type ComposerNode } from "./composerDocument.js";
import { createPathChipElement, PATH_CHIP_MIME, PATH_CHIP_SOURCE_MIME, readPathChipTransfer, writePathChipTransfer } from "../../ui/components/index.js";
import { insertPathChips, PATH_CARET_ANCHOR, removePathChip } from "./pathChipDom.js";
import { snapshotDroppedFiles } from "./useWindowFileDrop.js";
import { adjacentPath, clearSelection, codePointLengthOver, currentRange, insertionRange, insertText, rangeFromPoint, readNodes, removeAsyncMarker, selectOnly, setSelection, toggleSelection } from "./inlineComposerDom.js";
import styles from "./Composer.module.css";
export interface InlineComposerEditorHandle { focus(): void; insertPaths(paths: PathReferenceSummary[], point?: { x: number; y: number }): void }
interface InlineComposerEditorProps { value: ComposerNode[]; disabled: boolean; readOnly?: boolean; placeholder: string; submitOnEnter?: boolean; maxLines?: number; className?: string; onChange: (nodes: ComposerNode[]) => void; onSubmit: (commandKey: boolean) => void; onFiles: (files: File[]) => Promise<PathReferenceSummary[]>; onTextClip?: (text: string) => Promise<PathReferenceSummary | null>; onRevealPath: (refId: string) => void; onFocus?: () => void }
export const InlineComposerEditor = forwardRef<InlineComposerEditorHandle, InlineComposerEditorProps>(function InlineComposerEditor(props, forwardedRef) {
  const dragSourceId = useId();
  const root = useRef<HTMLDivElement>(null);
  const paths = useRef(new Map<string, PathReferenceSummary>());
  const savedRange = useRef<Range | null>(null);
  const lastEmitted = useRef("");
  const composing = useRef(false);
  const selected = useRef(new Set<string>());
  const rememberSelection = () => {
    const range = currentRange(root.current);
    if (range) savedRange.current = range.cloneRange();
  };
  const placeEmptyCaretAtStart = () => {
    const element = root.current;
    if (!element || element.childNodes.length > 0) return;
    const range = document.createRange();
    range.setStart(element, 0); range.collapse(true); setSelection(range);
    savedRange.current = range.cloneRange();
  };
  const emit = () => {
    const element = root.current;
    if (!element) return;
    const nodes = readNodes(element, paths.current);
    element.dataset.empty = String(!composerHasContent(nodes));
    lastEmitted.current = composerFingerprint(nodes);
    flushSync(() => props.onChange(nodes));
    rememberSelection();
  };
  const insertPaths = (incoming: PathReferenceSummary[], range = insertionRange(root.current, savedRange.current)) => {
    const element = root.current;
    if (!element || !range || !incoming.length) return;
    for (const path of incoming) paths.current.set(path.refId, path);
    const next = insertPathChips(range, incoming.map(pathElement));
    setSelection(next);
    savedRange.current = next.cloneRange();
    clearSelection(element, selected.current);
    emit();
  };
  useImperativeHandle(forwardedRef, () => ({
    focus: () => root.current?.focus(),
    insertPaths: (incoming, point) => insertPaths(incoming, point
      ? rangeFromPoint(root.current, point.x, point.y) || insertionRange(root.current, savedRange.current)
      : undefined),
  }));
  useEffect(() => {
    const element = root.current;
    const normalized = normalizeComposerNodes(props.value);
    const fingerprint = composerFingerprint(normalized);
    if (!element || fingerprint === lastEmitted.current) return;
    paths.current = new Map(normalized.flatMap((node) => node.type === "path" ? [[node.path.refId, node.path] as const] : []));
    element.replaceChildren(...normalized.flatMap((node) => node.type === "text"
      ? [document.createTextNode(node.text)]
      : [pathElement(node.path), document.createTextNode(PATH_CARET_ANCHOR)]));
    element.dataset.empty = String(!composerHasContent(normalized));
    lastEmitted.current = fingerprint;
    selected.current.clear();
    savedRange.current = insertionRange(element, null);
  }, [props.value]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.readOnly) return;
    const commandKey = event.metaKey || event.ctrlKey;
    if ((props.submitOnEnter || commandKey) && event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) {
      event.preventDefault();
      props.onSubmit(commandKey);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && (event.key === "Backspace" || event.key === "Delete")) {
      const element = root.current;
      if (!element) return;
      if (selected.current.size) {
        event.preventDefault();
        for (const chip of element.querySelectorAll<HTMLElement>("[data-path-ref]")) if (selected.current.has(chip.dataset.pathRef || "")) removePathChip(chip);
        selected.current.clear();
        emit();
        return;
      }
      const adjacent = adjacentPath(currentRange(element), event.key === "Backspace" ? "before" : "after");
      if (adjacent) {
        event.preventDefault();
        selectOnly(element, selected.current, adjacent.dataset.pathRef || "");
      }
    }
  };
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-path-ref]");
    const element = root.current;
    if (!element) return;
    if (!chip) { clearSelection(element, selected.current); rememberSelection(); return; }
    const refId = chip.dataset.pathRef || "";
    if (event.metaKey || event.ctrlKey || event.shiftKey) toggleSelection(element, selected.current, refId);
    else selectOnly(element, selected.current, refId);
  };
  const doubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const refId = (event.target as HTMLElement).closest<HTMLElement>("[data-path-ref]")?.dataset.pathRef;
    if (refId) props.onRevealPath(refId);
  };
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (props.readOnly) { event.preventDefault(); return; }
    const files = snapshotDroppedFiles(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      const range = insertionRange(root.current, currentRange(root.current) || savedRange.current)?.cloneRange();
      void props.onFiles(files).then((items) => insertPaths(items, range || undefined));
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (props.onTextClip && codePointLengthOver(text, 1_000)) {
      event.preventDefault();
      const range = insertionRange(root.current, currentRange(root.current) || savedRange.current);
      if (!range) return;
      const marker = document.createComment("grok-text-clip-caret");
      range.deleteContents();
      range.insertNode(marker);
      const caret = document.createRange();
      caret.setStartAfter(marker); caret.collapse(true); setSelection(caret);
      savedRange.current = caret.cloneRange();
      void props.onTextClip(text).then((path) => {
        if (!path || !marker.isConnected) { removeAsyncMarker(marker); return; }
        const target = document.createRange();
        target.setStartBefore(marker); target.collapse(true);
        insertPaths([path], target);
        marker.remove();
      }).catch(() => removeAsyncMarker(marker));
      return;
    }
    event.preventDefault();
    insertText(text, root.current, savedRange.current);
    emit();
  };
  const dragStart = (event: DragEvent<HTMLDivElement>) => {
    const refId = (event.target as HTMLElement).closest<HTMLElement>("[data-path-ref]")?.dataset.pathRef;
    const path = refId ? paths.current.get(refId) : undefined;
    if (!path) return;
    writePathChipTransfer(event.dataTransfer, path);
    event.dataTransfer.setData(PATH_CHIP_SOURCE_MIME, dragSourceId);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (props.readOnly) { event.preventDefault(); return; }
    const internal = readPathChipTransfer(event.dataTransfer);
    const files = internal ? [] : snapshotDroppedFiles(event.dataTransfer);
    if (files.length) {
      event.preventDefault(); event.stopPropagation();
      const range = rangeFromPoint(root.current, event.clientX, event.clientY)?.cloneRange();
      void props.onFiles(files).then((items) => insertPaths(items, range || undefined));
      return;
    }
    if (!internal) return;
    event.preventDefault();
    event.stopPropagation();
    const element = root.current;
    const range = rangeFromPoint(element, event.clientX, event.clientY);
    if (!element || !range) return;
    if (event.dataTransfer.getData(PATH_CHIP_SOURCE_MIME) !== dragSourceId) {
      insertPaths([internal], range);
      return;
    }
    const chip = [...element.querySelectorAll<HTMLElement>("[data-path-ref]")].find((item) => item.dataset.pathRef === internal.refId);
    if (!chip || chip.contains(range.startContainer)) return;
    removePathChip(chip);
    const next = insertPathChips(range, [chip]);
    setSelection(next); emit();
  };
  return <div
    ref={root}
    className={`${styles.inlineEditor} ${props.className || ""}`}
    style={{ "--composer-editor-max-lines": props.maxLines || 12 } as CSSProperties}
    contentEditable={!props.disabled}
    suppressContentEditableWarning
    role="textbox"
    aria-multiline="true"
    aria-readonly={props.readOnly || undefined}
    aria-label={props.placeholder}
    data-placeholder={props.placeholder}
    data-max-lines={props.maxLines || 12}
    data-empty="true"
    data-inline-composer-editor="true"
    onBeforeInput={(event: FormEvent<HTMLDivElement>) => { if (props.readOnly) event.preventDefault(); }}
    onInput={(event: FormEvent<HTMLDivElement>) => { if (!props.readOnly) { clearSelection(event.currentTarget, selected.current); emit(); } }}
    onKeyDown={keyDown}
    onKeyUp={rememberSelection}
    onMouseUp={rememberSelection}
    onClick={click}
    onDoubleClick={doubleClick}
    onPaste={paste}
    onDragStart={dragStart}
    onDragOver={(event) => {
      const internal = Array.from(event.dataTransfer.types).includes(PATH_CHIP_MIME);
      const files = Array.from(event.dataTransfer.types).includes("Files");
      if (!internal && !files) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = internal && event.dataTransfer.getData(PATH_CHIP_SOURCE_MIME) === dragSourceId ? "move" : "copy";
    }}
    onDrop={drop}
    onCompositionStart={(_event: CompositionEvent<HTMLDivElement>) => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; emit(); }}
    onFocus={() => { placeEmptyCaretAtStart(); props.onFocus?.(); }}
    onBlur={rememberSelection}
  />;
});
function pathElement(path: PathReferenceSummary): HTMLElement {
  const chip = createPathChipElement(path);
  chip.classList.add(styles.inlinePath);
  return chip;
}
