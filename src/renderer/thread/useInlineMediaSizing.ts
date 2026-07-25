import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react";
import type { UiPreferences } from "../../shared/contracts.js";
import { clampInlineMediaRatio, fitMediaSize, MEDIA_SCALE_MAX, MEDIA_SCALE_MIN, nextMediaSizePreset } from "../mediaSizing.js";

export function useInlineMediaSizing(width: number | null, defaultScale: number, initialSize: UiPreferences["mediaInitialSize"], minimumSize: number, onWidthChange: (width: number) => void) {
  const figure = useRef<HTMLElement | null>(null);
  const natural = useRef<{ width: number; height: number } | null>(null);
  const settings = useRef({ defaultScale, initialSize, minimumSize });
  const [containerWidth, setContainerWidth] = useState(0);
  const defaultRatio = Math.min(1, Math.min(MEDIA_SCALE_MAX, Math.max(MEDIA_SCALE_MIN, defaultScale)) / 100);
  const aspect = natural.current ? natural.current.width / natural.current.height : 1;
  const effectiveWidth = clampInlineMediaRatio(width ?? defaultRatio, containerWidth || 640, minimumSize, aspect);
  const availableWidth = () => figure.current?.parentElement?.getBoundingClientRect().width || 0;
  const measuredRatios = () => {
    const available = availableWidth();
    const source = natural.current;
    if (!available || !source) return null;
    const height = Number.MAX_SAFE_INTEGER;
    const comfortable = fitMediaSize(source.width, source.height, available, height, defaultScale, true);
    const sourceAspect = source.width / source.height;
    const protect = (ratio: number) => clampInlineMediaRatio(ratio, available, minimumSize, sourceAspect);
    return {
      available,
      aspect: sourceAspect,
      native: protect(Math.min(1, source.width / available)),
      comfortable: protect(comfortable.width / available),
    };
  };
  const initialRatio = (measured: NonNullable<ReturnType<typeof measuredRatios>>) => initialSize === "native" ? measured.native
    : initialSize === "smaller" ? Math.min(measured.native, measured.comfortable)
      : initialSize === "larger" ? Math.max(measured.native, measured.comfortable)
        : measured.comfortable;
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
  useEffect(() => {
    const previous = settings.current;
    settings.current = { defaultScale, initialSize, minimumSize };
    if (previous.defaultScale === defaultScale && previous.initialSize === initialSize && previous.minimumSize === minimumSize) return;
    const measured = measuredRatios();
    if (measured) onWidthChange(initialRatio(measured));
  }, [defaultScale, initialSize, minimumSize, onWidthChange]);

  return {
    width: effectiveWidth,
    setFigure,
    pinchZoom: (event: WheelEvent<HTMLElement>) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      const measured = measuredRatios();
      if (!measured) return;
      event.preventDefault();
      event.stopPropagation();
      const next = effectiveWidth * Math.exp(-event.deltaY * .01);
      onWidthChange(clampInlineMediaRatio(next, measured.available, minimumSize, measured.aspect));
    },
    cycleSize: () => {
      const measured = measuredRatios();
      if (!measured) return;
      const next = nextMediaSizePreset(effectiveWidth * measured.available, [
        { mode: "native", size: measured.native * measured.available },
        { mode: "comfortable", size: measured.comfortable * measured.available },
        { mode: "double", size: clampInlineMediaRatio(measured.comfortable * 2, measured.available, minimumSize, measured.aspect) * measured.available },
      ]);
      onWidthChange(clampInlineMediaRatio(next.size / measured.available, measured.available, minimumSize, measured.aspect));
    },
    fit: (naturalWidth: number, naturalHeight: number) => {
      natural.current = { width: naturalWidth, height: naturalHeight };
      const measured = measuredRatios();
      if (width === null && measured) onWidthChange(initialRatio(measured));
    },
  };
}
