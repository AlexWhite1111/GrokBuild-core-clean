import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

export function CodeScrollRegion(props: Omit<ComponentPropsWithoutRef<"pre">, "onWheel">) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => routeCodeWheel(node, event);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  return <pre {...props} ref={ref} />;
}

export function codeScrollDestination(clientX: number, left: number, width: number): "thread" | "internal" {
  return clientX < left + Math.max(0, width) * .75 ? "thread" : "internal";
}

function scrollThreadFromNode(node: HTMLElement | null, deltaY: number, deltaMode = 0, deltaX = 0): void {
  const thread = node?.closest<HTMLElement>("[data-thread-scroll]");
  if (!thread || !Number.isFinite(deltaY) || deltaY === 0) return;
  thread.scrollLeft += wheelPixels(deltaX, deltaMode, thread.clientWidth);
  thread.scrollTop += wheelPixels(deltaY, deltaMode, thread.clientHeight);
}

function routeCodeWheel(node: HTMLElement, event: WheelEvent): void {
  if (modifiedGesture(event)) return;
  const bounds = node.getBoundingClientRect();
  event.preventDefault();
  event.stopPropagation();
  if (codeScrollDestination(event.clientX, bounds.left, bounds.width) === "thread") {
    scrollThreadFromNode(node, event.deltaY, event.deltaMode, event.deltaX);
    return;
  }
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(node.clientWidth, node.clientHeight) : 1;
  node.scrollLeft += event.deltaX * unit;
  node.scrollTop += event.deltaY * unit;
}

function modifiedGesture(event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

function wheelPixels(value: number, mode: number, pageSize: number): number {
  return value * (mode === 1 ? 16 : mode === 2 ? pageSize : 1);
}
