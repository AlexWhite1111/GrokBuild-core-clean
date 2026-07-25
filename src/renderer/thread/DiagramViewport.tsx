import { useLayoutEffect, useMemo } from "react";
import { useUiPreferences } from "../api/hooks.js";
import { VisualCanvas, useVisualCanvasController, type VisualCanvasController } from "./VisualCanvas.js";
import { resetVisualViewForContent } from "./VisualCanvasGeometry.js";
import styles from "./CodeBlock.module.css";

export function DiagramViewport({ svg, controller: sharedController, detail = false, comfortablePercent, minimumSize }: { svg: string; controller?: VisualCanvasController; detail?: boolean; comfortablePercent?: number; minimumSize?: number }) {
  const preferences = useUiPreferences().data;
  const localController = useVisualCanvasController(detail ? "fit" : preferences?.mediaInitialSize || "native");
  const controller = sharedController || localController;
  const size = useMemo(() => svgSize(svg), [svg]);
  const setControllerView = controller.setView;
  useLayoutEffect(() => {
    setControllerView((current) => resetVisualViewForContent(current, detail ? "fit" : current.mode));
  }, [detail, setControllerView, svg]);
  return <VisualCanvas ariaLabel="Diagram viewport" className={styles.visual} contentClassName={styles.diagram} controller={controller} naturalWidth={size.width} naturalHeight={size.height} detail={detail} comfortablePercent={comfortablePercent ?? preferences?.mediaPreviewScale} minimumSize={minimumSize ?? preferences?.mediaMinimumSize}>
    <div data-diagram-canvas dangerouslySetInnerHTML={{ __html: svg }} />
  </VisualCanvas>;
}

function svgSize(source: string): { width: number; height: number } {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const viewWidth = viewBox.length === 4 && viewBox.every(Number.isFinite) ? Math.abs(viewBox[2]) : 0;
  const viewHeight = viewBox.length === 4 && viewBox.every(Number.isFinite) ? Math.abs(viewBox[3]) : 0;
  return {
    width: dimension(root.getAttribute("width")) || viewWidth || 960,
    height: dimension(root.getAttribute("height")) || viewHeight || 540,
  };
}

function dimension(value: string | null): number {
  if (!value || value.trim().endsWith("%")) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
