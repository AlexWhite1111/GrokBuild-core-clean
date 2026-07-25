import { useEffect, useRef } from "react";
import { snapshotDroppedFiles } from "../files/dropFiles.js";

export { snapshotDroppedFiles } from "../files/dropFiles.js";

type DropPoint = { x: number; y: number };

export function useWindowFileDrop(
  enabled: boolean,
  onActive: (active: boolean) => void,
  onDrop: (files: File[], point: DropPoint) => void,
  acceptsPoint: (point: DropPoint) => boolean = () => true,
): void {
  const dropRef = useRef(onDrop);
  const acceptsPointRef = useRef(acceptsPoint);
  dropRef.current = onDrop;
  acceptsPointRef.current = acceptsPoint;

  useEffect(() => {
    if (!enabled) { onActive(false); return; }
    const containsFiles = (event: DragEvent) => Boolean(event.dataTransfer
      && (event.dataTransfer.files.length > 0 || Array.from(event.dataTransfer.types).includes("Files")));
    const accept = (event: DragEvent) => {
      if (!containsFiles(event)) return false;
      event.preventDefault();
      return true;
    };
    const acceptedPoint = (event: DragEvent) => acceptsPointRef.current({ x: event.clientX, y: event.clientY });
    const enter = (event: DragEvent) => { if (accept(event)) onActive(acceptedPoint(event)); };
    const over = (event: DragEvent) => {
      if (!accept(event)) return;
      const accepted = acceptedPoint(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? "copy" : "none";
      onActive(accepted);
    };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) onActive(false); };
    const drop = (event: DragEvent) => {
      if (!accept(event)) return;
      onActive(false);
      if (event.target instanceof Element && event.target.closest("[data-inline-composer-editor], [data-context-resource-drop-target]")) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!acceptsPointRef.current(point)) return;
      const files = event.dataTransfer ? snapshotDroppedFiles(event.dataTransfer) : [];
      dropRef.current(files, point);
    };
    const clear = () => onActive(false);
    window.addEventListener("dragenter", enter, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", clear, true);
    return () => {
      window.removeEventListener("dragenter", enter, true);
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("dragleave", leave, true);
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", clear, true);
    };
  }, [enabled, onActive]);
}
