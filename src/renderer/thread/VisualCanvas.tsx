import { Minus, Plus, Scan } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type PointerEvent, type ReactNode, type SetStateAction, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UiPreferences } from "../../shared/contracts.js";
import { Control } from "../../ui/components/index.js";
import { fitMediaSize, nextMediaSizePreset } from "../mediaSizing.js";
import { constrainVisualOffset, inlineVisualHeightLimit, inlineVisualStageHeight, scaleVisualOffset } from "./VisualCanvasGeometry.js";
import styles from "./VisualCanvas.module.css";

type VisualSizeMode = UiPreferences["mediaInitialSize"] | "fit" | "fill" | "double";
interface VisualView { mode: VisualSizeMode; zoom: number; x: number; y: number }
interface VisualLayout { width: number; height: number; paddingX: number; paddingY: number; inlineHeight: number }
interface PointerPosition { pointerId: number; clientX: number; clientY: number }
type GestureState = {
  kind: "pan";
  pointerId: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  committed: boolean;
} | {
  kind: "pinch";
  distance: number;
  anchorX: number;
  anchorY: number;
  view: VisualView;
};

const TOUCH_PAN_THRESHOLD = 10;

export interface VisualCanvasController {
  view: VisualView;
  setView: Dispatch<SetStateAction<VisualView>>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

export function useVisualCanvasController(initialMode: VisualSizeMode = "native"): VisualCanvasController {
  const [view, setView] = useState<VisualView>({ mode: initialMode, zoom: 1, x: 0, y: 0 });
  useEffect(() => setView({ mode: initialMode, zoom: 1, x: 0, y: 0 }), [initialMode]);
  return useMemo(() => ({
    view,
    setView,
    zoomIn: () => setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.2, .25, 8) })),
    zoomOut: () => setView((current) => ({ ...current, zoom: clamp(current.zoom / 1.2, .25, 8) })),
    fit: () => setView({ mode: initialMode === "fill" ? "fill" : "fit", zoom: 1, x: 0, y: 0 }),
  }), [initialMode, view]);
}

export function VisualCanvasControls({ controller, tone = "neutral" }: { controller: VisualCanvasController; tone?: "neutral" | "inverse" }) {
  const { t } = useTranslation();
  return <>
    <Control recipe="icon" density="compact" tone={tone} onClick={controller.zoomOut} aria-label={t("zoomOut")}><Minus size={13} /></Control>
    <Control recipe="icon" density="compact" tone={tone} onClick={controller.fit} aria-label={t("fitImage")}><Scan size={13} /></Control>
    <Control recipe="icon" density="compact" tone={tone} onClick={controller.zoomIn} aria-label={t("zoomIn")}><Plus size={13} /></Control>
  </>;
}

