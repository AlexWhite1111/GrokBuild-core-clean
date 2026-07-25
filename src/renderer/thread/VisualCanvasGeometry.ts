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

export function inlineVisualHeightLimit(viewportHeight: number): number {
  const height = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  return clamp(height * .6, 240, 640);
}

export function inlineVisualStageHeight(renderedHeight: number, padding: number, limit: number): number {
  return Math.min(Math.max(1, renderedHeight) + Math.max(0, padding), Math.max(1, limit) + Math.max(0, padding));
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

export function scaleVisualOffset({
  x,
  y,
  fromZoom,
  toZoom,
  anchorX,
  anchorY,
  nextAnchorX = anchorX,
  nextAnchorY = anchorY,
}: {
  x: number;
  y: number;
  fromZoom: number;
  toZoom: number;
  anchorX: number;
  anchorY: number;
  nextAnchorX?: number;
  nextAnchorY?: number;
}): { x: number; y: number } {
  const ratio = toZoom / Math.max(.0001, fromZoom);
  return {
    x: nextAnchorX - (anchorX - x) * ratio,
    y: nextAnchorY - (anchorY - y) * ratio,
  };
}

function panLimit(content: number, viewport: number, requestedVisible: number): number {
  const visible = Math.min(Math.max(0, requestedVisible), content, viewport);
  return Math.max(0, (content + viewport) / 2 - visible);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
