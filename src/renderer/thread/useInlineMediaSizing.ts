import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react";
import type { UiPreferences } from "../../shared/contracts.js";
import { clampInlineMediaRatio, fitMediaSize, fitMediaWithinBounds, MEDIA_SCALE_MAX, MEDIA_SCALE_MIN, nextMediaSizePreset } from "../mediaSizing.js";

export function useInlineMediaSizing(width: number | null, defaultScale: number, initialSize: UiPreferences["mediaInitialSize"], minimumSize: number, onWidthChange: (width: number) => void) {
  const figure = useRef<HTMLElement | null>(null);
  const ratios = useRef<{ native: number; comfortable: number; aspect: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const defaultRatio = Math.min(1, Math.min(MEDIA_SCALE_MAX, Math.max(MEDIA_SCALE_MIN, defaultScale)) / 100);
  const aspect = ratios.current?.aspect || 1;
  const effectiveWidth = clampInlineMediaRatio(width ?? defaultRatio, containerWidth || 640, minimumSize, aspect);
  const availableWidth = () => figure.current?.parentElement?.getBoundingClientRect().width || 0;
  const setFigure = useCallback((element: HTMLElement | null) => {
    figure.current = element;
    setContainerWidth(element?.parentElement?.getBoundingClientRect().width || 0);
  }, []);

  useEffect(() => {
    const parent = figure.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const update = () => setContainerWidth(parent.getBoundingClientRect().width || 0);
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    update();
    return () => observer.disconnect();
  }, []);

  return {
    width: effectiveWidth,
    setFigure,
    pinchZoom: (event: WheelEvent<HTMLElement>) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      const available = availableWidth();
      const measured = ratios.current;
      if (!available || !measured) return;
      event.preventDefault();
      event.stopPropagation();
      const next = effectiveWidth * Math.exp(-event.deltaY * .01);
      onWidthChange(clampInlineMediaRatio(next, available, minimumSize, measured.aspect));
    },
    cycleSize: () => {
      const available = availableWidth();
      const measured = ratios.current;
      if (!available || !measured) return;
      const next = nextMediaSizePreset(effectiveWidth * available, [
        { mode: "native", size: measured.native * available },
        { mode: "comfortable", size: measured.comfortable * available },
        { mode: "double", size: clampInlineMediaRatio(measured.comfortable * 2, available, minimumSize, measured.aspect) * available },
      ]);
      onWidthChange(clampInlineMediaRatio(next.size / available, available, minimumSize, measured.aspect));
    },
    fit: (naturalWidth: number, naturalHeight: number) => {
      const available = availableWidth();
      if (!available) return;
      const height = Number.MAX_SAFE_INTEGER;
      const native = fitMediaWithinBounds(naturalWidth, naturalHeight, available, height, false);
      const maximum = fitMediaWithinBounds(naturalWidth, naturalHeight, available, height, true);
      const comfortable = fitMediaSize(naturalWidth, naturalHeight, available, height, defaultScale, true);
      const aspect = naturalWidth / naturalHeight;
      const maximumRatio = maximum.width / available;
      const protect = (ratio: number) => Math.min(maximumRatio, clampInlineMediaRatio(ratio, available, minimumSize, aspect));
      ratios.current = {
        native: protect(native.width / available),
        comfortable: protect(comfortable.width / available),
        aspect,
      };
      if (width === null) {
        const initial = initialSize === "native" ? ratios.current.native
          : initialSize === "smaller" ? Math.min(ratios.current.native, ratios.current.comfortable)
            : initialSize === "larger" ? Math.max(ratios.current.native, ratios.current.comfortable)
              : ratios.current.comfortable;
        onWidthChange(initial);
      }
    },
  };
}
