import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { scrollThreadByWheel, wheelPixels } from "./threadScroll.js";

export function CodeScrollRegion(props: Omit<ComponentPropsWithoutRef<"pre">, "onWheel">) {
  const ref = useSplitScroll<HTMLPreElement>();
  return <pre {...props} ref={ref} />;
}

export function SplitScrollRegion(props: Omit<ComponentPropsWithoutRef<"div">, "onWheel">) {
  const ref = useSplitScroll<HTMLDivElement>();
  return <div {...props} ref={ref} />;
}

function useSplitScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => routeCodeWheel(node, event);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}

export function codeScrollDestination(clientX: number, left: number, width: number): "thread" | "internal" {
  return clientX < left + Math.max(0, width) * .75 ? "thread" : "internal";
}

function routeCodeWheel(node: HTMLElement, event: WheelEvent): void {
  if (modifiedGesture(event)) return;
  const bounds = node.getBoundingClientRect();
  event.preventDefault();
  event.stopPropagation();
  if (
    codeScrollDestination(event.clientX, bounds.left, bounds.width) === "thread"
    && scrollThreadByWheel(node, event)
  ) return;
  node.scrollLeft += wheelPixels(event.deltaX, event.deltaMode, node.clientWidth);
  node.scrollTop += wheelPixels(event.deltaY, event.deltaMode, node.clientHeight);
}

function modifiedGesture(event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}
