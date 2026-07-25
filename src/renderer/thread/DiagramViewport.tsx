import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UiPreferences } from "../../shared/contracts.js";
import { VisualCanvas, useVisualCanvasController, type VisualCanvasController } from "./VisualCanvas.js";
import { centeredSvgViewBox, resetVisualViewForContent } from "./VisualCanvasGeometry.js";
import styles from "./CodeBlock.module.css";

export function DiagramViewport({ svg, controller: sharedController, detail = false, comfortablePercent, minimumSize, tightBounds = false }: { svg: string; controller?: VisualCanvasController; detail?: boolean; comfortablePercent?: number; minimumSize?: number; tightBounds?: boolean }) {
  const queryClient = useQueryClient();
  const preferences = queryClient.getQueryData<UiPreferences>(["ui-preferences"]);
  const localController = useVisualCanvasController(detail ? "fit" : preferences?.mediaInitialSize || "native");
  const controller = sharedController || localController;
  const declaredSize = useMemo(() => svgSize(svg), [svg]);
  const [size, setSize] = useState(declaredSize);
  const content = useRef<HTMLDivElement>(null);
  const setControllerView = controller.setView;
  useLayoutEffect(() => {
    setSize(declaredSize);
    setControllerView((current) => resetVisualViewForContent(current, detail ? "fit" : current.mode));
    if (!tightBounds) return;
    const root = content.current?.querySelector("svg");
    if (!root) return;
    const measure = () => {
      const measured = root.getBBox();
      if (![measured.x, measured.y, measured.width, measured.height].every(Number.isFinite) || measured.width <= 0 || measured.height <= 0) return;
      const viewBox = centeredSvgViewBox(measured);
      root.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
      root.setAttribute("preserveAspectRatio", "xMidYMid meet");
      root.removeAttribute("width");
      root.removeAttribute("height");
      root.style.maxWidth = "none";
      setSize({ width: viewBox.width, height: viewBox.height });
    };
    measure();
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [declaredSize, detail, setControllerView, svg, tightBounds]);
  return <VisualCanvas ariaLabel="Diagram viewport" className={styles.visual} contentClassName={styles.diagram} controller={controller} naturalWidth={size.width} naturalHeight={size.height} detail={detail} comfortablePercent={comfortablePercent ?? preferences?.mediaPreviewScale} minimumSize={minimumSize ?? preferences?.mediaMinimumSize}>
    <div ref={content} data-diagram-canvas dangerouslySetInnerHTML={{ __html: svg }} />
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
