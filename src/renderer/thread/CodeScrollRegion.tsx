import type { ComponentPropsWithoutRef, WheelEvent as ReactWheelEvent } from "react";

export function CodeScrollRegion({ onWheelCapture, onWheel, ...props }: ComponentPropsWithoutRef<"pre">) {
  return <pre
    {...props}
    onWheelCapture={(event) => {
      onWheelCapture?.(event);
      if (!event.isPropagationStopped()) captureCodeWheel(event);
    }}
    onWheel={(event) => {
      onWheel?.(event);
      if (!event.isPropagationStopped()) containCodeWheel(event);
    }}
  />;
}

export function codeScrollDestination(clientX: number, left: number, width: number): "thread" | "internal" {
  return clientX < left + Math.max(0, width) * .75 ? "thread" : "internal";
}

function scrollThreadFromNode(node: HTMLElement | null, deltaY: number, deltaMode = 0, deltaX = 0): void {
  const thread = node?.closest<HTMLElement>("[data-thread-scroll]");
  if (!thread || !Number.isFinite(deltaY) || deltaY === 0) return;
  thread.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY, deltaMode }));
  thread.scrollTop += wheelPixels(deltaY, deltaMode, thread.clientHeight);
}

function captureCodeWheel(event: ReactWheelEvent<HTMLElement>): void {
  if (modifiedGesture(event)) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (codeScrollDestination(event.clientX, bounds.left, bounds.width) !== "thread") return;
  event.preventDefault();
  event.stopPropagation();
  scrollThreadFromNode(event.currentTarget, event.deltaY, event.deltaMode, event.deltaX);
}

function containCodeWheel(event: ReactWheelEvent<HTMLElement>): void {
  if (modifiedGesture(event)) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (codeScrollDestination(event.clientX, bounds.left, bounds.width) !== "internal") return;
  event.stopPropagation();
  if (event.defaultPrevented) return;
  event.preventDefault();
  const target = internalScrollTarget(event.currentTarget, event.nativeEvent);
  if (!target) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(target.clientWidth, target.clientHeight) : 1;
  target.scrollLeft += event.deltaX * unit;
  target.scrollTop += event.deltaY * unit;
}

function internalScrollTarget(boundary: HTMLElement, event: WheelEvent): HTMLElement | null {
  for (const value of event.composedPath()) {
    if (!(value instanceof HTMLElement) || !boundary.contains(value)) continue;
    const style = getComputedStyle(value);
    const vertical = scrollable(style.overflowY) && value.scrollHeight > value.clientHeight + 1;
    const horizontal = scrollable(style.overflowX) && value.scrollWidth > value.clientWidth + 1;
    if (vertical || horizontal) return value;
  }
  return null;
}

function modifiedGesture(event: Pick<ReactWheelEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

function scrollable(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "overlay";
}

function wheelPixels(value: number, mode: number, pageSize: number): number {
  return value * (mode === 1 ? 16 : mode === 2 ? pageSize : 1);
}