export function VisualCanvas({ children, controller, naturalWidth, naturalHeight, ariaLabel, detail = false, comfortablePercent = 70, minimumSize = 64, className = "", contentClassName = "" }: {
  children: ReactNode;
  controller: VisualCanvasController;
  naturalWidth: number;
  naturalHeight: number;
  ariaLabel: string;
  detail?: boolean;
  comfortablePercent?: number;
  minimumSize?: number;
  className?: string;
  contentClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerPosition>());
  const gesture = useRef<GestureState | null>(null);
  const viewRef = useRef(controller.view);
  viewRef.current = controller.view;
  const [layout, setLayout] = useState<VisualLayout>({ width: 0, height: 0, paddingX: 0, paddingY: 0, inlineHeight: 480 });
  const natural = { width: positive(naturalWidth), height: positive(naturalHeight) };
  const viewportWidth = Math.max(1, layout.width - layout.paddingX);
  const viewportHeight = detail ? Math.max(1, layout.height - layout.paddingY) : layout.inlineHeight;
  const fitScale = Math.max(.0001, Math.min(viewportWidth / natural.width, viewportHeight / natural.height));
  const minimumScale = Math.min(fitScale, Math.max(minimumSize / natural.width, minimumSize / natural.height));
  const nativeScale = detail ? 1 : clamp(1, minimumScale, fitScale);
  const comfortable = fitMediaSize(natural.width, natural.height, viewportWidth, viewportHeight, comfortablePercent, true);
  const comfortableScale = clamp(comfortable.width / natural.width, minimumScale, fitScale);
  const fillScale = Math.max(viewportWidth / natural.width, viewportHeight / natural.height);
  const modeScale = controller.view.mode === "fill" ? fillScale
    : controller.view.mode === "native" ? nativeScale
    : controller.view.mode === "smaller" ? Math.min(nativeScale, comfortableScale)
      : controller.view.mode === "larger" ? Math.max(nativeScale, comfortableScale)
        : controller.view.mode === "comfortable" ? comfortableScale
          : controller.view.mode === "double" ? comfortableScale * 2 : fitScale;
  const scale = modeScale * controller.view.zoom;
  const renderedHeight = natural.height * scale;
  const stageHeight = detail ? undefined : inlineVisualStageHeight(renderedHeight, layout.paddingY, viewportHeight);

  const constrainAtZoom = useCallback((zoom: number, x: number, y: number) => {
    const width = natural.width * modeScale * zoom;
    const height = natural.height * modeScale * zoom;
    const nextStageHeight = detail ? undefined : inlineVisualStageHeight(height, layout.paddingY, viewportHeight);
    const visibleHeight = detail ? viewportHeight : Math.max(1, (nextStageHeight || 0) - layout.paddingY);
    return constrainVisualOffset({ x, y, renderedWidth: width, renderedHeight: height, viewportWidth, viewportHeight: visibleHeight });
  }, [detail, layout.paddingY, modeScale, natural.height, natural.width, viewportHeight, viewportWidth]);
  const constrain = useCallback(
    (x: number, y: number) => constrainAtZoom(viewRef.current.zoom, x, y),
    [constrainAtZoom],
  );
  const updateView = useCallback((patch: Partial<VisualView>) => {
    controller.setView((current) => {
      const next = { ...current, ...patch };
      viewRef.current = next;
      return next;
    });
  }, [controller.setView]);

  const measure = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const computed = getComputedStyle(element);
    const next = {
      width: element.clientWidth,
      height: element.clientHeight,
      paddingX: pixels(computed.paddingLeft) + pixels(computed.paddingRight),
      paddingY: pixels(computed.paddingTop) + pixels(computed.paddingBottom),
      inlineHeight: inlineVisualHeightLimit(window.innerHeight),
    };
    setLayout((current) => current.width === next.width && current.height === next.height && current.paddingX === next.paddingX && current.paddingY === next.paddingY && current.inlineHeight === next.inlineHeight ? current : next);
  }, []);

  useEffect(() => {
    measure();
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);
  useEffect(() => {
    const next = constrain(controller.view.x, controller.view.y);
    if (next.x !== controller.view.x || next.y !== controller.view.y) controller.setView((current) => ({ ...current, ...next }));
  }, [constrain, controller.setView, controller.view.x, controller.view.y]);

  const beginPinch = (element: HTMLDivElement) => {
    const [first, second] = [...pointers.current.values()];
    if (!first || !second) return;
    const rect = element.getBoundingClientRect();
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    gesture.current = {
      kind: "pinch",
      distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
      anchorX: centerX - rect.left - rect.width / 2,
      anchorY: centerY - rect.top - rect.height / 2,
      view: viewRef.current,
    };
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      if (!detail) return;
      pointers.current.set(event.pointerId, {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (pointers.current.size >= 2) beginPinch(event.currentTarget);
      else gesture.current = {
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y,
        committed: false,
      };
      return;
    }
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      kind: "pan",
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewRef.current.x,
      y: viewRef.current.y,
      committed: true,
    };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
    const origin = gesture.current;
    if (!origin) return;
    if (origin.kind === "pinch") {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      const nextZoom = clamp(
        origin.view.zoom * Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)) / origin.distance,
        .25,
        8,
      );
      const offset = scaleVisualOffset({
        x: origin.view.x,
        y: origin.view.y,
        fromZoom: origin.view.zoom,
        toZoom: nextZoom,
        anchorX: origin.anchorX,
        anchorY: origin.anchorY,
        nextAnchorX: centerX - rect.left - rect.width / 2,
        nextAnchorY: centerY - rect.top - rect.height / 2,
      });
      updateView({ zoom: nextZoom, ...constrainAtZoom(nextZoom, offset.x, offset.y) });
      return;
    }
    if (origin.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - origin.clientX;
    const deltaY = event.clientY - origin.clientY;
    if (!origin.committed) {
      if (Math.hypot(deltaX, deltaY) < TOUCH_PAN_THRESHOLD) return;
      origin.committed = true;
    }
    event.preventDefault();
    updateView(constrainAtZoom(viewRef.current.zoom, origin.x + deltaX, origin.y + deltaY));
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (gesture.current?.kind === "pinch" && pointers.current.size >= 2) {
      beginPinch(event.currentTarget);
    } else if (gesture.current?.kind === "pinch" && pointers.current.size === 1) {
      const [remaining] = pointers.current.values();
      gesture.current = {
        kind: "pan",
        pointerId: remaining.pointerId,
        clientX: remaining.clientX,
        clientY: remaining.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y,
        committed: false,
      };
    } else if (gesture.current?.kind === "pinch" || gesture.current?.pointerId === event.pointerId) {
      gesture.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") controller.zoomIn();
    else if (event.key === "-") controller.zoomOut();
    else if (event.key === "0") controller.fit();
    else if (event.key.startsWith("Arrow")) {
      const x = controller.view.x + (event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0);
      const y = controller.view.y + (event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0);
      const next = constrain(x, y);
      controller.setView((current) => ({ ...current, ...next }));
    } else return;
    event.preventDefault();
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const nextZoom = clamp(controller.view.zoom * Math.exp(-event.deltaY * .01), .25, 8);
      if (nextZoom === controller.view.zoom) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      const offset = scaleVisualOffset({
        x: controller.view.x,
        y: controller.view.y,
        fromZoom: controller.view.zoom,
        toZoom: nextZoom,
        anchorX,
        anchorY,
      });
      updateView({ zoom: nextZoom, ...constrainAtZoom(nextZoom, offset.x, offset.y) });
      return;
    }
    if (!detail || (event.deltaX === 0 && event.deltaY === 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(viewportWidth, viewportHeight) : 1;
    const next = constrain(controller.view.x - event.deltaX * unit, controller.view.y - event.deltaY * unit);
    updateView(next);
  };
  const cycleSize = () => {
    const longEdge = Math.max(natural.width, natural.height);
    const presets = [
      { mode: "native" as const, size: longEdge * nativeScale },
      { mode: "comfortable" as const, size: longEdge * comfortableScale },
      detail
        ? { mode: "fill" as const, size: longEdge * fillScale }
        : { mode: "double" as const, size: longEdge * comfortableScale * 2 },
    ];
    const next = nextMediaSizePreset(longEdge * scale, presets);
    controller.setView({ mode: next.mode, zoom: 1, x: 0, y: 0 });
  };
  const style = {
    ...(stageHeight ? { height: `${stageHeight}px` } : {}),
    "--visual-natural-width": `${natural.width}px`,
    "--visual-natural-height": `${natural.height}px`,
    "--visual-transform": `translate3d(${controller.view.x}px, ${controller.view.y}px, 0) scale(${scale})`,
  } as CSSProperties;

  return <div
    ref={root}
    className={`${styles.viewport} ${className}`}
    style={style}
    role="group"
    aria-label={ariaLabel}
    aria-keyshortcuts="+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight"
    tabIndex={0}
    data-detail={detail || undefined}
    data-pannable="true"
    onKeyDown={keyDown}
    onWheel={wheel}
    onPointerDown={(event) => { event.currentTarget.focus({ preventScroll: true }); pointerDown(event); }}
    onPointerMove={pointerMove}
    onPointerUp={pointerUp}
    onPointerCancel={pointerUp}
    onDoubleClick={(event) => { event.preventDefault(); cycleSize(); }}
  ><div className={`${styles.canvas} ${contentClassName}`}>{children}</div></div>;
}

function pixels(value: string): number { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; }
function positive(value: number): number { return Number.isFinite(value) && value > 0 ? value : 1; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
