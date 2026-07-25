export interface VisualBounds { x: number; y: number; width: number; height: number }

interface ResettableVisualView {
  mode: string;
  zoom: number;
  x: number;
  y: number;
}

export function resetVisualViewForContent<TView extends ResettableVisualView, TMode extends TView["mode"]>(
  view: TView,
  mode: TMode,
): TView {
  if (view.mode === mode && view.zoom === 1 && view.x === 0 && view.y === 0) return view;
  return { ...view, mode, zoom: 1, x: 0, y: 0 };
}

export function centeredSvgViewBox(bounds: VisualBounds, padding = 12): VisualBounds {
  const inset = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    x: bounds.x - inset,
    y: bounds.y - inset,
    width: bounds.width + inset * 2,
    height: bounds.height + inset * 2,
  };
}

export function constrainVisualOffset({ x, y, renderedWidth, renderedHeight, viewportWidth, viewportHeight, minimumVisible = 64 }: {
  x: number;
  y: number;
  renderedWidth: number;
  renderedHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  minimumVisible?: number;
}): { x: number; y: number } {
  const limitX = panLimit(renderedWidth, viewportWidth, minimumVisible);
  const limitY = panLimit(renderedHeight, viewportHeight, minimumVisible);
  return { x: clamp(x, -limitX, limitX), y: clamp(y, -limitY, limitY) };
}

function panLimit(content: number, viewport: number, requestedVisible: number): number {
  const visible = Math.min(Math.max(0, requestedVisible), content, viewport);
  return Math.max(0, (content + viewport) / 2 - visible);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
