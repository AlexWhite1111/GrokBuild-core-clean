import type { TaskScrollAnchor } from "../../shared/contracts.js";

type ThreadAnchorItem = { id: string };

export function threadAtBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
}

/**
 * Following is reading intent, not a transient pixel position. Content growth
 * can move the bottom without user input; only an upward scroll releases the
 * intent, and reaching the real end restores it.
 */
export function threadFollowAfterScroll(
  following: boolean,
  previousScrollTop: number,
  scrollTop: number,
  atBottom: boolean,
): boolean {
  return atBottom || (following && scrollTop >= previousScrollTop);
}

/**
 * Dynamic content in the row currently being read usually grows below the
 * viewport (streaming text, previews, images). Only compensate for rows that
 * are already completely above the reading position.
 */
export function threadRowResizeAdjustsScroll(item: { end: number }, scrollOffset: number): boolean {
  return item.end <= scrollOffset;
}

export function scrollThreadByWheel(
  node: HTMLElement | null,
  wheel: Pick<WheelEvent, "deltaY" | "deltaMode">,
): boolean {
  const thread = node?.closest<HTMLElement>("[data-thread-scroll]");
  if (!thread || !Number.isFinite(wheel.deltaY) || wheel.deltaY === 0) return false;
  thread.scrollTop += wheelPixels(wheel.deltaY, wheel.deltaMode, thread.clientHeight);
  return true;
}

export function wheelPixels(value: number, mode: number, pageSize: number): number {
  return value * (mode === 1 ? 16 : mode === 2 ? pageSize : 1);
}

export function resolveThreadScrollAnchorIndex(items: ThreadAnchorItem[], anchor: TaskScrollAnchor): number {
  const exact = anchor.itemId ? items.findIndex((item) => item.id === anchor.itemId) : -1;
  if (exact >= 0) return exact;
  return Math.max(0, Math.min(Math.max(0, items.length - 1), anchor.fallbackIndex));
}

export function createThreadScrollAnchor(
  items: ThreadAnchorItem[],
  index: number,
  scrollTop: number,
  rowStart: number,
  followLatest: boolean,
): TaskScrollAnchor {
  // Restoration ignores pixel coordinates while following the latest output.
  // Persist one canonical value so programmatic bottom-follow scrolling during
  // streaming cannot rewrite the complete preference document every 240 ms.
  if (followLatest) {
    return { itemId: null, fallbackIndex: 0, offset: 0, followLatest: true };
  }
  const fallbackIndex = Math.max(0, Math.min(Math.max(0, items.length - 1), Math.trunc(index)));
  return {
    itemId: items[fallbackIndex]?.id || null,
    fallbackIndex,
    offset: Math.max(0, Number((scrollTop - rowStart).toFixed(2))),
    followLatest,
  };
}

export function sameThreadScrollAnchor(
  left: TaskScrollAnchor | null | undefined,
  right: TaskScrollAnchor | null | undefined,
): boolean {
  return left === right || Boolean(
    left
    && right
    && left.itemId === right.itemId
    && left.fallbackIndex === right.fallbackIndex
    && left.offset === right.offset
    && left.followLatest === right.followLatest
  );
}

export function threadLatestControl(atBottom: boolean, busy: boolean): "hidden" | "activity" | "latest" {
  if (atBottom) return "hidden";
  return busy ? "activity" : "latest";
}
