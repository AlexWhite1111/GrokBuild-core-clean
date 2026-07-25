import type { HTMLAttributes, PointerEventHandler } from "react";
import styles from "./ResizeHandle.module.css";

export function ResizeHandle({ orientation = "horizontal", side = "end", className = "", onPointerDown, ...props }: HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
  side?: "start" | "end";
  onPointerDown: PointerEventHandler<HTMLDivElement>;
}) {
  return <div
    {...props}
    className={`${styles.handle} ${className}`}
    data-orientation={orientation}
    data-side={side}
    data-ui-resize-handle
    role="separator"
    aria-orientation={orientation}
    onPointerDown={onPointerDown}
  ><i aria-hidden /></div>;
}
